/**
 * checklist-item-builder.ts
 *
 * Felles parser for sjekklistepunkter. Tar rå punkt-tekst + sjekkliste-kontekst
 * og bygger lagrings-feltene (ren tekst, startdato, metadata) på samme måte
 * uansett hvor punktet kommer fra:
 *
 *   - Manuell oppretting (POST /api/checklists/[id]/items)
 *   - Redigering (PATCH …/[itemId]) — re-parses tid/person/aktivitet på nytt
 *   - Dagsplan-lagring (POST /api/day-plan)
 *   - AI-verktøy (plan_day, create_checklist, add_checklist_items)
 *
 * Tidligere lå denne logikken bare i POST-endepunktet, mens AI-verktøyene lagret
 * rå tekst («Fikse matpakker kl. 18») uten klokkeslett/aktivitet/kobling. Ved å
 * dele parseren får alle inngangene samme resultat: klokkeslett i metadata,
 * tidsuttrykk strippet fra teksten, sted/reise/måltid-prefiks tolket, og
 * kobling til ukeoppgaver der det er relevant.
 *
 * Funksjonen returnerer feltene + en liten side-effekt-beskrivelse
 * (`locationDayIso`). @-omtaler og opphold synkroniseres av kalleren etter at
 * raden er lagret (krever item-id).
 */

import {
	parseChecklistItemIntent,
	findLinkedTask,
	stripTimeFromText
} from './checklist-intent-linker';
import { parseLocationPrefix, parseTravelPrefix } from '$lib/utils/checklist-group';
import { detectMealPrefix } from '$lib/domains/food';
import { findOrCreateMealId } from './task-intent-parser';
import { getOrCreatePlanningGoal, createTask } from './goals';
import { enqueueBackgroundJob } from './background-jobs';

/** Extract week keys from a checklist context string like "week:2026-W16:day:2026-04-13" */
export function extractWeekKeys(
	context: string | null
): { dashedKey: string; compactKey: string } | null {
	if (!context) return null;
	const m = context.match(/week:(\d{4}-W\d{2})/);
	if (!m) return null;
	const dashedKey = m[1]; // "2026-W16"
	const compactKey = dashedKey.replace('-', ''); // "2026W16"
	return { dashedKey, compactKey };
}

export interface BuiltChecklistItemFields {
	/** Tekst som skal lagres — tidsuttrykk strippet når klokkeslett finnes, stedsnavn for sted-punkt. */
	text: string;
	/** ISO-dato hvis tolket fra teksten (sjelden for dag-punkt), ellers null. */
	startDate: string | null;
	/** Tolket metadata (timeHour, activityType, kind, linkedTaskId, …). Kan være tom. */
	metadata: Record<string, unknown>;
	/** Når punktet er et sted-punkt: ISO-dagen som opphold skal re-synces for. */
	locationDayIso: string | null;
}

export interface BuildChecklistItemOptions {
	userId: string;
	/** Sjekkliste-kontekst, f.eks. "week:2026-W16:day:2026-04-13", "tur" eller null. */
	context: string | null;
	/** Rå punkt-tekst. */
	text: string;
	/** Pinnet geokoding fra klienten (valgfritt). */
	coords?: { lat: number; lon: number; label?: string };
	/**
	 * Om en ny ukeoppgave skal opprettes når et ukenivå-punkt ikke matcher en
	 * eksisterende oppgave. true for manuell oppretting (POST); false ved
	 * redigering og AI-verktøy (vi kobler bare til eksisterende oppgaver).
	 */
	allowTaskCreation?: boolean;
}

/**
 * Bygg lagrings-feltene for ett sjekklistepunkt ut fra tekst + kontekst.
 *
 * Speiler logikken i POST /api/checklists/[id]/items for ett enkelt punkt på
 * toppnivå (ikke gjentaksmønstre eller deloppgaver — de håndteres av kalleren).
 */
