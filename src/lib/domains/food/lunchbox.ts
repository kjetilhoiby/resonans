// Matpakke-domenet — ren forslagslogikk for fem daglige matpakker.
// Regelbasert (ikke AI): preferanser inn, allergier/dislikes ut, rotasjon via
// recency-straff, og retur-logg som nedvekter det som kommer tilbake i sekken.

import { mulberry32, seedFromString } from './meal-suggestions';

export type ComponentKind = 'palegg' | 'brod' | 'frukt' | 'gront' | 'notter' | 'annet';

export const KIND_META: Record<ComponentKind, { label: string; emoji: string }> = {
	palegg: { label: 'Pålegg', emoji: '🧀' },
	brod: { label: 'Brød', emoji: '🍞' },
	frukt: { label: 'Frukt', emoji: '🍎' },
	gront: { label: 'Grønt', emoji: '🥕' },
	notter: { label: 'Nøtter', emoji: '🥜' },
	annet: { label: 'Annet', emoji: '🥨' }
};

export type Appetite = 'liten' | 'middels' | 'stor';

/** Antall påleggsskiver per appetittnivå. */
export const APPETITE_SLICES: Record<Appetite, number> = {
	liten: 1,
	middels: 2,
	stor: 3
};

export type LunchboxProfileLike = {
	personId: string;
	likes: string[];
	dislikes: string[];
	allergies: string[];
	appetite: Appetite | string;
};

export type LunchboxComponentLike = {
	id: string;
	name: string;
	kind: ComponentKind | string;
	tags: string[];
};

export type LunchboxEntryLike = {
	personId: string;
	date: string; // ISO
	items: Array<{ componentId?: string; name: string; kind: string }>;
};

export type LunchboxReturnLike = {
	personId: string;
	date: string; // ISO
	componentId?: string | null;
	itemName: string;
	degree: 'alt' | 'mesteparten' | 'noe' | string;
};

export type LunchboxSuggestionItem = {
	componentId: string;
	name: string;
	kind: string;
	reason: string | null;
};

export type LunchboxSuggestion = {
	personId: string;
	date: string;
	items: LunchboxSuggestionItem[];
	sliceCount: number;
};

const RECENCY_WINDOW_DAYS = 14;
const RETURN_WINDOW_DAYS = 30;
const DEGREE_WEIGHT: Record<string, number> = { alt: 1.0, mesteparten: 0.6, noe: 0.3 };

function daysBetween(fromIso: string, toIso: string): number {
	const from = Date.UTC(
		Number(fromIso.slice(0, 4)),
		Number(fromIso.slice(5, 7)) - 1,
		Number(fromIso.slice(8, 10))
	);
	const to = Date.UTC(
		Number(toIso.slice(0, 4)),
		Number(toIso.slice(5, 7)) - 1,
		Number(toIso.slice(8, 10))
	);
	return Math.round((to - from) / 86400000);
}

function norm(s: string): string {
	return s.toLowerCase().trim();
}

/** Matcher et komponentnavn mot en preferanseliste (navn eller tags, case-insensitivt). */
function matchesList(component: LunchboxComponentLike, list: string[]): boolean {
	const name = norm(component.name);
	const tags = component.tags.map(norm);
	return list.some((entry) => {
		const e = norm(entry);
		if (!e) return false;
		return name.includes(e) || e.includes(name) || tags.includes(e);
	});
}

export function scoreComponent(
	component: LunchboxComponentLike,
	input: {
		profile: LunchboxProfileLike;
		recentEntries: LunchboxEntryLike[];
		recentReturns: LunchboxReturnLike[];
		date: string;
	}
): { score: number; excluded: boolean; reason: string | null } {
	// Allergier og dislikes er harde filtre
	if (matchesList(component, input.profile.allergies)) {
		return { score: -Infinity, excluded: true, reason: 'allergi' };
	}
	if (matchesList(component, input.profile.dislikes)) {
		return { score: -Infinity, excluded: true, reason: 'liker ikke' };
	}

	let score = 1.0;
	let reason: string | null = null;

	if (matchesList(component, input.profile.likes)) {
		score += 0.4;
		reason = 'favoritt';
	}

	// Recency-straff: brukt nylig for dette barnet → ned (rotasjon)
	let lastUsedDaysAgo: number | null = null;
	for (const entry of input.recentEntries) {
		if (entry.personId !== input.profile.personId) continue;
		const days = daysBetween(entry.date, input.date);
		if (days < 0 || days > RECENCY_WINDOW_DAYS) continue;
		const usedHere = entry.items.some(
			(item) => item.componentId === component.id || norm(item.name) === norm(component.name)
		);
		if (usedHere && (lastUsedDaysAgo === null || days < lastUsedDaysAgo)) {
			lastUsedDaysAgo = days;
		}
	}
	if (lastUsedDaysAgo !== null) {
		score -= Math.max(0, 1 - lastUsedDaysAgo / 7);
	} else if (!reason) {
		reason = 'ikke brukt på en stund';
	}

	// Retur-straff: kom i retur nylig → ned, vektet etter hvor mye som kom tilbake
	let returnPenalty = 0;
	for (const ret of input.recentReturns) {
		if (ret.personId !== input.profile.personId) continue;
		const days = daysBetween(ret.date, input.date);
		if (days < 0 || days > RETURN_WINDOW_DAYS) continue;
		const matches =
			ret.componentId === component.id || norm(ret.itemName).includes(norm(component.name));
		if (matches) {
			returnPenalty += 0.4 * (DEGREE_WEIGHT[ret.degree] ?? 0.3);
		}
	}
	if (returnPenalty > 0) {
		score -= Math.min(0.8, returnPenalty);
		reason = 'kom i retur sist';
	}

	return { score, excluded: false, reason };
}

/**
 * Foreslå dagens matpakke for ett barn. Deterministisk gitt samme input + seed;
 * ny seed («foreslå noe annet») gir variasjon blant likt scorede komponenter.
 */
export function suggestLunchbox(input: {
	profile: LunchboxProfileLike;
	components: LunchboxComponentLike[];
	recentEntries: LunchboxEntryLike[];
	recentReturns: LunchboxReturnLike[];
	date: string;
	seed?: number;
}): LunchboxSuggestion {
	const rng = mulberry32(input.seed ?? seedFromString(`${input.profile.personId}:${input.date}`));

	const scored = input.components
		.map((component) => ({
			component,
			...scoreComponent(component, input)
		}))
		.filter((s) => !s.excluded)
		.map((s) => ({ ...s, score: s.score + rng() * 0.3 }))
		.sort((a, b) => b.score - a.score || a.component.name.localeCompare(b.component.name, 'nb'));

	const appetite = (input.profile.appetite in APPETITE_SLICES ? input.profile.appetite : 'middels') as Appetite;
	const sliceCount = APPETITE_SLICES[appetite];

	const items: LunchboxSuggestionItem[] = [];
	const pick = (kind: ComponentKind, count: number) => {
		const candidates = scored.filter(
			(s) => s.component.kind === kind && !items.some((i) => i.componentId === s.component.id)
		);
		for (const candidate of candidates.slice(0, count)) {
			items.push({
				componentId: candidate.component.id,
				name: candidate.component.name,
				kind: candidate.component.kind,
				reason: candidate.reason
			});
		}
	};

	// Variasjon: to ulike pålegg når appetitten tilsier ≥2 skiver
	pick('palegg', Math.min(2, sliceCount));
	pick('frukt', 1);
	pick('gront', 1);
	pick('notter', 1);

	return { personId: input.profile.personId, date: input.date, items, sliceCount };
}
