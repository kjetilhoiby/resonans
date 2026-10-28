/**
 * Hvilke verktøy MCP-serveren eksponerer, og hvordan de merkes.
 *
 * Settet er assistentens (`ASSISTANT_TOOLS`), altså det samme som Ekko bruker —
 * beskrivelsene og skjemaene bor på verktøymodulene og gjenbrukes, så Claude og
 * ChatGPT får samme instrukser som de to andre flatene. Skriv aldri et
 * MCP-spesifikt skjema ved siden av; se «Skriv ALDRI av et verktøyskjema» i
 * CLAUDE.md.
 *
 * Quiz og forteller er ute: de er lekene i Ekkos bil-modus og holder tilstand
 * per tur gjennom en stemme-samtale, ikke noe en chat-klient har bruk for.
 */

import { ASSISTANT_TOOLS, type AssistantTool } from '$lib/server/assistant/tools';
import { QUIZ_ASSISTANT_TOOLS } from '$lib/server/assistant/quiz-tools';
import { STORY_ASSISTANT_TOOLS } from '$lib/server/assistant/story-tools';

const EXCLUDED = new Set(
	[...QUIZ_ASSISTANT_TOOLS, ...STORY_ASSISTANT_TOOLS].map((tool) => tool.definition.function.name)
);

export const MCP_TOOLS: AssistantTool[] = ASSISTANT_TOOLS.filter(
	(tool) => !EXCLUDED.has(tool.definition.function.name)
);

/** Lese-verktøy uten et `query_`/`find_`-prefiks. */
const READ_ONLY_NAMES = new Set([
	'programList',
	'programDetail',
	'programToday',
	'recentSessions',
	'athleteContext',
	'dayPlan',
	'weather_forecast',
	'driving_route',
	'nearby_chargers'
]);

const OPEN_WORLD_NAMES = new Set(['weather_forecast', 'driving_route', 'nearby_chargers']);

export interface McpToolAnnotations {
	readOnlyHint: boolean;
	destructiveHint: boolean;
	openWorldHint: boolean;
}

/**
 * Hintene klientene bruker til å avgjøre om de skal be brukeren bekrefte.
 *
 * `manage_*` kan slette (vektmålinger, oppgaver, oppskrifter), og regnes derfor
 * som destruktive. Det er grensa som erstatter `AssistantTurnState` her: Ekko
 * nekter å slette en vektmåling funnet i SAMME tur, men en MCP-forespørsel er
 * ett verktøykall, så «samme tur» finnes ikke på serveren. Bekreftelsen må komme
 * fra klienten, og den spør når hintet sier destruktiv.
 */
export function toolAnnotations(name: string): McpToolAnnotations {
	const readOnly = /^(query_|find_)/.test(name) || READ_ONLY_NAMES.has(name);
	return {
		readOnlyHint: readOnly,
		destructiveHint: !readOnly && name.startsWith('manage_'),
		openWorldHint: OPEN_WORLD_NAMES.has(name)
	};
}
