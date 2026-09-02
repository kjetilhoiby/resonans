/**
 * Helse-briefingen: hvor brukeren står, lagt i konteksten før de spør.
 *
 * ## Hvorfor denne finnes
 *
 * Verktøyene (`query_training`, `query_weight`, …) løste «modellen har ikke
 * tallene». De løste ikke «modellen vet ikke at den burde hente dem». En
 * reflekterende melding — «jeg får alltid en seig vår», «hvordan ligger jeg an
 * mot det jeg prøver på?» — ser ikke ut som et oppslag, så et verktøy blir ikke
 * valgt, og svaret blir generelle råd. Brukeren beskrev det som venterommet hos
 * legen: en coach som ikke vet hva hen driver med akkurat nå.
 *
 * Briefingen fjerner valget. Åpner brukeren helsechatten, ligger de sentrale
 * tallene der allerede: vektperioden de er inne i med tempo, ukas belastning mot
 * båndet, sammensetningen av økter, streaks som lever, og målene med fremdrift.
 * Modellen trenger ikke vite at den skulle spurt.
 *
 * ## Hvorfor tekst og ikke JSON
 *
 * Setningene her er de SAMME flatene viser (`planText`, `loadText`,
 * `currentSentence`, `nudge`, `streakLabel`, `progressText`) — de bærer
 * forbeholdene sine. Sendte vi rå felter, måtte modellen formulert dommen selv,
 * og «over båndet» ble like gjerne «du har overtrent» som «du gjorde mer enn
 * planen ba om». Bare den andre er sann. Se `effort-standing.ts`.
 *
 * ## Reglene modulen håndhever
 *
 * - **Ingen tomme rubrikker.** Et felt vi ikke har utelates helt, framfor å stå
 *   som «ukjent» — samme regel som `workout-assessment-context.ts`, av samme
 *   grunn: en modell som ser mange «ukjent» begynner å gjette.
 * - **En seksjon uten innhold forsvinner.** En bruker uten treningsløp skal ikke
 *   få en tom TRENING-overskrift; da ser det ut som data mangler når det bare er
 *   noe hen ikke bruker.
 * - **Briefingen er et utsnitt, ikke hele sannheten.** Den sier selv hvilke
 *   verktøy som gir mer, så modellen ikke tror den har sett alt. Uten den
 *   setningen slutter den å hente historikk den faktisk trenger.
 *
 * Modulen er ren, så det er etterprøvbart hva modellen ser.
 */

import { streakLabel, type StreakStatus, type StreakUnit } from '$lib/domain/streaks';
import type { TsbStatus } from '$lib/util/training-load';
import { describeFramedGoals, type FramedGoal } from '$lib/domain/health/goal-horizon';
import { formatMilestoneDate, formatShortDate, kg } from '$lib/domain/health/weight-text';

/* ── Input: bare det briefingen faktisk leser ────────────────────────────── */

export interface BriefingWeight {
	/** Siste veiing — rå måling, med dato. */
	latest: { date: string; weightKg: number } | null;
	/** Etterslepende 7-dagerssnitt. Det er DETTE endringer måles på. */
	trendKg: number | null;
	changes: Array<{ windowDays: number; actualDays: number; deltaKg: number }>;
	/**
	 * Perioden brukeren er inne i, ferdig formulert av `describeCurrentSwing`.
	 *
	 * Dette er «sammenhengende vektnedgang» — det brukeren mener når de spør hvor
	 * mye de har gått ned. Faste vinduer (30/90/365 dager) starter et vilkårlig
	 * antall dager tilbake og blander gjerne inn en oppgang som lå foran.
	 */
	currentSentence: string | null;
	goal: { goalKg: number; remainingKg: number | null; reached: boolean } | null;
	coverage: { weighIns: number; firstWeighIn: string | null; daysSinceLatest: number | null };
}

export interface BriefingTraining {
	/** Ukas effort mot båndet, med flatens egne ord om både plan og belastning. */
	week: {
		spentEffort: number;
		bandMin: number;
		bandMax: number;
		planText: string;
		loadText: string | null;
		runKm: number | null;
		weekTargetKm: number | null;
	} | null;
	load: {
		ctl: number | null;
		atl: number | null;
		tsb: number | null;
		/**
		 * Ordene om TSB, ordrett de samme flaten viser.
		 *
		 * `label` alene holder ikke: `hint` er det som sier hva tallet betyr for
		 * neste økt («Sliten» er en tilstand, «greit å trene hardt» er et råd), og
		 * det er nettopp rådet coachen skal gjenta framfor å finne sitt eget.
		 */
		status: TsbStatus;
		ctlChange: number | null;
		ctlChangeDays: number;
		ctlSettled: boolean;
	} | null;
	balance: {
		score: number;
		disciplines: Array<{ family: string; pct: number; sessions: number }>;
		nudge: string | null;
	} | null;
	plan: {
		name: string;
		startDate: string;
		durationWeeks: number;
		milestonesAchieved: number;
		milestonesTotal: number;
		todaySuggestion: string | null;
		restReason: string | null;
	} | null;
}

