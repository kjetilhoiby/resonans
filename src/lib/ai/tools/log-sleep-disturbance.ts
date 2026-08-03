import { listDisturbances, logDisturbance } from '$lib/server/sleep/disturbance-log';
import { invalidateSleepAggregates } from '$lib/server/sleep/aggregate-refresh';
import {
	disturbanceMeta,
	groupDisturbancesByNight,
	isSleepDisturbanceKind,
	MAX_AWAKE_MINUTES,
	SLEEP_DISTURBANCE_KINDS
} from '$lib/domain/sleep/disturbance';

/**
 * Registrerer en søvnforstyrrelse fra chatten.
 *
 * Naboverktøyet `log_nap` dekker dagsøvn; dette dekker de to tilfellene som
 * ikke har en varighet å måle. Samme logg og samme aggregat-oppdatering som
 * Søvn-flaten — verktøyet er bare en annen inngang.
 *
 * «Jeg sov ikke i natt» er noe man sier i forbifarten, ikke noe man åpner en
 * flate for. Derfor er alt utenom typen valgfritt.
 */
export const logSleepDisturbanceTool = {
	name: 'log_sleep_disturbance',
	description: `Registrer at brukeren ikke fikk sove, eller våknet og ikke fikk sove igjen.

Bruk når brukeren forteller om en urolig natt — «jeg fikk ikke sove i natt», «våknet
klokka tre og lå våken», «sov dårlig». Registreringen havner i søvnloggen på
Ernæring-temaets nabo, Søvn, og telles ved siden av nattlengden fra Withings.

Bruk log_nap i stedet for søvn på dagtid — den har en varighet.
Ikke bruk dette for generell trøtthet uten en konkret natt.

Kinds:
- innsovning: fikk ikke sove ved leggetid
- oppvaakning: våknet i løpet av natta og fikk ikke sove igjen

awakeMinutes er valgfritt. Ikke gjett — «vet ikke» er et gyldig svar, og et oppdiktet
tall forgifter ukesstatistikken. Spør bare hvis brukeren virker å ha tallet.`,

	parameters: {
		type: 'object' as const,
		properties: {
			kind: {
				type: 'string',
				enum: [...SLEEP_DISTURBANCE_KINDS],
				description: 'innsovning = fikk ikke sove. oppvaakning = våknet og fikk ikke sove igjen.'
			},
			at: {
				type: 'string',
				description:
					'Når det skjedde: «HH:MM» (i dag, Oslo-tid) eller ISO-tidspunkt. Utelates for nå. Kan ikke være i framtiden.'
			},
			awakeMinutes: {
				type: 'number',
				description: `Minutter våken, 0–${MAX_AWAKE_MINUTES}. Utelat hvis brukeren ikke sa det.`
			},
			note: { type: 'string', description: 'Kort notat, hvis brukeren nevner en årsak.' }
		},
		required: ['kind']
	},

	execute: async (args: {
		userId: string;
		kind?: string;
		at?: string;
		awakeMinutes?: number;
		note?: string;
	}) => {
		if (!isSleepDisturbanceKind(args.kind)) {
			return { error: 'kind må være «innsovning» eller «oppvaakning».' };
		}

		let timestamp: Date | undefined;
		if (args.at?.trim()) {
			// «HH:MM» håndteres av endepunktet; her tar vi ISO, som er det modellen
			// naturlig produserer når den har en dato.
			const parsed = new Date(args.at.trim());
			if (Number.isNaN(parsed.getTime())) {
				return { error: `Ugyldig tidspunkt: ${args.at}` };
			}
			if (parsed > new Date()) {
				return { error: 'Tidspunktet kan ikke være i framtiden.' };
			}
			timestamp = parsed;
		}

		const created = await logDisturbance({
			userId: args.userId,
			kind: args.kind,
			timestamp,
			awakeMinutes: typeof args.awakeMinutes === 'number' ? args.awakeMinutes : null,
			note: args.note ?? null
		});

		await invalidateSleepAggregates(args.userId, timestamp).catch((err) =>
			console.error('[log_sleep_disturbance] aggregat-oppdatering feilet', err)
		);

		// Siste uke tilbake, slik at modellen kan si «tredje natt denne uka» uten
		// et nytt verktøykall.
		const recent = await listDisturbances(args.userId, { sinceDays: 7 });
		const nights = groupDisturbancesByNight(recent);

		return {
			logged: {
				id: created.id,
				kind: args.kind,
				description: disturbanceMeta(args.kind).description,
				at: created.timestamp,
				awakeMinutes: typeof args.awakeMinutes === 'number' ? args.awakeMinutes : null
			},
			lastWeek: {
				disturbedNights: nights.length,
				totalAwakeMinutes: nights.reduce((sum, n) => sum + (n.awakeMinutes ?? 0), 0)
			}
		};
	}
};
