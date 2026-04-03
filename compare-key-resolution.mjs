/**
 * compare-key-resolution.mjs
 *
 * Loads raw transaction descriptions from DB, runs both key-resolution
 * strategies, and writes 3 CSV files:
 *
 *   out/01-input.csv        — all unique raw descriptions (sorted)
 *   out/02-sync-output.csv  — description → key from resolveDescriptionKeysSync
 *   out/03-diff.csv         — only rows where sync ≠ llm (when llm is run)
 *
 * Usage:
 *   node compare-key-resolution.mjs           # sync only (fast)
 *   node compare-key-resolution.mjs --llm     # also run LLM (slow, costs money)
 */

import postgres from 'postgres';
import { readFileSync, mkdirSync, writeFileSync } from 'fs';

// ─── Config ──────────────────────────────────────────────────────────────────

const env = readFileSync('.env', 'utf-8');
const DATABASE_URL = env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
const OPENAI_API_KEY = env.match(/^OPENAI_API_KEY=(.+)$/m)?.[1]?.trim();

if (!DATABASE_URL) throw new Error('DATABASE_URL not found in .env');

const RUN_LLM = process.argv.includes('--llm');
const USER_ID = process.argv.find((a, i) => process.argv[i - 1] === '--user') ?? '8e8b4aae-14f4-4e79-8fc3-ec5f37b0579d';
const OUT_DIR = 'out';

// ─── DB ──────────────────────────────────────────────────────────────────────

const client = postgres(DATABASE_URL, { ssl: 'require' });

async function loadDescriptions() {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 13);

  const rows = await client`
    SELECT data->>'description' AS description
    FROM sensor_events
    WHERE user_id = ${USER_ID}
      AND data_type = 'bank_transaction'
      AND timestamp >= ${cutoff.toISOString()}
  `;
  await client.end();
  return rows.map((r) => r.description).filter(Boolean);
}

// ─── Sync algorithm (copy from spending-analyzer.ts) ─────────────────────────

function sharedPrefix(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return a.slice(0, i);
}

