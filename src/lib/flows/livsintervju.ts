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
import { validatePriorities, type Priority } from '$lib/domains/livskompass/ranking';
import type { GoalKind } from '$lib/domain/goals/goal-kind';

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

// ── Målbare langtidsmål fra speil-steget ─────────────────────────────────────

export interface LongTermGoal {
	title: string;
	value: number | null;
	unit: string | null;
	/** Målåret, f.eks. 2031 */
	year: number | null;
	/**
	 * Arten speilet foreslo, eller null.
	 *
	 * Null er ikke «ukjent art» som et tap — det er regelen fra `goal-kind.ts`:
	 * en metrikk BEVISER at målet er kontrollert, fravær av markør beviser
	 * ingenting, og `inferGoalKind` avgjør resten. Vi gjetter ikke her heller.
	 */
	kind?: GoalKind | null;
}

/** Markørene speilet bruker for målart. Ukjent markør ignoreres, den gjetter ikke. */
const KIND_MARKERS: Record<string, GoalKind> = {
	styrer: 'kontrollert',
	tilrettelegger: 'tilrettelagt'
};

/**
 * Hent foreslåtte langtidsmål fra speil-meldingen — linjene mellom
 * <langtidsmål>-markørene. Format «Tittel: 80 kg innen 2031»; linjer uten
 * tall blir intensjonsmål uten verdi. Maks 5. Tom liste uten markører
 * (bevisst strengt, så løs prosa aldri blir mål).
 *
 * En valgfri `[styrer]`/`[tilrettelegger]`-markør foran linja bærer MÅLARTEN.
 * Den står i en egen klamme og ikke i tittelen fordi tittelen er det brukeren
 * leser: «[tilrettelegger] Mer aktive vennskap» skal bli målet «Mer aktive
 * vennskap», ikke et mål som heter det med en etikett i.
 */
export function parseLongTermGoals(message: string): LongTermGoal[] {
	const match = message.match(/<langtidsmål>([\s\S]*?)<\/langtidsmål>/i);
	if (!match) return [];
	const goals: LongTermGoal[] = [];
	for (const raw of match[1].split('\n')) {
		let line = raw.trim().replace(/^[-*•·]\s*/, '');
		if (!line || line.length > 200) continue;

		// Målart-markøren strippes FØR alt annet, så tittelen blir brukerens ord
		let kind: GoalKind | null = null;
		const kindMatch = line.match(/^\[([a-zæøå]+)\]\s*/i);
		if (kindMatch) {
			kind = KIND_MARKERS[kindMatch[1].toLowerCase()] ?? null;
			line = line.slice(kindMatch[0].length).trim();
		}
		if (!line || line.length > 160) continue;

		// «innen ÅÅÅÅ» på slutten (valgfritt)
		const yearMatch = line.match(/\binnen\s+(\d{4})\s*$/i);
		const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
		const withoutYear = yearMatch ? line.slice(0, yearMatch.index).trim() : line;

		const m = withoutYear.match(/^(.+?):\s*(\d+(?:[.,]\d+)?)\s*(.*)$/);
		if (m) {
			goals.push({
				title: m[1].trim(),
				value: parseFloat(m[2].replace(',', '.')),
				unit: m[3].trim() || null,
				year,
				kind
			});
		} else {
			goals.push({
				title: withoutYear.replace(/:$/, '').trim(),
				value: null,
				unit: null,
				year,
				kind
			});
		}
	}
	return goals.slice(0, 5);
}

/** Utled visjonshorisont fra målår: ≤18 mnd → i år, ≤6 år → fem år, ellers ti år. */
export function horizonForYear(
	year: number | null,
	now = new Date()
): 'vision_yearly' | 'vision_5year' | 'vision_10year' {
	if (!year) return 'vision_5year';
	// Regn til slutten av målåret
	const monthsAway = (year - now.getFullYear()) * 12 + (11 - now.getMonth());
	if (monthsAway <= 18) return 'vision_yearly';
	if (monthsAway <= 72) return 'vision_5year';
	return 'vision_10year';
}

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

// ── Rekkefølgen fra speil-steget ────────────────────────────────────────────

/**
 * Hent prioriteringene fra speil-meldingen — linjene mellom
 * <prioritering>-markørene, i den rekkefølgen de står.
 *
 * Formen er «Etikett — begrunnelse», og separatoren godtas i fire varianter
 * fordi en språkmodell veksler mellom tankestrek, bindestrek og kolon uten at
 * meningen endrer seg. Nummerering foran strippes: RANGEN ER POSISJONEN
 * (`ranking.ts`), så et tall i teksten er en andre kilde til samme faktum, og
 * en modell som hopper fra «2.» til «4.» skal ikke kunne lage et hull.
 *
 * Valideringen er den samme som endepunktet bruker — inkludert taket på fem og
 * forankringen i livskompasset. Er lista ugyldig (for lang, duplikater),
 * returneres den tomme lista framfor en halv rekkefølge: en rangering som har
 * mistet et ledd, er verre enn ingen.
 */
export function parseRankingBlock(message: string): Priority[] {
	const match = message.match(/<prioritering>([\s\S]*?)<\/prioritering>/i);
	if (!match) return [];

	const raw: Array<{ label: string; why: string }> = [];
	for (const line of match[1].split('\n')) {
		const cleaned = line
			.trim()
			.replace(/^[-*•·]\s*/, '')
			.replace(/^\d+[.)]\s*/, '')
			.trim();
		if (!cleaned) continue;
		const split = cleaned.match(/^(.+?)\s*(?:—|–|\s-\s|:)\s*(.+)$/);
		if (split) {
			raw.push({ label: split[1].trim(), why: split[2].trim() });
		} else {
			raw.push({ label: cleaned, why: '' });
		}
	}

	const validated = validatePriorities(raw);
	return validated.ok ? validated.value : [];
}

// ── Konteksten inn i flyten ─────────────────────────────────────────────────

export interface LivsintervjuContext {
	eksisterendeRetning?: string;
	verdierNaa?: string;
	forrigeIntervju?: string;
	kildemateriale?: string;
	/** Livskompasset som målt materiale (`describeLivskompassMaterial`). */
	livskompass?: string;
	/** Rekkefølgen slik den står nå — skal testes, ikke skrives på nytt blindt. */
	rangeringNaa?: string;
}

/**
 * Oversett `/api/retning/interview-context` til flytens `initialData`.
 *
 * Delt fordi den samme oversettelsen står i to knapper — hjemskjermen og
 * Retning-fanen — og et felt lagt til ett sted ville blitt usynlig fra det
 * andre. Symptomet er da at intervjuet oppfører seg ulikt ut fra hvor det ble
 * startet, uten at noe sier fra.
 */
export function livsintervjuInitialData(ctx: LivsintervjuContext): Record<string, string> {
	return {
		_eksisterendeRetning: ctx.eksisterendeRetning ?? '',
		_verdierNaa: ctx.verdierNaa ?? '',
		_forrigeIntervju: ctx.forrigeIntervju ?? '',
		_kildemateriale: ctx.kildemateriale ?? '',
		_livskompass: ctx.livskompass ?? '',
		_rangeringNaa: ctx.rangeringNaa ?? ''
	};
}
