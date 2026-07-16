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
 * Kildemateriale til intervjuet (f.eks. Balanse-tråden fra ChatGPT): fersk
 * innliming fra kilde-steget prioriteres, ellers tidligere import fra
 * konteksten. Trimmes og kuttes for prompt-bruk — fullteksten lagres alltid
 * i originalformat (reflection 'livsintervju_kilde').
 */
export function resolveKilde(data: Record<string, unknown>, maxChars = 8000): string {
	const fersk = typeof data.kilde === 'string' ? data.kilde.trim() : '';
	const importert = typeof data._kildemateriale === 'string' ? data._kildemateriale.trim() : '';
	const kilde = fersk || importert;
	if (!kilde) return '';
	return kilde.length > maxChars
		? `${kilde.slice(0, maxChars).trimEnd()} … [forkortet — fullteksten er lagret]`
		: kilde;
}

// ── Steg-prompter og segmentering av den varige samtalen ────────────────────
// autoSend-prompten for hvert chat-steg lagres som brukermelding i DB-samtalen.
// De statiske tekstene brukes både av flow-definisjonen (registry) og til å
// segmentere samtalen tilbake til steg-tråder ved recovery — DB er fasit,
// localStorage-utkastet bare en kopi.

export const LIVSINTERVJU_STEP_PROMPTS: Array<{ stepId: string; prompt: string }> = [
	{ stepId: 'verdier', prompt: 'Jeg er klar for livsintervjuet. La oss begynne med hva som faktisk er viktig for meg.' },
	{ stepId: 'ti_aar', prompt: 'Nå vil jeg se langt frem. Hvem vil jeg være om ti år?' },
	{ stepId: 'fem_aar', prompt: 'Og om fem år — hvor må jeg være da?' },
	{ stepId: 'ett_aar', prompt: 'Om ett år, da — hva skal faktisk være annerledes?' },
	{ stepId: 'speil', prompt: 'Her er retningen min. Hold den opp mot meg — hva ser du?' }
];

/** Oppslag: autoSend-prompt for et gitt steg (kaster ved ukjent steg — programmeringsfeil). */
export function livsintervjuStepPrompt(stepId: string): string {
	const entry = LIVSINTERVJU_STEP_PROMPTS.find((s) => s.stepId === stepId);
	if (!entry) throw new Error(`Ukjent livsintervju-steg: ${stepId}`);
	return entry.prompt;
}

export interface ConversationMsg {
	role: 'user' | 'assistant';
	content: string;
}

/**
 * Segmenter en varig flow-samtale tilbake til steg-tråder: en brukermelding som
 * eksakt matcher en steg-prompt starter et nytt segment for det steget (prompten
 * selv utelates — autoSend vises ikke i chat-tråden). Historiske omstarter ga
 * duplikate prompter; da vinner det lengste segmentet per steg.
 */
export function segmentConversationBySteps(
	messages: ConversationMsg[],
	stepPrompts: Array<{ stepId: string; prompt: string }> = LIVSINTERVJU_STEP_PROMPTS
): Record<string, ConversationMsg[]> {
	const promptToStep = new Map(stepPrompts.map((s) => [s.prompt.trim(), s.stepId]));
	const segments: Record<string, ConversationMsg[]> = {};

	let currentStepId: string | null = null;
	let currentSegment: ConversationMsg[] = [];

	const commit = () => {
		if (!currentStepId) return;
		const existing = segments[currentStepId];
		if (!existing || currentSegment.length > existing.length) {
			segments[currentStepId] = currentSegment;
		}
	};

	for (const msg of messages) {
		const stepId = msg.role === 'user' ? promptToStep.get(msg.content.trim()) : undefined;
		if (stepId) {
			commit();
			currentStepId = stepId;
			currentSegment = [];
			continue; // prompten selv skal ikke inn i tråden
		}
		if (currentStepId) currentSegment.push(msg);
	}
	commit();

	return segments;
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
