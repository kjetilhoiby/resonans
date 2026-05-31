/**
 * screen-time-parser.ts
 *
 * Tolker iOS Skjermtid-skjermbilder via GPT-4o vision. Skiller mellom:
 *  - ukesbilde ("Uke"-fanen): per-dag totaler + ukens kategori-totaler + topp-apper
 *  - dagsbilde  ("Dag"-fanen): dato + dagstotal + kategori-totaler + time-for-time + apper
 *
 * Returnerer normaliserte minutter (ikke «7t 3m»-strenger) klart for lagring.
 */

import { openai } from '$lib/server/openai';
import {
	normalizeCategories,
	type ScreenTimeCategories,
	type ScreenTimeDailyData,
	type ScreenTimeWeeklyData,
	type ScreenTimeHourBucket
} from './screen-time';

export type ParsedScreenTime =
	| { kind: 'weekly'; weekly: ScreenTimeWeeklyData; rawDate?: string; confidence: 'low' | 'medium' | 'high' }
	| { kind: 'daily'; daily: ScreenTimeDailyData; dateISO?: string; confidence: 'low' | 'medium' | 'high' }
	| { kind: 'unknown'; reason: string };

const SYSTEM_PROMPT = `Du tolker skjermbilder fra iOS «Skjermtid» (norsk). Returner KUN gyldig JSON.

Skjermbildet er enten et UKESBILDE eller et DAGSBILDE:
- UKESBILDE ("Uke"-fane): viser «Forrige ukes snitt», en søylegraf med 7 dager (M T O T F L S),
  «Skjermtid totalt», kategori-totaler (f.eks. Sosialt, Produktivitet og finans, Annet) og «Mest brukt»-apper.
- DAGSBILDE ("Dag"-fane): viser en bestemt dato (f.eks. «fredag 29. mai»), dagens totale skjermtid,
  en time-for-time-graf (00–24), kategori-totaler for dagen og «Mest brukt»-apper.

Konverter ALLE tider til antall MINUTTER (heltall). «7t 3m» = 423. «36m» = 36. «1t» = 60.

Svar med dette JSON-skjemaet (utelat felter du ikke ser):
{
  "kind": "weekly" | "daily" | "unknown",
  "confidence": "low" | "medium" | "high",
  "weekly": {
    "weekTotalMinutes": number,
    "avgPerDayMinutes": number,
    "percentChange": number,          // fortegn fra «X % fra forrige uke», opp=+, ned=-
    "categories": { "<norsk kategorinavn>": minutter, ... },
    "apps": { "<appnavn>": minutter, ... },
    "dailyTotals": [man, tir, ons, tor, fre, lør, søn]  // minutter, 7 tall hvis lesbart
  },
  "daily": {
    "dateLabel": "fredag 29. mai",    // teksten øverst, så nært originalen som mulig
    "totalMinutes": number,
    "categories": { "<norsk kategorinavn>": minutter, ... },
    "apps": { "<appnavn>": minutter, ... },
    "hourly": [ { "hour": 0..23, "totalMinutes": number, "categories": { "<navn>": minutter } } ]
  }
}

Regler:
- For dagsbildet: les time-for-time-grafen så godt du kan og fyll "hourly". Hver stolpe ~ én time.
  Hvis kategorifargene ikke kan skilles per time, utelat "categories" på timenivå, men oppgi alltid "totalMinutes" og "hour".
- For ukesbildet kan «dailyTotals» være vanskelig å lese eksakt — estimer fra søylehøydene relativt til snittlinjen om nødvendig, ellers utelat.
- Hvis bildet ikke er et iOS Skjermtid-bilde: { "kind": "unknown", "confidence": "low" }.
- Returner KUN JSON, ingen forklaring.`;

function coerceNumber(v: unknown): number | undefined {
	if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
	if (typeof v === 'string') {
		const n = Number.parseFloat(v.replace(',', '.'));
		if (Number.isFinite(n)) return Math.round(n);
	}
	return undefined;
}