export interface BriefingStreak {
	title: string;
	emoji: string | null;
	count: number;
	unit: StreakUnit;
	bestCount: number;
	status: StreakStatus;
	gapCount: number;
	gapUnits: number;
	/** count_per_window: «1 av 2 løpeturer denne uka». */
	windowCount: number | null;
	windowTarget: number | null;
	/** max_interval: dager til forfall. Negativt = passert. */
	daysUntilDue: number | null;
}

export interface HealthBriefingInput {
	weight: BriefingWeight | null;
	training: BriefingTraining | null;
	streaks: BriefingStreak[];
	/** Målene i helse-familien, rammet inn av `frameGoals`. */
	goals: FramedGoal[];
	/**
	 * Setningen om en aktiv sykeperiode (`describeSickPeriod`), eller null.
	 *
	 * Ferdig formulert, som alt annet her: modellen skal ikke lese `sick: true` og
	 * finne sine egne ord for hva det betyr. Og den står ØVERST, ikke i en
	 * seksjon — er brukeren syk, forklarer det tallene under, og en modell som
	 * leser vekt og belastning først har alt begynt å tolke dem.
	 */
	sick: string | null;
}

/**
 * Disipliner vi lister enkeltvis i sammensetningen.
 *
 * Over dette blir lista lengre enn resten av seksjonen, og halen er uansett
 * enkeltøkter — «annet 2 %» er ikke informasjon noen handler på.
 */
export const MAX_LISTED_DISCIPLINES = 5;

/** Streaks i briefingen. Flere enn dette og de slutter å bli lest som signal. */
export const MAX_LISTED_STREAKS = 6;

/** Mål i briefingen. Resten hentes med verktøy hvis samtalen går dit. */
export const MAX_LISTED_GOALS = 6;

function num(value: number): string {
	const r = Math.round(value * 10) / 10;
	return Number.isInteger(r) ? String(r) : r.toFixed(1).replace('.', ',');
}

/** «−1,2 kg» / «+0,4 kg». Fortegnet er hele poenget, så det skrives alltid. */
function signedKg(value: number): string {
	if (Math.abs(value) < 0.05) return '±0 kg';
	return `${value < 0 ? '−' : '+'}${kg(value)} kg`;
}

function section(title: string, lines: string[]): string | null {
	if (lines.length === 0) return null;
	return `${title}:\n${lines.map((l) => (l.startsWith('-') ? l : `- ${l}`)).join('\n')}`;
}

/* ── Seksjonene ──────────────────────────────────────────────────────────── */

export function describeWeight(w: BriefingWeight): string[] {
	const lines: string[] = [];

	if (w.trendKg !== null) {
		const bits = [`Trend ${kg(w.trendKg)} kg`];
		if (w.latest) {
			// Rå måling ved siden av trenden: brukeren ser den på vekta om morgenen,
			// og en briefing som bare oppgir trenden ser ut som et annet tall.
			bits.push(`siste veiing ${kg(w.latest.weightKg)} kg ${formatShortDate(w.latest.date)}`);
		}
		lines.push(bits.join(', '));
	} else if (w.latest) {
		lines.push(
			`Siste veiing ${kg(w.latest.weightKg)} kg ${formatShortDate(w.latest.date)} (for få målinger til en trend)`
		);
	}

	// Den pågående perioden FØRST av endringstallene: den er svaret på «hvor mye
	// har jeg gått ned», og de faste vinduene under er kontekst til den.
	if (w.currentSentence) lines.push(w.currentSentence);

	if (w.changes.length > 0) {
		const parts = w.changes.map((c) => {
			// actualDays sier hvor langt tilbake referansepunktet faktisk lå. Avviker
			// den mye, veide brukeren seg ikke i vinduet, og «siste 7 dager» er feil.
			const drift = Math.abs(c.actualDays - c.windowDays) > c.windowDays * 0.5;
			return `${signedKg(c.deltaKg)} (${c.windowDays} d${drift ? `, målt over ${c.actualDays}` : ''})`;
		});
		lines.push(`Endring på trenden: ${parts.join(' · ')}`);
	}

	/**
	 * Kilden navngis, og det er ikke pedanteri.
	 *
	 * Denne målvekta kommer fra terskelarket (`metricSettings.weight.goal`), mens
	 * MÅL-seksjonen under leser `sensor_goals`. To ulike kilder som begge betyr
	 * «målvekt» kan sprike, og en modell som ser to tall uten kilde velger ett
	 * tilfeldig — eller sier begge, som er «redusere vekten til 85 kg og 95 kg» på
	 * nytt (se `workout-assessment.ts`). Med kilden på kan coachen si at de spriker.
	 */
	if (w.goal) {
		const head = `Målvekt satt i metrikk-arket: ${kg(w.goal.goalKg)} kg`;
		if (w.goal.reached) lines.push(`${head} — nådd`);
		else if (w.goal.remainingKg !== null) lines.push(`${head} — ${kg(w.goal.remainingKg)} kg igjen`);
		else lines.push(head);
	}

	// Dekningen er ikke pynt: uten den kan modellen ikke skille «vekta står
	// stille» fra «brukeren har ikke veid seg på tre uker».
	const cov: string[] = [];
	if (w.coverage.weighIns > 0) cov.push(`${w.coverage.weighIns} veiinger`);
	// Årstall her, ikke kort dato: «fra 13. okt.» om en måling fra 2017 leses som i
	// år, og da er dekningen ni år feil. `formatShortDate` er riktig på de ferske
	// datoene over, der året er underforstått.
	if (w.coverage.firstWeighIn) cov.push(`fra ${formatMilestoneDate(w.coverage.firstWeighIn)}`);
	if (w.coverage.daysSinceLatest !== null && w.coverage.daysSinceLatest > 3) {
		cov.push(`siste for ${w.coverage.daysSinceLatest} dager siden`);
	}
	if (cov.length > 0) lines.push(`Dekning: ${cov.join(', ')}`);

	return lines;
}

