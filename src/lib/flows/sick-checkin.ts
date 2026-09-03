/**
 * Sykeinnsjekk: «Hvordan er det i dag?» — en kort prat mens en periode står.
 *
 * Bygges av en fabrikk, som egenfrekvens-slotten: tittelen og
 * symptomlista avhenger av forløpet, og et statisk registeroppslag kan ikke
 * bære det.
 *
 * ## Tallene kommer ETTER slideren, og det er den viktigste beslutningen her
 *
 * Sovepuls, hudtemperatur og søvn ligger i steg 2, aldri i steg 1. Vises de
 * først, ANKRER de svaret — og selvrapporten er det eneste signalet ingen
 * sensor kan hente. Samme regel som `log_hunger`, der modellen ikke får gjette
 * at «dritsulten» er en 5 fordi skalaen er kalibrert mot brukerens egne svar.
 * Et ankret nivå ville ødelagt nettopp den kalibreringen, og da er hele
 * slideren verdiløs.
 *
 * ## Tallene tolkes ikke
 *
 * De står som tall med kilde, uten en dom. Vi måler en sensor brukeren har på
 * seg; vi vurderer ikke brukeren. Ingen diagnose, ingen «normalt varer», ingen
 * råd om lege — samme grense som briefingen håndhever.
 *
 * ## Tre steg, ikke fem
 *
 * «Kort innsjekk» er kravet. Praten ligger derfor i en `secondaryAction`
 * («Snakk om det») framfor som et fjerde steg, nøyaktig som egenfrekvens gjør
 * med «Fortsett i chat»: den som vil snakke, får det; den som bare vil svare,
 * er ferdig på tre trykk.
 */

import type { Flow, FlowStep } from './types';
import {
	SICK_LEVEL_LABELS,
	SICK_LEVEL_MAX,
	SICK_LEVEL_MIN,
	SICK_LEVEL_RECOVERED,
	describeLevelChange,
	type SickLevelReading
} from '$lib/domain/health/sick-checkin';
import type { SymptomSeverity } from '$lib/domain/health/symptoms';

/** Retningssvaret per symptom. `over` avslutter symptomet. */
export const SYMPTOM_DIRECTIONS = [
	{ value: 'bedre', label: 'Bedre' },
	{ value: 'uendret', label: 'Uendret' },
	{ value: 'verre', label: 'Verre' },
	{ value: 'over', label: 'Over' }
] as const;

export interface SickCheckinFlowContext {
	/** Dager inn i perioden — tittelen sier hvor i forløpet man er. */
	dayOfPeriod: number;
	todayKey: string;
	/** Pågående symptomer, viktigste først (det begrensende øverst). */
	symptoms: Array<{ id: string; label: string; severity: SymptomSeverity }>;
	/** Forrige nivåmåling, til den utledede retningen. */
	previousLevel: SickLevelReading | null;
	/**
	 * Tallene, ferdig formulert med kilde — aldri rå verdier.
	 *
	 * Setningene kommer fra domenelaget (`describeSkinTemperature`,
	 * `describeCoreTemperature`, sovepulsens avvik), så flaten og helsechatten
	 * sier det samme.
	 */
	signals: string[];
}

