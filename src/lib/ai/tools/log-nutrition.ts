import { estimateIntake, NutritionEstimateError } from '$lib/server/nutrition/estimate-intake';
import { listIntake, logIntake } from '$lib/server/nutrition/intake-log';
import { invalidateNutritionAggregates } from '$lib/server/nutrition/aggregate-refresh';
import { describeItem } from '$lib/domain/nutrition/estimate';
import { osloDateKey, summarizeDay } from '$lib/domain/nutrition/day-summary';
import { isMealSlotId, mealSlotForTime, MEAL_SLOT_IDS } from '$lib/domain/nutrition/meal-slots';

/**
 * Logger et måltid fra chatten.
 *
 * Samme estimator og samme logg som Ernæring-flaten — verktøyet er bare en
 * annen inngang. Det er derfor `NutritionLogger` og dette deler
 * `estimateIntake` og `logIntake` framfor å ha hver sin variant.
 *
 * Forskjell fra flaten: her er det ett steg. Chatten har ingen «se over og
 * rett»-flate, så estimatet lagres direkte og svaret sier hva som ble ført —
 * inkludert usikkerheten, slik at modellen kan spørre om mengde etterpå.
 */
export const logNutritionTool = {
	name: 'log_nutrition',
	description: `Logg et måltid brukeren har spist, og få makroer estimert mot en norsk referansetabell.

Bruk når brukeren forteller at de har spist noe — «jeg spiste to knekkebrød med egg»,
«hadde skyr til frokost». Estimatet lagres i ernæringsloggen og teller mot dagens
summer på Ernæring-temaet.

Ikke bruk for å planlegge måltid eller finne oppskrifter — da er find_recipes eller
mat-temaet riktig. Ikke bruk for å SPØRRE om næringsinnhold uten å spise; det er
bare et estimat, ikke en logg.

Sier brukeren når de spiste («til lunsj», «kl. 11», «i går kveld»), send det med i
eatenAt og/eller mealSlot. Utelater du dem, brukes tidspunktet nå og måltidet
utledes fra klokka.

Svaret inneholder dagens totalsum etterpå, og et oppfølgingsspørsmål hvis mengden
måtte gjettes. Still det spørsmålet til brukeren.`,

	parameters: {
		type: 'object' as const,
		properties: {
			description: {
				type: 'string',
				description: 'Hva brukeren spiste, med mengde hvis oppgitt. F.eks. «to knekkebrød med egg».'
			},
			imageUrl: {
				type: 'string',
				description: 'Cloudinary-URL til et bilde av måltidet, hvis brukeren har lastet opp ett.'
			},
			eatenAt: {
				type: 'string',
				description:
					'ISO-tidspunkt for når måltidet ble spist, hvis brukeren oppgir et annet enn nå. Kan ikke være i framtiden.'
			},
			mealSlot: {
				type: 'string',
				enum: [...MEAL_SLOT_IDS],
				description:
					'Måltidet, hvis brukeren sier det. Utelates ellers — da utledes det fra klokka.'
			}
		},
		required: ['description']
	},

	execute: async (args: {
		userId: string;
		description?: string;
		imageUrl?: string;
		eatenAt?: string;
		mealSlot?: string;
	}) => {
		if (!args.description?.trim() && !args.imageUrl) {
			return { error: 'Trenger en beskrivelse av måltidet eller et bilde.' };
		}

		let estimate;
		try {
			estimate = await estimateIntake({
				text: args.description ?? null,
				imageUrl: args.imageUrl ?? null
			});
		} catch (err) {
			if (err instanceof NutritionEstimateError) return { error: err.message };
			throw err;
		}

		if (estimate.items.length === 0) {
			return {
				error: 'Klarte ikke kjenne igjen noe å logge.',
				question: estimate.question ?? 'Hva besto måltidet av?'
			};
		}

		// Bare bakover: et måltid i framtiden ville lagt seg i en periode som ikke
		// er begynt, og dagssummene ville sluttet å stemme.
		const parsedEatenAt = args.eatenAt ? new Date(args.eatenAt) : null;
		const timestamp =
			parsedEatenAt && !Number.isNaN(parsedEatenAt.getTime()) && parsedEatenAt <= new Date()
				? parsedEatenAt
				: new Date();

		const slot = isMealSlotId(args.mealSlot) ? args.mealSlot : null;
		const created = await logIntake({
			userId: args.userId,
			estimate,
			timestamp,
			imageUrl: args.imageUrl ?? null,
			descriptions: args.description?.trim() ? [args.description.trim()] : [],
			mealSlot: slot
		});

		await invalidateNutritionAggregates(args.userId, timestamp).catch((err) =>
			console.error('[log_nutrition] aggregat-oppdatering feilet', err)
		);

		// Dagens sum etter loggingen, slik at modellen kan svare «det er 1 240 kcal
		// så langt i dag» uten et nytt verktøykall.
		const today = osloDateKey(timestamp);
		const entries = await listIntake(args.userId, {
			since: new Date(timestamp.getTime() - 36 * 60 * 60 * 1000)
		});
		const day = summarizeDay(
			today,
			entries.filter((entry) => osloDateKey(entry.timestamp) === today)
		);

		return {
			logged: {
				id: created.id,
				label: estimate.label,
				eatenAt: created.timestamp,
				mealSlot: slot ?? mealSlotForTime(timestamp),
				items: estimate.items.map(describeItem),
				macros: estimate.totals,
				confidence: estimate.confidence
			},
			today: { date: today, totals: day.totals, mealCount: day.entries.length },
			// Modellen skal stille dette videre til brukeren, ikke svare på det selv.
			question: estimate.needsQuantity ? estimate.question : null,
			notes: estimate.notes
		};
	}
};