export async function buildChecklistItemFields(
	opts: BuildChecklistItemOptions
): Promise<BuiltChecklistItemFields> {
	const { userId, context, text, coords, allowTaskCreation = false } = opts;

	const geoMeta = coords
		? { lat: coords.lat, lon: coords.lon, ...(coords.label && { geoLabel: coords.label }) }
		: {};

	const weekKeys = extractWeekKeys(context);
	const isWeekLevel = weekKeys !== null && !context!.includes(':day:');
	const isDayLevel = weekKeys !== null && context!.includes(':day:');
	const intent = parseChecklistItemIntent(text, { dayLevel: isDayLevel });

	let metadata: Record<string, unknown> = {};
	let locationDayIso: string | null = null;

	if (isWeekLevel && weekKeys) {
		// Wake-time-punkt: lagre måltid-metadata, ingen oppgavekobling.
		if (intent.wakeTargetHour !== undefined) {
			metadata = {
				wakeTargetHour: intent.wakeTargetHour,
				wakeTargetMinute: intent.wakeTargetMinute ?? 0
			};
		} else {
			// Ukenivå-punkt: koble til (eller opprett) en oppgave så fremgang kan spores.
			const linkedTask = await findLinkedTask({
				userId,
				itemText: text,
				weekDashedKey: weekKeys.dashedKey,
				weekCompactKey: weekKeys.compactKey
			});

			if (linkedTask) {
				metadata = {
					linkedTaskId: linkedTask.taskId,
					linkedTaskTitle: linkedTask.taskTitle,
					...(intent.activityType && { activityType: intent.activityType }),
					...(intent.durationMinutes !== undefined && { durationMinutes: intent.durationMinutes }),
					...(intent.distanceKm !== undefined && { distanceKm: intent.distanceKm })
				};
			} else if (allowTaskCreation) {
				// Ingen eksisterende oppgave — opprett en under planleggings-målet.
				try {
					const planningGoalId = await getOrCreatePlanningGoal(userId);
					const newTask = await createTask({
						goalId: planningGoalId,
						title: text,
						frequency: 'weekly',
						periodType: 'week',
						periodId: weekKeys.dashedKey,
						...(intent.activityType && { unit: intent.activityType })
					});
					await enqueueBackgroundJob({
						userId,
						type: 'task_intent_parse',
						payload: { taskId: newTask.id, rawText: text },
						priority: 8,
						maxAttempts: 2
					});
					metadata = {
						linkedTaskId: newTask.id,
						linkedTaskTitle: text,
						...(intent.activityType && { activityType: intent.activityType }),
						...(intent.durationMinutes !== undefined && { durationMinutes: intent.durationMinutes }),
						...(intent.distanceKm !== undefined && { distanceKm: intent.distanceKm })
					};
				} catch (err) {
					console.warn('[checklist-item-builder] Failed to create task for week item:', err);
				}
			} else if (intent.activityType) {
				// Redigering/AI uten oppgaveoppretting: behold i det minste aktivitets-tag.
				metadata = {
					activityType: intent.activityType,
					...(intent.durationMinutes !== undefined && { durationMinutes: intent.durationMinutes }),
					...(intent.distanceKm !== undefined && { distanceKm: intent.distanceKm })
				};
			}
		}
	} else if (weekKeys) {
		// Dag-nivå-punkt: parse tid + evt. kobling til eksisterende oppgave.
		const timeFields =
			intent.timeHour !== undefined
				? { timeHour: intent.timeHour, timeMinute: intent.timeMinute ?? 0 }
				: {};

		// «Sted: X» → ikke-avkryssbart dag-kontekst. «kjøre/båt/fly til X [kl T]»
		// → reisesegment med transportmodus. Begge tar presedens over måltid/aktivitet.
		const location = parseLocationPrefix(text);
		const travel = location ? null : parseTravelPrefix(text);
		// Meal-prefiks på dag-punkt → peker rett inn i mat-universet.
		const meal = location || travel ? null : detectMealPrefix(text);

		if (location) {
			metadata = { kind: 'location', locationName: location.name, ...geoMeta };
			const dayMatch = context!.match(/:day:(\d{4}-\d{2}-\d{2})/);
			locationDayIso = dayMatch ? dayMatch[1] : null;
		} else if (travel) {
			metadata = {
				...timeFields,
				kind: 'travel',
				travelMode: travel.mode,
				destination: travel.destination,
				...geoMeta
			};
		} else if (meal) {
			const mealId = await findOrCreateMealId(userId, meal.cleanTitle);
			metadata = {
				...timeFields,
				mealType: meal.mealType,
				...(mealId && { linkedMealId: mealId })
			};
		} else if (intent.matched) {
			const linkedTask = await findLinkedTask({
				userId,
				itemText: text,
				weekDashedKey: weekKeys.dashedKey,
				weekCompactKey: weekKeys.compactKey
			});

			if (linkedTask) {
				metadata = {
					...timeFields,
					linkedTaskId: linkedTask.taskId,
					linkedTaskTitle: linkedTask.taskTitle,
					activityType: intent.activityType,
					...(intent.durationMinutes !== undefined && { durationMinutes: intent.durationMinutes }),
					...(intent.distanceKm !== undefined && { distanceKm: intent.distanceKm })
				};
			} else if (intent.activityType) {
				metadata = {
					...timeFields,
					activityType: intent.activityType,
					...(intent.durationMinutes !== undefined && { durationMinutes: intent.durationMinutes }),
					...(intent.distanceKm !== undefined && { distanceKm: intent.distanceKm })
				};
			} else {
				metadata = { ...timeFields };
			}
		} else if (Object.keys(timeFields).length > 0) {
			metadata = { ...timeFields };
		}
	}
	// Generell sjekkliste (ingen ukenøkkel): ingen tids-/oppgaveparsing — ren tekst.

	// Sted-punkt lagres med rent stedsnavn; ellers strippes tidsuttrykk fra
	// teksten når et klokkeslett er trukket ut (vises som egen tids-chip).
	const storedText =
		metadata.kind === 'location'
			? (metadata.locationName as string)
			: metadata.timeHour !== undefined
				? stripTimeFromText(text)
				: text;

	// Aktivitets-tag fra den lagrede teksten, slik at punktet kan auto-hakes mot
	// treningsdata. Sted/reise er ikke aktiviteter, så de hopper over taggingen.
	const isContextItem = metadata.kind === 'location' || metadata.kind === 'travel';
	const baseActivityIntent = isContextItem
		? { activityType: undefined, durationMinutes: undefined, distanceKm: undefined }
		: parseChecklistItemIntent(storedText, { dayLevel: true });
	const activitySlotMeta: Record<string, unknown> = baseActivityIntent.activityType
		? {
				activityType: baseActivityIntent.activityType,
				...(baseActivityIntent.durationMinutes !== undefined && {
					durationMinutes: baseActivityIntent.durationMinutes
				}),
				...(baseActivityIntent.distanceKm !== undefined && {
					distanceKm: baseActivityIntent.distanceKm
				})
			}
		: {};

	// activitySlotMeta gir activityType; metadata (rikere, m/ linkedTaskId osv.)
	// vinner ved overlapp.
	const finalMetadata = { ...activitySlotMeta, ...metadata };

	return {
		text: storedText,
		startDate: null,
		metadata: finalMetadata,
		locationDayIso
	};
}

/**
 * Metadata-nøkler som er avledet av parsing av punkt-teksten. Ved redigering
 * fjernes disse før re-parsing, mens øvrige nøkler (f.eks. progressRecordId)
 * beholdes.
 */
export const PARSE_DERIVED_METADATA_KEYS = [
	'timeHour',
	'timeMinute',
	'activityType',
	'durationMinutes',
	'distanceKm',
	'linkedTaskId',
	'linkedTaskTitle',
	'wakeTargetHour',
	'wakeTargetMinute',
	'kind',
	'locationName',
	'travelMode',
	'destination',
	'mealType',
	'linkedMealId',
	'lat',
	'lon',
	'geoLabel'
] as const;
