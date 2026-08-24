/**
 * Delt AI-verktøy: endre et mål som ALLEREDE finnes.
 *
 * ## Hvorfor det trengs
 *
 * Fram til august 2026 kunne chatten opprette mål, men ikke justere dem. En
 * bruker som sa «95 kg er for ambisiøst før november, kan vi si 98?» fikk derfor
 * enten et NYTT mål ved siden av det gamle — to mål om samme sak, som gjør begge
 * meningsløse på /plan/mal — eller et råd om å endre det selv i appen. Det siste
 * er ikke coaching, det er en henvisning.
 *
 * Verre: helse-prompten ber nå coachen foreslå «justering av mål» som et grep.
 * Et grep modellen ikke kan utføre er en tom setning, og en tom setning er
 * nøyaktig det brukeren klaget på.
 *
 * ## Hvorfor `metricId` ikke er en parameter
 *
 * `updateGoalMetric` kaster på ukjent metrikk med vilje: en oppdatering uten
 * gjenkjennelig metrikk ville tømt målet for både spor og målverdi og sett ut som
 * en lagring som gikk bra. Men modellen kjenner ikke metrikk-id-en — den ser en
 * måltittel. Så vi leser den fra målet selv. Har målet ingen metrikk, kan
 * målVERDIEN ikke endres, og verktøyet sier det framfor å skrive noe halvt.
 */

import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { goals } from '$lib/db/schema';
import { updateGoalMetric } from '$lib/server/goals';
import { describeMeasurement } from './create-goal';

export type UpdateGoalAction =
	| 'adjust_target'
	| 'set_deadline'
	| 'pause'
	| 'resume'
	| 'complete'
	| 'abandon';

/** Statusene handlingene setter. `abandon` er «vi dropper dette», ikke «nådd». */
const STATUS_BY_ACTION: Partial<Record<UpdateGoalAction, string>> = {
	pause: 'paused',
	resume: 'active',
	complete: 'completed',
	abandon: 'abandoned'
};

/**
 * Argumentsjekken, ren og testbar — og kjørt FØR målet leses.
 *
 * Rekkefølgen er poenget: en adjust_target uten targetValue er feil uansett hva
 * som står i basen, så en spørring først ville vært bortkastet. At den er ren gjør
 * den dessuten testbar uten å mocke databasen, slik CLAUDE.md ber om.
 */
export function validateUpdateGoalArgs(args: {
	action: UpdateGoalAction;
	targetValue?: number;
	targetDate?: string;
}): { ok: true } | { ok: false; error: string } {
	if (args.action === 'adjust_target') {
		if (typeof args.targetValue !== 'number' || !Number.isFinite(args.targetValue)) {
			return { ok: false, error: 'adjust_target krever targetValue (et tall).' };
		}
		return { ok: true };
	}
	if (args.action === 'set_deadline') {
		if (!args.targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(args.targetDate)) {
			return { ok: false, error: 'set_deadline krever targetDate på formen YYYY-MM-DD.' };
		}
		// Formen kan være riktig og datoen likevel finnes ikke — «2026-02-31».
		const parsed = new Date(`${args.targetDate}T12:00:00Z`);
		if (Number.isNaN(parsed.getTime()) || !parsed.toISOString().startsWith(args.targetDate)) {
			return { ok: false, error: `«${args.targetDate}» er ikke en gyldig dato.` };
		}
		return { ok: true };
	}
	if (!STATUS_BY_ACTION[args.action]) {
		return { ok: false, error: `Ukjent action: ${args.action}` };
	}
	return { ok: true };
}

