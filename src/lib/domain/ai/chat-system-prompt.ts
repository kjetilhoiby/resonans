/**
 * Hovedchattens systemmelding: blokkene i rekkefølge, og lengden på hver.
 *
 * Blokkene bygges i `routes/api/chat/+server.ts` (de fleste fra databasen);
 * her bor bare hvordan de settes sammen. Det lå som én lang `+`-kjede i ruta
 * fram til oktober 2026, ved siden av en egen liste over de samme blokkene til
 * «promptens anatomi» — to steder som måtte nevne de samme navnene i hver sin
 * rekkefølge. Nå er rekkefølgen ÉN liste, og anatomien regnes av den.
 *
 * Stemmegaffel (`resonans-lab/stemmegaffel`) bruker funksjonen til å sette
 * sammen syntetiske og opptatte kall på samme måte som ruta. En blokk lagt til
 * i ruta uten å stå her, når derfor ikke modellen — og testen sier fra.
 */

import type { PromptPart, PromptPartName } from '$lib/domain/chat-perf-stats';

/** Blokkene, i den rekkefølgen modellen leser dem. */
export const SYSTEM_PROMPT_BLOCKS = [
	'prefix',
	'base',
	'memory',
	'persons',
	'goals',
	'checklists',
	'contacts',
	'procedures',
	'source',
	'date',
	'day',
	'ferie',
	'health'
] as const;

export type SystemPromptBlock = (typeof SYSTEM_PROMPT_BLOCKS)[number];

/** Navnene i `chat_perf_samples.promptParts`. De er lagret, så de endres ikke. */
const PART_NAMES: Record<SystemPromptBlock, PromptPartName> = {
	prefix: 'prefiks',
	base: 'grunnprompt',
	memory: 'minne',
	persons: 'personer',
	goals: 'mål',
	checklists: 'sjekklister',
	contacts: 'kontakter',
	procedures: 'fremgangsmåter',
	source: 'kilde',
	date: 'dato',
	day: 'dag',
	ferie: 'ferie',
	health: 'helse'
};

export interface AssembledSystemPrompt {
	content: string;
	/** Lengden på hver blokk, aldri innholdet. Tomme blokker er med som 0. */
	parts: PromptPart[];
}

/**
 * Setter sammen systemmeldingen. Blokkene limes rett etter hverandre — hver
 * blokk bærer sine egne linjeskift, som i ruta — bortsett fra prefikset, som
 * får en tom linje etter seg når det finnes.
 */
export function assembleSystemPrompt(blocks: Partial<Record<SystemPromptBlock, string>>): AssembledSystemPrompt {
	const text = (block: SystemPromptBlock): string => {
		const value = blocks[block] ?? '';
		return block === 'prefix' && value ? `${value}\n\n` : value;
	};
	return {
		content: SYSTEM_PROMPT_BLOCKS.map(text).join(''),
		parts: SYSTEM_PROMPT_BLOCKS.map((block) => ({ name: PART_NAMES[block], chars: text(block).length }))
	};
}
