#!/usr/bin/env node
/**
 * Backfill av embeddings for eksisterende memories og reflections
 * (embedding IS NULL). Idempotent — kan kjøres flere ganger; hopper over
 * rader som allerede har embedding. Kjøres manuelt (ikke i deploy-pipelinen,
 * siden den kaller OpenAI):
 *
 *   DATABASE_URL=... OPENAI_API_KEY=... node scripts/backfill-embeddings.mjs
 */
import postgres from 'postgres';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const MAX_INPUT_CHARS = 8000;
const BATCH_SIZE = 50;

const databaseUrl = process.env.DATABASE_URL;
const apiKey = process.env.OPENAI_API_KEY;
if (!databaseUrl || !apiKey) {
	console.error('Krever DATABASE_URL og OPENAI_API_KEY');
	process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1 });

async function embedBatch(texts) {
	const res = await fetch('https://api.openai.com/v1/embeddings', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
		body: JSON.stringify({
			model: EMBEDDING_MODEL,
			input: texts.map((t) => t.slice(0, MAX_INPUT_CHARS))
		})
	});
	if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
	const json = await res.json();
	// API-et returnerer i input-rekkefølge, men sorter på index for sikkerhets skyld
	return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

async function backfillTable(table) {
	let total = 0;
	for (;;) {
		const rows = await sql`
			SELECT id, content FROM ${sql(table)}
			WHERE embedding IS NULL AND content <> ''
			ORDER BY created_at
			LIMIT ${BATCH_SIZE}
		`;
		if (rows.length === 0) break;

		const embeddings = await embedBatch(rows.map((r) => r.content));
		for (let i = 0; i < rows.length; i++) {
			await sql`
				UPDATE ${sql(table)}
				SET embedding = ${JSON.stringify(embeddings[i])}::vector
				WHERE id = ${rows[i].id} AND embedding IS NULL
			`;
		}
		total += rows.length;
		console.log(`Backfillet ${total} ${table} …`);
	}
	console.log(`Ferdig — ${total} ${table} fikk embedding.`);
}

await backfillTable('memories');
await backfillTable('reflections');
await sql.end();