export const updateGoalTool = {
	name: 'update_goal',
	description:
		'Endre et mål som allerede finnes. Bruk DENNE framfor create_goal når brukeren vil justere noe de har satt — to mål om samme sak gjør begge meningsløse. goalId er UUID-en fra lista over aktive mål. action: "adjust_target" (ny målverdi — for vektmål: MÅLVEKTEN i kg, f.eks. 98 for «ned til 98 kg»), "set_deadline" (flytt eller sett frist, targetDate=YYYY-MM-DD), "pause" (legg målet på is uten å slette det), "resume", "complete" (nådd), "abandon" (vi dropper det). Svaret sier hvilke tall målet faktisk måles mot etterpå — bruk DEM i kvitteringen, aldri egne anslag. Målverdien kan bare endres på mål som har en metrikk; har målet ingen, sier svaret det, og da skal du si det til brukeren framfor å påstå at det er justert.',

	parameters: z.object({
		userId: z.string().describe('User ID'),
		goalId: z.string().describe('UUID-en til målet, fra lista over aktive mål. Aldri tittel eller nummer.'),
		action: z
			.enum(['adjust_target', 'set_deadline', 'pause', 'resume', 'complete', 'abandon'])
			.describe('Hva som skal endres'),
		targetValue: z
			.number()
			.optional()
			.describe(
				'Ny målverdi. Påkrevd for adjust_target. For vektmål: MÅLVEKTEN i kg — serveren regner endringen selv.'
			),
		targetDate: z
			.string()
			.optional()
			.describe('Ny frist (YYYY-MM-DD). Påkrevd for set_deadline.')
	}),

	execute: async (args: {
		userId: string;
		goalId: string;
		action: UpdateGoalAction;
		targetValue?: number;
		targetDate?: string;
	}) => {
		const valid = validateUpdateGoalArgs(args);
		if (!valid.ok) return { success: false as const, error: valid.error };

		const goal = await db.query.goals.findFirst({
			where: and(eq(goals.id, args.goalId), eq(goals.userId, args.userId))
		});
		if (!goal) {
			return {
				success: false as const,
				error: 'Fant ikke målet. Bruk UUID-en fra lista over aktive mål — ikke tittelen.'
			};
		}

		const existing = (goal.metadata ?? {}) as {
			metricId?: string | null;
			startValue?: number | null;
			startDate?: string | null;
			endDate?: string | null;
			goalTrack?: {
				kind?: 'level' | 'change' | 'trajectory';
				window?: 'week' | 'month' | 'quarter' | 'year' | 'custom';
				targetValue?: number;
				unit?: string;
				durationDays?: number | null;
			} | null;
		};

		try {
			if (args.action === 'adjust_target') {
				// Metrikken leses fra målet, aldri fra modellen — se filhodet.
				if (!existing.metricId) {
					return {
						success: false as const,
						error: `Målet «${goal.title}» har ingen metrikk, så det finnes ingen målverdi å justere. Si det til brukeren: målet kan følges i tekst, men ikke måles. Vil de ha et målbart mål, må det opprettes med en metrikk.`
					};
				}
				/**
				 * ALT som ikke endres må sendes med på nytt.
				 *
				 * `buildGoalTrackMetadata` faller tilbake på `inferGoalKind`,
				 * `inferGoalWindow` og metrikkens standardenhet for hvert felt som
				 * mangler — så en justering av målverdien alene ville stille tilbake et
				 * kvartalsmål til «month» og en egendefinert enhet til standarden, uten
				 * at noe sier fra. Samme felle som `USER_OWNED_METADATA_KEYS` dekker på
				 * sensor-hendelser: en skriving som bare setter ett felt tømmer resten.
				 *
				 * Baselinen løftes med av samme grunn — den er MÅLT, og en justering av
				 * målverdien skal ikke flytte utgangspunktet.
				 */
				const track = existing.goalTrack ?? null;
				const updated = await updateGoalMetric({
					userId: args.userId,
					goalId: goal.id,
					metricId: existing.metricId,
					fields: {
						targetValue: args.targetValue!,
						startValue: existing.startValue ?? undefined,
						goalKind: track?.kind,
						goalWindow: track?.window,
						unit: track?.unit,
						durationDays: track?.durationDays ?? undefined,
						targetDate: existing.endDate ?? undefined
					},
					startDate: existing.startDate ?? undefined,
					endDate: existing.endDate ?? undefined
				});
				const measurement = describeMeasurement((updated.metadata ?? {}) as never);
				return {
					success: true as const,
					goalId: goal.id,
					goalTitle: goal.title,
					action: args.action,
					...measurement,
					message: `Målverdien på «${goal.title}» er oppdatert.${measurement.warning ? ` OBS: ${measurement.warning}` : ''}`
				};
			}

			if (args.action === 'set_deadline') {
				const parsed = new Date(`${args.targetDate}T12:00:00Z`);
				// `endDate` i metadata er det progresjonssporet leser; `targetDate` er
				// kolonnen flatene sorterer på. Begge må flyttes, ellers viser
				// dashboardet én frist og lista en annen.
				await db
					.update(goals)
					.set({
						targetDate: parsed,
						metadata: { ...existing, endDate: args.targetDate },
						updatedAt: new Date()
					})
					.where(eq(goals.id, goal.id));
				return {
					success: true as const,
					goalId: goal.id,
					goalTitle: goal.title,
					action: args.action,
					targetDate: args.targetDate,
					message: `Fristen på «${goal.title}» er satt til ${args.targetDate}.`
				};
			}

			const status = STATUS_BY_ACTION[args.action];
			if (!status) return { success: false as const, error: `Ukjent action: ${args.action}` };

			await db
				.update(goals)
				.set({ status, updatedAt: new Date() })
				.where(eq(goals.id, goal.id));

			return {
				success: true as const,
				goalId: goal.id,
				goalTitle: goal.title,
				action: args.action,
				status,
				message: `«${goal.title}» er nå ${status}.`
			};
		} catch (error) {
			console.error('[update_goal] feilet:', error);
			return {
				success: false as const,
				error: 'Kunne ikke oppdatere målet. Si det til brukeren framfor å påstå at det er endret.'
			};
		}
	}
};
