// Server-side validering/normalisering av kappliste-materialer fra klient-input.
import type { Material, CutSpec } from './calc';

function toFiniteNumber(value: unknown, fallback = 0): number {
	const n = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
	return Number.isFinite(n) ? n : fallback;
}

function sanitizeCut(raw: unknown): CutSpec | null {
	if (!raw || typeof raw !== 'object') return null;
	const c = raw as Record<string, unknown>;
	const cut: CutSpec = {
		id: typeof c.id === 'string' && c.id ? c.id : crypto.randomUUID(),
		quantity: Math.max(0, Math.round(toFiniteNumber(c.quantity)))
	};
	if ('lengthMm' in c) cut.lengthMm = Math.max(0, Math.round(toFiniteNumber(c.lengthMm)));
	if ('widthMm' in c) cut.widthMm = Math.max(0, Math.round(toFiniteNumber(c.widthMm)));
	if ('heightMm' in c) cut.heightMm = Math.max(0, Math.round(toFiniteNumber(c.heightMm)));
	return cut;
}

/** Rens en ukjent klient-payload til en trygg liste med materialer. */
export function sanitizeMaterials(input: unknown): Material[] {
	if (!Array.isArray(input)) return [];
	const materials: Material[] = [];
	for (const raw of input) {
		if (!raw || typeof raw !== 'object') continue;
		const m = raw as Record<string, unknown>;
		const kind = m.kind === 'sheet' ? 'sheet' : 'linear';
		const cuts = Array.isArray(m.cuts)
			? (m.cuts.map(sanitizeCut).filter(Boolean) as CutSpec[]).slice(0, 100)
			: [];
		const material: Material = {
			id: typeof m.id === 'string' && m.id ? m.id : crypto.randomUUID(),
			name: typeof m.name === 'string' ? m.name.slice(0, 80) : '',
			kind,
			cuts
		};
		if (typeof m.woodType === 'string' && m.woodType.trim()) material.woodType = m.woodType.trim().slice(0, 40);
		if (typeof m.treatment === 'string' && m.treatment.trim()) material.treatment = m.treatment.trim().slice(0, 40);
		if ('thicknessMm' in m && m.thicknessMm != null) material.thicknessMm = Math.max(0, toFiniteNumber(m.thicknessMm));
		if ('crossWidthMm' in m && m.crossWidthMm != null) material.crossWidthMm = Math.max(0, Math.round(toFiniteNumber(m.crossWidthMm)));
		if (kind === 'linear') {
			material.stockLengthMm = Math.max(0, Math.round(toFiniteNumber(m.stockLengthMm, 3900)));
			material.pricePerMeterNok = Math.max(0, toFiniteNumber(m.pricePerMeterNok));
		} else {
			material.stockWidthMm = Math.max(0, Math.round(toFiniteNumber(m.stockWidthMm, 2440)));
			material.stockHeightMm = Math.max(0, Math.round(toFiniteNumber(m.stockHeightMm, 1220)));
			material.pricePerSquareMeterNok = Math.max(0, toFiniteNumber(m.pricePerSquareMeterNok));
		}
		materials.push(material);
	}
	return materials.slice(0, 50);
}
