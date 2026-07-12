/**
 * Livsintervjuet — «hvem vil du være om ett, fem og ti år?»
 *
 * Rene hjelpere for flyten: seksjonsdefinisjoner, verdilinje-parsing fra
 * <status>-blokker, og markdown-formatet destillatet lagres i
 * (reflections, kind 'livsintervju', periodKey = årstall).
 * Stabile overskrifter gjør at neste års re-intervju kan parse årets svar
 * og holde dem opp mot de nye.
 */

import { LIVSKOMPASS_DIMENSIONS } from '$lib/domains/livskompass/dimensions';

export interface LivsintervjuSection {
	id: string;
	heading: string;
}

export const LIVSINTERVJU_SECTIONS: LivsintervjuSection[] = [
	{ id: 'verdier', heading: 'Verdiene mine' },
	{ id: 'ti_aar', heading: 'Om ti år' },
	{ id: 'fem_aar', heading: 'Om fem år' },
	{ id: 'ett_aar', heading: 'Om ett år' },
	// Skrives av onComplete (AI-ens konfrontasjon fra speil-steget), ikke et svar
	{ id: 'speil', heading: 'Speilet' }
];

export type LivsintervjuAnswers = Record<string, string>;

/** Bygg lagringsformatet: én `## overskrift`-seksjon per besvart del */
export function buildLivsintervjuMarkdown(answers: LivsintervjuAnswers): string {
	return LIVSINTERVJU_SECTIONS.filter((s) => answers[s.id]?.trim())
		.map((s) => `## ${s.heading}\n${answers[s.id].trim()}`)
		.join('\n\n');
}

/** Parse lagret markdown tilbake til svar per seksjons-id. Ukjente overskrifter ignoreres. */
export function parseLivsintervjuMarkdown(content: string): LivsintervjuAnswers {
	const headingToId = new Map(LIVSINTERVJU_SECTIONS.map((s) => [s.heading.toLowerCase(), s.id]));
	const answers: LivsintervjuAnswers = {};
	const blocks = content.split(/^## /m);
	for (const block of blocks) {
		const newlineIdx = block.indexOf('\n');
		if (newlineIdx === -1) continue;
		const heading = block.slice(0, newlineIdx).trim().toLowerCase();
		const body = block.slice(newlineIdx + 1).trim();
		const id = headingToId.get(heading);
		if (id && body) answers[id] = body;
	}
	return answers;
}

/**
 * Del verdi-<status>-blokken opp i enkeltverdier — én per linje, kulepunkt
 * strippes, tomme og altfor lange linjer forkastes. Maks 7 (holder memories
 * kuratert i stedet for å dumpe hele blokker).
 */
export function parseValueLines(status: string): string[] {
	return status
		.split('\n')
		.map((line) => line.trim().replace(/^[-*•·]\s*/, ''))
		.filter((line) => line.length >= 3 && line.length <= 200)
		.slice(0, 7);
}

/**
 * Livskompassets 12 dimensjoner gruppert per område — brukes som døråpnere i
 * verdi-steget, så intervjuet dekker hele terrenget uten å bli et skjema.
 */
export function livskompassDoorOpeners(): string {
	const areas = new Map<string, string[]>();
	for (const dim of LIVSKOMPASS_DIMENSIONS) {
		const list = areas.get(dim.area) ?? [];
		list.push(dim.label);
		areas.set(dim.area, list);
	}
	return [...areas.entries()].map(([area, labels]) => `${area}: ${labels.join(', ')}`).join('\n');
}