export function describeTraining(t: BriefingTraining): string[] {
	const lines: string[] = [];

	if (t.week) {
		lines.push(
			`Uka: ${Math.round(t.week.spentEffort)} effort av båndet ${Math.round(t.week.bandMin)}–${Math.round(t.week.bandMax)}. ${t.week.planText}`
		);
		if (t.week.runKm !== null && t.week.weekTargetKm !== null) {
			lines.push(`Løpt ${num(t.week.runKm)} av ${num(t.week.weekTargetKm)} km denne uka`);
		}
	}

	if (t.load && t.load.ctl !== null && t.load.tsb !== null) {
		const bits = [
			`form ${Math.round(t.load.ctl)}`,
			t.load.atl !== null ? `tretthet ${Math.round(t.load.atl)}` : null,
			`balanse ${t.load.tsb > 0 ? '+' : '−'}${Math.abs(Math.round(t.load.tsb))} (${t.load.status.label})`
		].filter((b): b is string => b !== null);
		let line = `Belastning: ${bits.join(', ')}`;
		if (t.load.ctlChange !== null && Math.abs(t.load.ctlChange) >= 1) {
			const dir = t.load.ctlChange > 0 ? 'steget' : 'falt';
			line += `. Formen har ${dir} ${Math.abs(Math.round(t.load.ctlChange))} på ${t.load.ctlChangeDays} dager`;
		}
		// ctlSettled false = serien er kortere enn CTL-ens 42-dagers tidskonstant.
		// Formtallet er da på vei opp fra null og skal ikke leses som et nivå.
		if (!t.load.ctlSettled) line += ' (formtallet har ikke svingt inn ennå)';
		lines.push(line);
		// Hintet er flatens eget råd for neste økt. Uten det ser modellen bare en
		// etikett, og finner sine egne ord for hva «Sliten» bør føre til.
		if (t.load.status.hint) lines.push(t.load.status.hint);
	}

	// Belastningsdommen står for seg selv: den er det ENESTE
	// restitusjonssignalet, og skal ikke blandes med budsjettet over.
	if (t.week?.loadText) lines.push(t.week.loadText);

	if (t.balance) {
		const listed = t.balance.disciplines.slice(0, MAX_LISTED_DISCIPLINES);
		if (listed.length > 0) {
			const parts = listed.map(
				(d) => `${d.family} ${Math.round(d.pct)} % (${d.sessions} ${d.sessions === 1 ? 'økt' : 'økter'})`
			);
			lines.push(`Sammensetning siste fire uker: ${parts.join(' · ')}`);
		}
		if (t.balance.nudge) lines.push(`Balanse ${Math.round(t.balance.score)}/100. ${t.balance.nudge}`);
	}

	if (t.plan) {
		const bits = [`Treningsløp «${t.plan.name}»`, `${t.plan.durationWeeks} uker fra ${formatShortDate(t.plan.startDate)}`];
		if (t.plan.milestonesTotal > 0) {
			bits.push(`${t.plan.milestonesAchieved} av ${t.plan.milestonesTotal} milepæler nådd`);
		}
		lines.push(bits.join(', '));
		if (t.plan.todaySuggestion) lines.push(`Planlagt i dag: ${t.plan.todaySuggestion}`);
		else if (t.plan.restReason) lines.push(`Hvile i dag: ${t.plan.restReason}`);
	}

	return lines;
}

