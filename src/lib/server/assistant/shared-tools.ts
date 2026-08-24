import { z } from 'zod';
import type { AssistantTool } from './tools';
import { queryEconomicsTool } from '$lib/ai/tools/query-economics';
import { queryFoodTool } from '$lib/ai/tools/query-food';
import { queryNutritionTool } from '$lib/ai/tools/query-nutrition';
import { manageNutritionTargetsTool } from '$lib/ai/tools/manage-nutrition-targets';
import { logHungerTool } from '$lib/ai/tools/log-hunger';
import { queryFamilyTool } from '$lib/ai/tools/query-family';
import { queryHomeTool } from '$lib/ai/tools/query-home';
import { queryProjectsTool } from '$lib/ai/tools/query-projects';
import { querySensorDataTool } from '$lib/ai/tools/query-sensor-data';
import { queryTrainingTool } from '$lib/ai/tools/query-training';
import { queryWeightTool } from '$lib/ai/tools/query-weight';
import { manageWeightMeasurementTool } from '$lib/ai/tools/manage-weight-measurement';
import { querySleepTool } from '$lib/ai/tools/query-sleep';
import { queryEgenfrekvensTool } from '$lib/ai/tools/query-egenfrekvens';
import { queryTeslaVehicleTool } from '$lib/ai/tools/query-tesla-vehicle';
import { manageRecipeTool } from '$lib/ai/tools/manage-recipe';
import { manageMealPlanTool } from '$lib/ai/tools/manage-meal-plan';
import { managePantryTool } from '$lib/ai/tools/manage-pantry';
import { manageLunchboxTool } from '$lib/ai/tools/manage-lunchbox';
import { findRecipesTool } from '$lib/ai/tools/find-recipes';
import { manageFoodSettingsTool } from '$lib/ai/tools/manage-food-settings';
import { generateShoppingListTool } from '$lib/ai/tools/generate-shopping-list';
import { managePersonTool } from '$lib/ai/tools/manage-person';
import { manageRelationTool } from '$lib/ai/tools/manage-relation';
import { manageProjectTool } from '$lib/ai/tools/manage-project';
import { manageProjectTasksTool } from '$lib/ai/tools/manage-project-tasks';
import { manageProjectContactsTool } from '$lib/ai/tools/manage-project-contacts';
import { manageRoutineTool } from '$lib/ai/tools/manage-routine';
import { manageStreakTool } from '$lib/ai/tools/manage-streak';
import { manageHomeRoutineTool } from '$lib/ai/tools/manage-home-routine';
import { manageProcedureTool } from '$lib/ai/tools/manage-procedure';
import { linkToProjectTool } from '$lib/ai/tools/link-to-project';
import { manageThemeTool } from '$lib/ai/tools/manage-theme';
import { addToWeekPlanTool } from '$lib/ai/tools/add-to-week-plan';
import { manageTrainingProgramTool } from '$lib/ai/tools/manage-training-program';
import { weatherForecastTool } from '$lib/ai/tools/weather-forecast';
import { createTaskTool } from '$lib/ai/tools/create-task';
import { createGoalTool } from '$lib/ai/tools/create-goal';
import { updateGoalTool } from '$lib/ai/tools/update-goal';
import { logActivityTool } from '$lib/ai/tools/log-activity';
import { logNapTool } from '$lib/ai/tools/log-nap';
import { logChoreTool } from '$lib/ai/tools/log-chore';
import { logParentTimeTool } from '$lib/ai/tools/log-parent-time';
import { createMemoryTool } from '$lib/ai/tools/create-memory';
import { createNoteTool } from '$lib/ai/tools/create-note';
import { queryReflectionsTool } from '$lib/ai/tools/query-reflections';
import { LIVSKOMPASS_DIMENSION_IDS } from '$lib/domains/livskompass/dimensions';
import { ASSISTANT_SOURCE } from './conversation';

/**
 * Adapter som gjør de delte chat-verktøyene i `$lib/ai/tools/*` tilgjengelige for den
 * server-kjørte assistent-agenten — uten å duplisere logikk. De delte verktøyene har formen
 * `{ name, description?, parameters?: zod, execute(args) }` og forventer at `userId` injiseres
 * ved kall (aldri fra modellen). Her konverteres zod-skjemaet til JSON-schema (zod v4
 * `z.toJSONSchema`), `userId` (+ ev. andre injiserte nøkler) fjernes fra det modellen ser, og
 * `execute` pakkes i assistentens `run(userId, args)`-kontrakt.
 *
 * Verktøy uten zod-`parameters` (noen er bare `{ name, execute }` og har skjemaet sitt inline i
 * chat-endepunktet) får et eksplisitt `parametersSchema` via opts.
 */

interface SharedToolLike {
	name: string;
	description?: string;
	parameters?: unknown;
	// De delte verktøyene har hver sin spesifikke arg-type; `any` her er adapter-grensen som lar
	// dem passe inn uten å miste typing internt i hvert verktøy.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	execute: (args: any) => Promise<unknown>;
}

