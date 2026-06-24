// Server-side validering/normalisering av kappliste-rader fra klient-input.
import type { CutListRow } from './calc';

function toFiniteNumber(value: unknown, fallback = 0): number {
	const n = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
	return Number.isFinite(n) ? n : fallback;
}

/** Rens en ukjent klient-payload til en trygg liste med kappliste-rader. */
export function sanitizeRows(input: unknown): CutListRow[] {
	if (!Array.isArray(input)) return [];
	const rows: CutListRow[] = [];
	for (const raw of input) {
		if (!raw || typeof raw !== 'object') continue;
		const r = raw as Record<string, unknown>;
		const dimension = typeof r.dimension === 'string' ? r.dimension.slice(0, 40) : '';
		rows.push({
			id: typeof r.id === 'string' && r.id ? r.id : crypto.randomUUID(),
			dimension,
			lengthCm: Math.max(0, Math.round(toFiniteNumber(r.lengthCm))),
			quantity: Math.max(0, Math.round(toFiniteNumber(r.quantity))),
			meterPriceNok: Math.max(0, toFiniteNumber(r.meterPriceNok))
		});
	}
	return rows.slice(0, 100);
}