export function describeStreaks(streaks: BriefingStreak[]): string[] {
	return streaks.slice(0, MAX_LISTED_STREAKS).map((s) => {
		const head = `${s.emoji ? `${s.emoji} ` : ''}${s.title}`;
		// streakLabel er flatens egen tekst, pauser inkludert. En egen formulering
		// her ville gitt chatten et annet tall enn kortet brukeren trykket seg fra.
		const label = streakLabel(s) || 'ingen aktiv rekke';
		const extra: string[] = [];
		if (s.windowCount !== null && s.windowTarget !== null) {
			extra.push(`${s.windowCount} av ${s.windowTarget} denne perioden`);
		}
		if (s.daysUntilDue !== null) {
			extra.push(
				s.daysUntilDue >= 0
					? `forfaller om ${s.daysUntilDue} ${s.daysUntilDue === 1 ? 'dag' : 'dager'}`
					: `${-s.daysUntilDue} ${-s.daysUntilDue === 1 ? 'dag' : 'dager'} på overtid`
			);
		}
		if (s.bestCount > s.count) extra.push(`beste ${s.bestCount}`);
		if (s.status === 'overdue') extra.push('BRUTT');
		else if (s.status === 'due_soon') extra.push('må holdes snart');
		return `${head}: ${label}${extra.length > 0 ? ` — ${extra.join(', ')}` : ''}`;
	});
}

/**
 * Sykeperioden, med konsekvensene sagt rett ut.
 *
 * Uten den siste linja tolker modellen tallene som atferd: en uke uten økter blir
 * «du har mistet rytmen» framfor «du var syk», og et råd om å komme i gang blir
 * gitt til noen som ligger med feber. Konsekvensene står med fordi de er
 * MEKANIKK — sier ikke prompten at streaks alt er pauset, gjentar modellen
 * beroligelsen som om den var noe den fant på, og det er en beroligelse den ikke
 * kan innfri neste gang.
 *
 * Vi diagnostiserer ingenting og gir ingen medisinske råd: dette er brukerens
 * egen registrering av at hen er syk, ikke en måling.
 */
export function describeSick(sentence: string): string[] {
	return [
		sentence,
		'Streaks er pauset for sykedagene (hverken holdt eller brutt), og ukas effort-ramme er senket.',
		'Tolk lavt volum og uteblitte økter i perioden som sykdom, ikke som sviktende rytme. Ikke gi medisinske råd.'
	];
}

/* ── Blokka ──────────────────────────────────────────────────────────────── */

export const BRIEFING_HEADER = '--- HELSE: HVOR BRUKEREN STÅR NÅ ---';
export const BRIEFING_FOOTER = '--- SLUTT PÅ HELSE ---';

/**
 * Rene fakta med flatens egne setninger. Instruksene bor i helse-blokka i
 * systemprompten (`DOMAIN_PROMPTS.health`), ikke her — samme arbeidsdeling som
 * `buildAssessmentContext` og `ASSESSMENT_SYSTEM_PROMPT`.
 *
 * Returnerer tom streng når det ikke er noe å si. En overskrift uten innhold er
 * verre enn ingen blokk: den ser ut som at data mangler.
 */
export function buildHealthBriefing(input: HealthBriefingInput): string {
	const blocks = [
		input.sick ? section('SYKDOM', describeSick(input.sick)) : null,
		input.weight ? section('VEKT', describeWeight(input.weight)) : null,
		input.training ? section('TRENING', describeTraining(input.training)) : null,
		section('STREAKS', describeStreaks(input.streaks)),
		section('MÅL I HELSE-FAMILIEN', describeFramedGoals(input.goals.slice(0, MAX_LISTED_GOALS)))
	].filter((b): b is string => b !== null);

	if (blocks.length === 0) return '';

	return [
		BRIEFING_HEADER,
		'Brukerens egne, beregnede tall — de samme flatene viser. Bruk dem direkte;',
		'du trenger ikke slå dem opp på nytt. Dette er et UTSNITT av nå-tilstanden:',
		'historikk over år, netter, ernæring og kapasitet (VO2max, pulsfall) hentes',
		'med verktøyene når samtalen går dit.',
		'',
		blocks.join('\n\n'),
		BRIEFING_FOOTER
	].join('\n');
}