interface AdaptOptions {
	/** Overstyr/erstatt beskrivelsen modellen ser. */
	description?: string;
	/** Eksplisitt JSON-schema for verktøy uten zod-`parameters`. */
	parametersSchema?: Record<string, unknown>;
	/** Ekstra arg-nøkler som skjules for modellen (ut over `userId`). */
	omit?: string[];
	/** Statiske verdier som alltid flettes inn i `execute`-argumentene. */
	inject?: Record<string, unknown>;
}

/** Konverter en (zod) `parameters` til JSON-schema, minus de injiserte nøklene. */
function toParametersSchema(parameters: unknown, omit: Set<string>): Record<string, unknown> {
	const hasShape =
		!!parameters && typeof parameters === 'object' && 'shape' in (parameters as Record<string, unknown>);
	if (!hasShape) return { type: 'object', properties: {} };

	const shape = { ...((parameters as { shape: Record<string, z.ZodType> }).shape) };
	for (const key of omit) delete shape[key];

	try {
		const schema = z.toJSONSchema(z.object(shape), {
			io: 'input',
			unrepresentable: 'any'
		}) as Record<string, unknown>;
		delete schema.$schema;
		return schema;
	} catch (error) {
		console.warn('[assistant] kunne ikke konvertere parameters-skjema:', error);
		return { type: 'object', properties: {}, additionalProperties: true };
	}
}

/** Pakk et delt chat-verktøy som et assistent-verktøy. */
export function adaptSharedTool(tool: SharedToolLike, opts: AdaptOptions = {}): AssistantTool {
	const omit = new Set(['userId', ...(opts.omit ?? [])]);
	const parameters = opts.parametersSchema ?? toParametersSchema(tool.parameters, omit);
	const description = opts.description ?? tool.description ?? tool.name;

	return {
		definition: {
			type: 'function',
			function: { name: tool.name, description, parameters }
		},
		run: async (userId, args) => tool.execute({ userId, ...opts.inject, ...args })
	};
}

/* ── Skjema for verktøy uten zod-`parameters` (skjemaet bor inline i chat-endepunktet) ─────── */

const MANAGE_TRAINING_PROGRAM_DESCRIPTION =
	"Forklar og ENDRE brukerens adaptive treningsprogram når brukeren foreslår justeringer. Ring ALLTID action='get' først for å se uker, økter (med sessionId) og siste automatiske justeringer — bruk det til å finne riktig sessionId. Deretter: 'move_session' (flytt økt til annen ukedag, 1=man..7=søn), 'set_pace' (tempo i sek/km på én økt via sessionId, eller alle fremtidige av en runType), 'scale_volume' (skaler distanse/varighet, factor f.eks. 0.9=−10%), 'set_preference' (varige føringer: pinnedDays, lockPace, volumeBias, note). programId utelates for det aktive programmet. Bekreft konkrete endringer med brukeren ved tvil.";

const MANAGE_TRAINING_PROGRAM_SCHEMA = {
	type: 'object',
	properties: {
		action: { type: 'string', enum: ['get', 'move_session', 'set_pace', 'scale_volume', 'set_preference'] },
		programId: { type: 'string', description: 'Valgfri — utelat for aktivt program' },
		sessionId: { type: 'string', description: 'Økt-id fra get (for move_session/set_pace)' },
		newDay: { type: 'number', description: 'Ny ukedag 1=man..7=søn (move_session)' },
		paceSecPerKm: { type: 'number', description: 'Tempo i sekunder per km (set_pace), f.eks. 330 = 5:30/km' },
		runType: { type: 'string', enum: ['easy', 'tempo', 'intervals', 'long'], description: 'For set_pace på alle fremtidige av denne typen' },
		factor: { type: 'number', description: 'Volumfaktor (scale_volume), 0.5–1.5' },
		weekNumber: { type: 'number', description: 'Skaler kun denne uka (scale_volume)' },
		fromWeek: { type: 'number', description: 'Gjelder fra og med denne uka og fremover' },
		pinnedDays: { type: 'array', items: { type: 'number' }, description: 'Ukedager (1-7) der løp ikke skal flyttes (set_preference)' },
		lockPace: { type: 'boolean', description: 'Lås tempoet mot auto-rekalkulering (set_preference)' },
		volumeBias: { type: 'number', description: 'Ønsket volumnivå 0.5–1.5 (set_preference)' },
		note: { type: 'string', description: 'Fri føring (set_preference)' }
	},
	required: ['action']
};

const WEATHER_SCHEMA = {
	type: 'object',
	properties: {
		latitude: { type: 'number', description: 'Breddegrad for stedet (valgfri, default Oslo)' },
		longitude: { type: 'number', description: 'Lengdegrad for stedet (valgfri, default Oslo)' },
		locationName: { type: 'string', description: 'Lesbart stedsnavn for svaret, f.eks. «Volda»' }
	}
};

/**
 * De delte chat-verktøyene assistenten skal kunne bruke — full spørre-/skrive-paritet med
 * vanlig Resonans-chat for de domenene som allerede er modularisert. (Bil/biltur-verktøyene
 * ligger i `car-tools.ts`; rene lese-snarveier for trening/dag i `tools.ts`.)
 */