export function buildSickCheckinFlow(ctx: SickCheckinFlowContext): Flow {
	const steps: FlowStep[] = [
		{
			id: 'step_level',
			type: 'form',
			title: `Hvordan er det i dag? (dag ${ctx.dayOfPeriod})`,
			prompt: '1 er elendig, 5 er frisk.',
			autoAdvance: true,
			fields: [
				{
					id: 'level',
					type: 'slider',
					label: 'Hvor dårlig er du?',
					hideLabel: true,
					min: SICK_LEVEL_MIN,
					max: SICK_LEVEL_MAX,
					step: 1,
					// Ingen default på 3: en forhåndsvalgt midte er også et anker.
					// Men flyten trenger en verdi for å kunne validere — 3 er den
					// nøytrale, og `autoAdvance` krever at brukeren rører slideren.
					defaultValue: 3,
					helperLabels: SICK_LEVEL_LABELS
				}
			],
			validation: (d) => Number.isInteger(d.level)
		}
	];

	/**
	 * Symptomsteget finnes bare når det ER symptomer å svare om. Uten dem er en
	 * tom liste et steg som ber om ingenting — og «kort innsjekk» tåler det ikke.
	 */
	if (ctx.symptoms.length > 0) {
		steps.push({
			id: 'step_symptoms',
			type: 'decision-list',
			title: 'Hva med symptomene?',
			/**
			 * Retningen er REGNET av nivået brukeren nettopp ga, ikke spurt om —
			 * derfor `buildPrompts` framfor en statisk `prompt`. Tallene står her,
			 * etter slideren, av grunnen i modulkommentaren.
			 */
			buildPrompts: (data) => ({ prompt: buildStepPrompt(ctx, data.level) }),
			itemsFromDataKey: 'symptomLabels',
			decisionOptions: SYMPTOM_DIRECTIONS.map((d) => ({ value: d.value, label: d.label })),
			defaultDecision: 'uendret'
		});
	}

	steps.push({
		id: 'step_new',
		type: 'form',
		title: 'Noe nytt?',
		// Uten symptomsteg er dette første stedet tallene kan stå.
		buildPrompts: (data) =>
			ctx.symptoms.length > 0
				? { prompt: 'Nye symptomer, eller noe som endret seg. Tom er greit.' }
				: { prompt: buildStepPrompt(ctx, data.level) ?? 'Nye symptomer. Tom er greit.' },
		fields: [
			{
				id: 'newSymptom',
				type: 'text',
				label: 'Nytt symptom',
				hideLabel: true,
				placeholder: 'F.eks. tett nese',
				required: false
			},
			{
				id: 'note',
				type: 'textarea',
				label: 'Notat',
				placeholder: 'Noe du vil huske om i dag?',
				required: false
			}
		],
		// Praten er valgfri, som egenfrekvens' «Fortsett i chat».
		secondaryAction: {
			id: 'sick-chat',
			icon: '💬',
			label: 'Snakk om det'
		}
	});

	return {
		id: 'sick_checkin',
		name: 'Sykeinnsjekk',
		description: 'Kort innsjekk mens du er syk',
		icon: '🤒',
		domain: 'health',
		trigger: 'auto_suggest',
		estimatedMinutes: 1,
		focus: true,
		parentTheme: 'Helse',
		steps,
		onComplete: async (data) => {
			const level = Number.isInteger(data.level) ? Number(data.level) : 3;
			const note = typeof data.note === 'string' && data.note.trim() ? data.note.trim() : null;
			const newSymptom =
				typeof data.newSymptom === 'string' && data.newSymptom.trim()
					? data.newSymptom.trim()
					: null;

			/**
			 * `decision-list` nøkler beslutningene på PUNKTETS TEKST, ikke på id.
			 * Etikettene er derfor snapshotet i `symptomLabels` i samme rekkefølge
			 * som `ctx.symptoms`, og vi mapper tilbake på indeks. To symptomer med
			 * samme ordlyd ville kollidert på tekst alene.
			 */
			const decisions = (data.step_symptoms ?? {}) as Record<string, string>;
			const labels = (data.symptomLabels ?? []) as string[];
			const symptoms = ctx.symptoms.map((s, i) => ({
				id: s.id,
				direction: decisions[labels[i]] ?? 'uendret'
			}));

			await fetch('/api/helse/syk/innsjekk', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ level, note, newSymptom, symptoms })
			});
		}
	};
}

/**
 * Den utledede retningen først, deretter tallene med kilde og uten dom.
 *
 * Retningen står FØRST fordi den handler om brukeren selv og er svaret på
 * spørsmålet hen nettopp besvarte; sensortallene er kontekst rundt det.
 *
 * Undefined når vi hverken har en forrige måling eller tall — en tom linje ser
 * ut som at noe feilet.
 */
function buildStepPrompt(ctx: SickCheckinFlowContext, level: unknown): string | undefined {
	const parts: string[] = [];

	if (Number.isInteger(level)) {
		const change = describeLevelChange(Number(level), ctx.previousLevel, ctx.todayKey);
		if (change) parts.push(change);
	}
	if (ctx.signals.length > 0) parts.push(...ctx.signals);

	return parts.length > 0 ? parts.join(' · ') : undefined;
}

/** Sier flyten at nivået var «frisk», så flaten kan tilby friskmelding. */
export function offersRecovery(level: unknown): boolean {
	return Number(level) >= SICK_LEVEL_RECOVERED;
}