function coerceApps(raw: unknown): Record<string, number> | undefined {
	if (!raw || typeof raw !== 'object') return undefined;
	const out: Record<string, number> = {};
	for (const [name, val] of Object.entries(raw as Record<string, unknown>)) {
		const n = coerceNumber(val);
		if (n !== undefined && n > 0) out[name.trim()] = n;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

function coerceHourly(raw: unknown): ScreenTimeHourBucket[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const out: ScreenTimeHourBucket[] = [];
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue;
		const rec = item as Record<string, unknown>;
		const hour = coerceNumber(rec.hour ?? rec.h ?? rec.time);
		// Godta vanlige alias modellen kan finne på (totalMinutes/minutes/min/value/minutter).
		const totalMinutes = coerceNumber(
			rec.totalMinutes ?? rec.minutes ?? rec.min ?? rec.minutter ?? rec.value
		);
		if (hour === undefined || hour < 0 || hour > 23 || totalMinutes === undefined) continue;
		const categories = normalizeCategories(rec.categories as Record<string, number> | undefined);
		out.push({ hour, totalMinutes: Math.max(0, totalMinutes), ...(categories ? { categories } : {}) });
	}
	return out.length > 0 ? out : undefined;
}

const MONTHS_NO: Record<string, number> = {
	januar: 1, februar: 2, mars: 3, april: 4, mai: 5, juni: 6,
	juli: 7, august: 8, september: 9, oktober: 10, november: 11, desember: 12
};

/** «fredag 29. mai» → 'YYYY-MM-DD' (år utledet, antar nær i tid mht. referansedato). */
export function parseNorwegianDateLabel(label: string | undefined, ref: Date = new Date()): string | undefined {
	if (!label) return undefined;
	const m = label.toLowerCase().match(/(\d{1,2})\.?\s+(januar|februar|mars|april|mai|juni|juli|august|september|oktober|november|desember)/);
	if (!m) return undefined;
	const day = Number.parseInt(m[1], 10);
	const month = MONTHS_NO[m[2]];
	if (!month || day < 1 || day > 31) return undefined;
	let year = ref.getFullYear();
	// Hvis datoen ligger mer enn ~2 måneder fram i tid, anta forrige år.
	const candidate = new Date(year, month - 1, day);
	if (candidate.getTime() - ref.getTime() > 60 * 86400000) year -= 1;
	return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export async function parseScreenTimeImage(imageUrl: string, ref: Date = new Date()): Promise<ParsedScreenTime> {
	let parsed: Record<string, unknown>;
	try {
		const response = await openai.chat.completions.create({
			model: 'gpt-4o',
			max_tokens: 1800,
			temperature: 0.1,
			response_format: { type: 'json_object' },
			messages: [
				{ role: 'system', content: SYSTEM_PROMPT },
				{
					role: 'user',
					content: [
						{ type: 'text', text: 'Tolk dette iOS Skjermtid-skjermbildet.' },
						{ type: 'image_url', image_url: { url: imageUrl, detail: 'high' } }
					]
				}
			]
		});
		const content = response.choices[0]?.message?.content ?? '{}';
		parsed = JSON.parse(content);
	} catch (err) {
		console.error('[screen-time-parser] vision/JSON failed:', err);
		return { kind: 'unknown', reason: 'Klarte ikke å tolke bildet.' };
	}

	const kind = parsed.kind === 'weekly' ? 'weekly' : parsed.kind === 'daily' ? 'daily' : 'unknown';
	const confidence =
		parsed.confidence === 'high' || parsed.confidence === 'medium' || parsed.confidence === 'low'
			? (parsed.confidence as 'low' | 'medium' | 'high')
			: 'medium';

	if (kind === 'unknown') {
		return { kind: 'unknown', reason: 'Ikke gjenkjent som et iOS Skjermtid-bilde.' };
	}

	if (kind === 'weekly') {
		const w = (parsed.weekly ?? {}) as Record<string, unknown>;
		const categories: ScreenTimeCategories | undefined = normalizeCategories(
			w.categories as Record<string, number> | undefined
		);
		const dailyTotalsRaw = Array.isArray(w.dailyTotals) ? w.dailyTotals : undefined;
		const dailyTotals = dailyTotalsRaw
			?.map((v) => coerceNumber(v))
			.map((v) => (v === undefined ? 0 : Math.max(0, v)));
		return {
			kind: 'weekly',
			confidence,
			weekly: {
				weekTotalMinutes: coerceNumber(w.weekTotalMinutes),
				avgPerDayMinutes: coerceNumber(w.avgPerDayMinutes),
				percentChange: coerceNumber(w.percentChange),
				categories,
				apps: coerceApps(w.apps),
				dailyTotals: dailyTotals && dailyTotals.length > 0 ? dailyTotals : undefined,
				sourceImageUrl: imageUrl
			}
		};
	}

	const d = (parsed.daily ?? {}) as Record<string, unknown>;
	const dateISO = parseNorwegianDateLabel(typeof d.dateLabel === 'string' ? d.dateLabel : undefined, ref);
	return {
		kind: 'daily',
		confidence,
		dateISO,
		daily: {
			totalMinutes: coerceNumber(d.totalMinutes) ?? 0,
			captureType: 'daily',
			categories: normalizeCategories(d.categories as Record<string, number> | undefined),
			apps: coerceApps(d.apps),
			hourly: coerceHourly(d.hourly),
			sourceImageUrl: imageUrl
		}
	};
}