export const SHARED_ASSISTANT_TOOLS: AssistantTool[] = [
	// Spørringer
	adaptSharedTool(queryEconomicsTool),
	adaptSharedTool(queryFoodTool),
	adaptSharedTool(queryNutritionTool),
	adaptSharedTool(queryFamilyTool),
	adaptSharedTool(queryHomeTool),
	adaptSharedTool(queryProjectsTool),
	adaptSharedTool(querySensorDataTool),
	/**
	 * Undertemaenes beregnede lag — samme moduler chatten bruker, så stemmen og
	 * skjermen sier de samme tallene. `athleteContext` (tools.ts) dekker volum, tempo
	 * og VDOT; belastning, ukesbånd, balanse og pulsfall bor bare i `query_training`.
	 */
	adaptSharedTool(queryTrainingTool),
	adaptSharedTool(queryWeightTool),
	adaptSharedTool(manageWeightMeasurementTool),
	adaptSharedTool(querySleepTool),
	adaptSharedTool(queryEgenfrekvensTool),
	adaptSharedTool(queryTeslaVehicleTool),
	// Mat
	adaptSharedTool(manageRecipeTool),
	adaptSharedTool(manageMealPlanTool),
	adaptSharedTool(managePantryTool),
	adaptSharedTool(manageLunchboxTool),
	adaptSharedTool(generateShoppingListTool),
	adaptSharedTool(findRecipesTool),
	adaptSharedTool(manageFoodSettingsTool),
	adaptSharedTool(manageNutritionTargetsTool),
	adaptSharedTool(logHungerTool),
	// Familie
	adaptSharedTool(managePersonTool),
	adaptSharedTool(manageRelationTool),
	// Prosjekter
	adaptSharedTool(manageProjectTool),
	adaptSharedTool(manageProjectTasksTool),
	adaptSharedTool(manageProjectContactsTool),
	adaptSharedTool(linkToProjectTool),
	// Rutiner, prosedyrer, tema, ukeplan
	adaptSharedTool(manageRoutineTool),
	adaptSharedTool(manageStreakTool),
	adaptSharedTool(manageHomeRoutineTool),
	adaptSharedTool(manageProcedureTool),
	adaptSharedTool(manageThemeTool),
	adaptSharedTool(addToWeekPlanTool, {
		description:
			'Legg konkrete punkter inn i ukeplanen. weekOffset 0 = denne uka, 1 = neste. Hvert punkt er {text, dimension?} — dimension er en livskompass-dimensjons-id og settes kun for kompass-mål fra livskompass-coachingen.',
		parametersSchema: {
			type: 'object',
			properties: {
				weekOffset: { type: 'number', description: '0 = denne uka, 1 = neste uke' },
				items: {
					type: 'array',
					description: 'Punkter som skal legges til',
					items: {
						type: 'object',
						properties: {
							text: { type: 'string', description: 'Punktteksten' },
							dimension: {
								type: 'string',
								enum: LIVSKOMPASS_DIMENSION_IDS,
								description: 'Livskompass-dimensjon punktet skal heve (kun kompass-mål)'
							}
						},
						required: ['text']
					}
				}
			},
			required: ['items']
		}
	}),
	// Trening (skjema inline i chat — gitt eksplisitt her)
	adaptSharedTool(manageTrainingProgramTool, {
		description: MANAGE_TRAINING_PROGRAM_DESCRIPTION,
		parametersSchema: MANAGE_TRAINING_PROGRAM_SCHEMA
	}),
	// Vær (verktøyet tar ikke userId; locationName/koordinater fra modellen)
	adaptSharedTool(weatherForecastTool, {
		description:
			'Værprognose (MET.no) for et sted. Oppgi koordinater når du har dem (f.eks. fra et reisemål via driving_route), ellers default Oslo. Bruk for vær på reisemålet eller underveis.',
		parametersSchema: WEATHER_SCHEMA
	}),
	// Refleksjoner og notater (lesing)
	adaptSharedTool(queryReflectionsTool),
	// Fange-handlinger (samme delte moduler som chatten bruker)
	adaptSharedTool(createTaskTool),
	adaptSharedTool(createGoalTool),
	// Justering framfor et nytt mål ved siden av det gamle. Registrert på BEGGE
	// flater etter regelen i CLAUDE.md: en beskrivelse som bare finnes ett sted gir
	// de to flatene ulike instrukser uten at noen ser hvorfor.
	adaptSharedTool(updateGoalTool),
	adaptSharedTool(logActivityTool),
	adaptSharedTool(logNapTool),
	adaptSharedTool(logChoreTool),
	adaptSharedTool(logParentTimeTool),
	// `source` settes server-side til assistent-kilden, ikke av modellen
	adaptSharedTool(createMemoryTool, { inject: { source: ASSISTANT_SOURCE } }),
	adaptSharedTool(createNoteTool, { inject: { source: ASSISTANT_SOURCE } })
];