function cleanKey(raw) {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[\s\d\-./*]+$/, '')
    .trim();
}

function resolveDescriptionKeysSync(descriptions) {
  const unique = [...new Set(descriptions.map((d) => d.trim()).filter(Boolean))].sort();
  const keyMap = new Map();

  let i = 0;
  while (i < unique.length) {
    const seed = unique[i];
    const members = [seed];
    let prefix = seed;
    let j = i + 1;
    while (j < unique.length) {
      const cp = sharedPrefix(prefix, unique[j]);
      if (cp.length >= 5) {
        members.push(unique[j]);
        prefix = cp;
        j++;
      } else {
        break;
      }
    }
    const canonicalKey = cleanKey(prefix);
    for (const member of members) {
      keyMap.set(member, canonicalKey);
    }
    i = j;
  }
  return keyMap;
}

// ─── LLM algorithm ───────────────────────────────────────────────────────────

async function resolveDescriptionKeysLLM(descriptions) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not found in .env');

  const unique = [...new Set(descriptions.map((d) => d.trim()).filter(Boolean))].sort();

  // Build prefix groups (same logic as sync)
  const groups = [];
  let i = 0;
  while (i < unique.length) {
    const seed = unique[i];
    const members = [seed];
    let prefix = seed;
    let j = i + 1;
    while (j < unique.length) {
      const cp = sharedPrefix(prefix, unique[j]);
      if (cp.length >= 5) {
        members.push(unique[j]);
        prefix = cp;
        j++;
      } else {
        break;
      }
    }
    groups.push({ prefix: prefix.trimEnd(), members });
    i = j;
  }

  const keyMap = new Map();
  const ambiguous = groups.filter((g) => g.members.length > 1);
  const unambiguous = groups.filter((g) => g.members.length === 1);

  for (const g of unambiguous) {
    keyMap.set(g.members[0], g.members[0].toLowerCase().trim());
  }

  console.log(`[LLM] ${ambiguous.length} ambiguous groups to process…`);
  const BATCH = 25;
  for (let i = 0; i < ambiguous.length; i += BATCH) {
    const batch = ambiguous.slice(i, i + BATCH);
    const input = batch.map((g, id) => ({ id, prefixLen: g.prefix.length, samples: g.members.slice(0, 6) }));

    const t0 = Date.now();
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `Du analyserer norske banktransaksjonsbeskrivelser for å finne merchant-nøkler.
Hver gruppe inneholder beskrivelser som deler et felles prefiks og kan være samme merchant.
For hver beskrivelse, returner en kanonisk merchant-nøkkel (lowercase, ingen støy som datoer/referansenumre).
Ulike merchants i samme gruppe skal få ulike nøkler.
Returner JSON: {"results": [{"id": 0, "mappings": [{"desc": "...", "key": "rema 1000"}, ...]}, ...]}`
          },
          { role: 'user', content: JSON.stringify(input) }
        ]
      })
    });

    const json = await res.json();
    const parsed = JSON.parse(json.choices[0].message.content ?? '{}').results ?? [];
    console.log(`[LLM] Batch ${Math.floor(i / BATCH) + 1}: ${Date.now() - t0}ms`);

    for (const g of batch) {
      const resolved = parsed.find((r) => r.id === batch.indexOf(g));
      for (const member of g.members) {
        const match = resolved?.mappings.find((m) => m.desc === member);
        keyMap.set(member, match?.key ?? g.prefix.toLowerCase().trim());
      }
    }
  }

  return keyMap;
}

// ─── Word-prefix algorithm ────────────────────────────────────────────────────

/**
 * Like resolveDescriptionKeysSync but requires BOTH:
 *   charPrefixLen >= minChars  (default 5)
 *   wordPrefixLen >= minWords  (default 2)
 *
 * Requiring 2 shared words eliminates false groupings like
 * BØLER BAD / BØLER ZOO or HOTEL BRISTOL / HOTEL INDIGO,
 * while still grouping COOP MEGA *, REMA 1000 *, S-Bahn Berlin * etc.
 */
function resolveDescriptionKeysWordPrefix(descriptions, minChars = 5, minWords = 2) {
  const unique = [...new Set(descriptions.map((d) => d.trim()).filter(Boolean))].sort();
  const keyMap = new Map();

  // Count how many complete whitespace-separated words two strings share from the left.
  function sharedWordCount(a, b) {
    const raw = sharedPrefix(a, b); // may have a trailing space
    const trimmed = raw.trimEnd();
    if (!trimmed) return 0;
    const words = trimmed.split(/\s+/).filter(Boolean);
    // If raw ended with whitespace, or covers all of either string → clean word boundary
    const atBoundary = raw !== trimmed || raw.length === a.length || raw.length === b.length;
    return atBoundary ? words.length : Math.max(0, words.length - 1);
  }

  let i = 0;
  while (i < unique.length) {
    const seed = unique[i];
    const members = [seed];
    let prefix = seed;
    let j = i + 1;
    while (j < unique.length) {
      const cp = sharedPrefix(prefix, unique[j]);
      const charOk = cp.length >= minChars;
      const wordOk = sharedWordCount(prefix, unique[j]) >= minWords;
      if (charOk && wordOk) {
        members.push(unique[j]);
        prefix = cp;
        j++;
      } else {
        break;
      }
    }
    const canonicalKey = cleanKey(prefix);
    for (const member of members) {
      keyMap.set(member, canonicalKey);
    }
    i = j;
  }
  return keyMap;
}

// ─── CSV helpers ─────────────────────────────────────────────────────────────

function csvRow(...cols) {
  return cols.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

mkdirSync(OUT_DIR, { recursive: true });

console.log(`Loading descriptions for user ${USER_ID}…`);
const descriptions = await loadDescriptions();
console.log(`Loaded ${descriptions.length} descriptions`);

const unique = [...new Set(descriptions.map((d) => d.trim()).filter(Boolean))].sort();
console.log(`${unique.length} unique descriptions`);

// Write input CSV
writeFileSync(
  `${OUT_DIR}/01-input.csv`,
  ['description', ...unique].map((d) => csvRow(d)).join('\n')
);
console.log(`Wrote ${OUT_DIR}/01-input.csv`);

// Run sync (chars only, minChars=5)
const t0 = Date.now();
const syncMap = resolveDescriptionKeysSync(descriptions);
console.log(`Sync (chars≥5) done in ${Date.now() - t0}ms`);

// Run word-prefix (chars≥5 AND words≥2)
const t1 = Date.now();
const wordMap = resolveDescriptionKeysWordPrefix(descriptions, 5, 2);
console.log(`Word-prefix (chars≥5, words≥2) done in ${Date.now() - t1}ms`);

const syncLines = ['description,sync_key,wordprefix_key,sync_vs_word'];
for (const desc of unique) {
  const syncKey = syncMap.get(desc) ?? '';
  const wordKey = wordMap.get(desc) ?? '';
  const differs = syncKey !== wordKey ? 'YES' : '';
  syncLines.push(csvRow(desc, syncKey, wordKey, differs));
}
writeFileSync(`${OUT_DIR}/02-sync-output.csv`, syncLines.join('\n'));
console.log(`Wrote ${OUT_DIR}/02-sync-output.csv`);

// Run LLM if requested
if (RUN_LLM) {
  console.log('Running LLM resolution (this will take a while)…');
  const t1 = Date.now();
  const llmMap = await resolveDescriptionKeysLLM(descriptions);
  console.log(`LLM done in ${Date.now() - t1}ms`);

  const diffLines = ['description,sync_key,wordprefix_key,llm_key,sync_vs_llm,word_vs_llm'];
  for (const desc of unique) {
    const syncKey = syncMap.get(desc) ?? '';
    const wordKey = wordMap.get(desc) ?? '';
    const llmKey = llmMap.get(desc) ?? '';
    diffLines.push(csvRow(desc, syncKey, wordKey, llmKey, syncKey !== llmKey ? 'YES' : '', wordKey !== llmKey ? 'YES' : ''));
  }
  writeFileSync(`${OUT_DIR}/03-diff.csv`, diffLines.join('\n'));
  console.log(`Wrote ${OUT_DIR}/03-diff.csv`);

  const syncDiffs = unique.filter((d) => (syncMap.get(d) ?? '') !== (llmMap.get(d) ?? ''));
  const wordDiffs = unique.filter((d) => (wordMap.get(d) ?? '') !== (llmMap.get(d) ?? ''));
  console.log(`\nSync  vs LLM: ${syncDiffs.length} / ${unique.length} differ`);
  console.log(`Word  vs LLM: ${wordDiffs.length} / ${unique.length} differ`);
} else {
  console.log('\nTip: run with --llm to also generate 03-diff.csv (LLM comparison)');
}
