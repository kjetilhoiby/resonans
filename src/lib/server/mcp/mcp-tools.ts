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
import { adaptSharedTool } from '$lib/server/assistant/shared-tools';
import { queryPlanTool } from '$lib/ai/tools/query-plan';
import { managePlanItemTool } from '$lib/ai/tools/manage-plan-item';
import { queryAgendaTool } from '$lib/ai/tools/query-agenda';
import { queryRoutinesTool } from '$lib/ai/tools/query-routines';
import { queryGoalsTool } from '$lib/ai/tools/query-goals';
import { manageGoalTaskTool } from '$lib/ai/tools/manage-goal-task';
import { queryDirectionTool } from '$lib/ai/tools/query-direction';
import { saveDirectionConversationTool } from '$lib/ai/tools/save-direction-conversation';
import { QUIZ_ASSISTANT_TOOLS } from '$lib/server/assistant/quiz-tools';
import { STORY_ASSISTANT_TOOLS } from '$lib/server/assistant/story-tools';

const EXCLUDED = new Set(
	[...QUIZ_ASSISTANT_TOOLS, ...STORY_ASSISTANT_TOOLS].map((tool) => tool.definition.function.name)
);

/**
 * Planleggingsverktøyene (docs/mcp.md, «Planlegging»): les og skriv dags- og
 * ukeplanen, samlet agenda med Spond, rutinepunkter med gjennomføring, og
 * måloppgaver. Modulene er delte (`$lib/ai/tools/`) og kan registreres på
 * web-chatten og Ekko senere; foreløpig bare her, så ingen av de to får en
 * større verktøyliste uten at det er bestemt.
 */
const PLANNING_TOOLS: AssistantTool[] = [
	adaptSharedTool(queryPlanTool),
	adaptSharedTool(managePlanItemTool),
	adaptSharedTool(queryAgendaTool),
	adaptSharedTool(queryRoutinesTool),
	adaptSharedTool(queryGoalsTool),
	adaptSharedTool(manageGoalTaskTool)
];

/**
 * Retningssamtalen (docs/mcp.md, «Retningssamtalen»): den kvartalsvise
 * ærlighetssjekken, ført i Claude eller ChatGPT og lagret som om den var ført i
 * appen. Web-chatten har flyten; derfor bare her.
 */
const DIRECTION_TOOLS: AssistantTool[] = [adaptSharedTool(queryDirectionTool), adaptSharedTool(saveDirectionConversationTool)];

export const MCP_TOOLS: AssistantTool[] = [
	...ASSISTANT_TOOLS.filter((tool) => !EXCLUDED.has(tool.definition.function.name)),
	...PLANNING_TOOLS,
	...DIRECTION_TOOLS
];

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

const MCP_TOOL_BY_NAME = new Map(MCP_TOOLS.map((tool) => [tool.definition.function.name, tool]));

/**
 * Kjør et MCP-verktøy. Egen kjører fordi `runAssistantTool` bare kjenner
 * assistentens liste — planleggingsverktøyene står ikke der. Samme kontrakt:
 * ukjent navn og kastet feil blir `{ error }`, og feilen logges.
 */
export async function runMcpTool(userId: string, name: string, args: Record<string, unknown>): Promise<unknown> {
	const tool = MCP_TOOL_BY_NAME.get(name);
	if (!tool) return { error: `Ukjent verktøy: ${name}` };
	try {
		return await tool.run(userId, args);
	} catch (error) {
		console.error(`[mcp] verktøy ${name} feilet:`, error);
		return { error: 'Verktøykall feilet' };
	}
}
