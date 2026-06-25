// Katalog og hjelpere for materiale-velgeren (modalen). Rene funksjoner — ingen DB.
//
// Tresort/behandling er valg-alternativer i nedtrekk. Presets («chips») er IKKE
// herfra: de utledes fra brukerens egne, tidligere brukte materialer (derivePresets).

import type { Material } from './calc';

/** Tresort/platetype — valg i modalen (plate kombinerer ofte platetype + treslag). */
export const WOOD_TYPES: string[] = [
	'Gran',
	'Furu',
	'Eik',
	'Ask',
	'Lerk',
	'Bjørk',
	'Osp',
	'Sedertre',
	'Kryssfiner furu',
	'Kryssfiner bjørk',
	'Kryssfiner poppel',
	'Gips',
	'OSB',
	'Sponplate',
	'MDF',
	'Huntonitt'
];

/** Behandling — valg i modalen. */
export const TREATMENTS: string[] = [
	'Ubehandlet',
	'Høvlet',
	'Trykkimpregnert',
	'Royalimpregnert',
	'Grunnet',
	'Ferdigmalt',
	'Brannimpregnert',
	'Oljet'
];

/** Genrerer et lesbart materialnavn fra valgene. Tom behandling/"Ubehandlet" utelates. */
export function materialDisplayName(m: {
	kind: 'linear' | 'sheet';
	woodType?: string;
	treatment?: string;
	thicknessMm?: number;
	crossWidthMm?: number;
}): string {
	const parts: string[] = [];
	if (m.kind === 'sheet') {
		if (m.thicknessMm && m.thicknessMm > 0) parts.push(`${m.thicknessMm} mm`);
	} else if (m.thicknessMm && m.crossWidthMm) {
		parts.push(`${m.thicknessMm}×${m.crossWidthMm}`);
	}
	if (m.woodType) parts.push(m.woodType.toLowerCase());
	if (m.treatment && m.treatment !== 'Ubehandlet') parts.push(m.treatment.toLowerCase());
	return parts.join(' ').trim();
}

/** Stabil nøkkel for å deduplisere materialer på tvers av kapplister. */
export function presetKey(m: Material): string {
	const dims =
		m.kind === 'sheet'
			? `${m.thicknessMm ?? ''}:${m.stockWidthMm ?? ''}x${m.stockHeightMm ?? ''}`
			: `${m.thicknessMm ?? ''}x${m.crossWidthMm ?? ''}:${m.stockLengthMm ?? ''}`;
	return [
		m.kind,
		(m.name ?? '').trim().toLowerCase(),
		(m.woodType ?? '').trim().toLowerCase(),
		(m.treatment ?? '').trim().toLowerCase(),
		dims
	].join('|');
}

/**
 * Utled valgbare presets fra brukerens tidligere brukte materialer.
 * Tar et navn (eller tresort) — tomme materialer hoppes over — og dedupliserer.
 * Nyeste først (input forventes i kronologisk rekkefølge).
 */
export function derivePresets(materials: Material[], limit = 24): Material[] {
	const seen = new Set<string>();
	const out: Material[] = [];
	for (const m of materials) {
		const named = (m.name ?? '').trim() || (m.woodType ?? '').trim();
		if (!named) continue;
		const key = presetKey(m);
		if (seen.has(key)) continue;
		seen.add(key);
		// Lagre som et «rent» preset uten kapp/id — brukes som mal.
		out.push({
			id: '',
			name: m.name ?? '',
			kind: m.kind,
			woodType: m.woodType,
			treatment: m.treatment,
			thicknessMm: m.thicknessMm,
			crossWidthMm: m.crossWidthMm,
			stockLengthMm: m.stockLengthMm,
			pricePerMeterNok: m.pricePerMeterNok,
			stockWidthMm: m.stockWidthMm,
			stockHeightMm: m.stockHeightMm,
			pricePerSquareMeterNok: m.pricePerSquareMeterNok,
			cuts: []
		});
	}
	return out.slice(0, limit);
}
