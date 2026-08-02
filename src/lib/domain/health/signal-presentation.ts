/**
 * Oversetter helse-signaler til noe et menneske kan lese på to sekunder.
 *
 * `domain_signals` produseres i dag av SignalService, men har aldri vært vist
 * på en flate — bare konsumert av nudge-motoren. Beskrivelsene i
 * `signal_contracts` er tekniske og delvis engelske («lineær regresjon av
 * ukentlig vektendring mot trailing snitt-effort»), så de skal ikke rendres.
 *
 * Kryss-paret er poenget: det gjør sammenhengen navigerbar. Et signal om
 * kveldsskjerm peker på både Skjermtid og Søvn, slik at mordashboardet svarer
 * på «hvordan henger ting sammen» i stedet for bare å liste tall.
 */

export type SignalSeverity = 'info' | 'low' | 'medium' | 'high';
export type SignalTone = 'nøytral' | 'positiv' | 'varsel' | 'kritisk';

/** Undertemaene et signal forbinder. Navnene matcher HEALTH_SUBTHEMES. */
export type SignalEndpoint = 'Trening' | 'Ernæring' | 'Egenfrekvens' | 'Søvn' | 'Skjermtid' | 'Helse';

export interface SignalLatest {
	valueNumber: number | null;
	valueText: string | null;
	valueBool: boolean | null;
	severity: string;
	confidence: string;
	observedAt: string;
	context: Record<string, unknown>;
}

export interface PresentedSignal {
	signalType: string;
	title: string;
	/** Én setning på norsk. Aldri kontraktens tekniske description. */
	sentence: string;
	tone: SignalTone;
	severity: SignalSeverity;
	/** De to (eller ett) undertemaene signalet forbinder. */
	crossLinks: SignalEndpoint[];
	observedAt: string;
}

const SEVERITY_TONE: Record<SignalSeverity, SignalTone> = {
	info: 'nøytral',
	low: 'nøytral',
	medium: 'varsel',
	high: 'kritisk'
};

function toSeverity(value: string): SignalSeverity {
	return value === 'low' || value === 'medium' || value === 'high' ? value : 'info';
}

function num(context: Record<string, unknown>, key: string): number | null {
	const value = context[key];
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(context: Record<string, unknown>, key: string): string | null {
	const value = context[key];
	return typeof value === 'string' && value.length > 0 ? value : null;
}

/** «1.4» → «1,4». Norske tall bruker komma. */
function nb(value: number, decimals = 1): string {
	return value.toFixed(decimals).replace('.', ',');
}

interface Definition {
	title: string;
	crossLinks: SignalEndpoint[];
	sentence: (latest: SignalLatest) => string | null;
	/** Overstyr tonen når severity ikke forteller hele historien. */
	tone?: (latest: SignalLatest) => SignalTone | null;
}

const DEFINITIONS: Record<string, Definition> = {
	health_effort_vs_threshold: {
		title: 'Trening mot vektterskel',
		crossLinks: ['Trening', 'Ernæring'],
		sentence: (latest) => {
			const ratio = latest.valueNumber;
			switch (latest.valueText) {
				case 'over_terskel':
					return 'Du trener over terskelen vekten din reagerer på.';
				case 'naer_terskel':
					return ratio === null
						? 'Du ligger like under terskelen vekten reagerer på.'
						: `Du ligger på ${Math.round(ratio * 100)} % av terskelen vekten reagerer på.`;
				case 'under_terskel':
					return ratio === null
						? 'Treningen ligger under terskelen vekten reagerer på.'
						: `Treningen ligger på ${Math.round(ratio * 100)} % av terskelen — under det vekten reagerer på.`;
				case 'langt_under':
					return 'Treningen ligger langt under terskelen vekten reagerer på.';
				default:
					return 'Ikke nok data til å anslå effort-terskelen ennå.';
			}
		},
		tone: (latest) => (latest.valueText === 'over_terskel' ? 'positiv' : null)
	},

	resting_hr_elevated_7d: {
		title: 'Hvilepuls',
		crossLinks: ['Søvn', 'Trening'],
		sentence: (latest) => {
			const delta = latest.valueNumber;
			const recent = num(latest.context, 'recentAvg');
			const baseline = num(latest.context, 'baselineAvg');
			if (delta === null || recent === null || baseline === null) return null;
			if (delta >= 1.5) {
				return `Sovepulsen er ${nb(delta)} slag over vanlig (${Math.round(recent)} mot ${Math.round(baseline)}).`;
			}
			if (delta <= -1.5) {
				return `Sovepulsen er ${nb(Math.abs(delta))} slag under vanlig (${Math.round(recent)} mot ${Math.round(baseline)}).`;
			}
			return `Sovepulsen ligger på det vanlige (${Math.round(recent)} slag).`;
		},
		tone: (latest) => ((latest.valueNumber ?? 0) <= -1.5 ? 'positiv' : null)
	},

	sleep_powernaps_7d: {
		title: 'Powernaps',
		crossLinks: ['Søvn', 'Egenfrekvens'],
		sentence: (latest) => {
			const count = latest.valueNumber;
			if (count === null) return null;
			if (count === 0) return 'Ingen powernaps denne uka.';
			const shortNights = num(latest.context, 'shortNightNapCount') ?? 0;
			const base = count === 1 ? '1 powernap denne uka' : `${count} powernaps denne uka`;
			if (shortNights > 0) {
				return `${base}, ${shortNights} av dem etter en kort natt.`;
			}
			return `${base}.`;
		}
	},

	evening_screen_work_7d: {
		title: 'Skjerm om kvelden',
		crossLinks: ['Skjermtid', 'Søvn'],
		sentence: (latest) => {
			const days = num(latest.context, 'eveningDays');
			const minutes = num(latest.context, 'totalEveningMinutes') ?? latest.valueNumber;
			if (days === null || minutes === null) return latest.valueText;
			if (days === 0) return 'Ingen kveldsjobbing registrert denne uka.';
			const hours = nb(minutes / 60);
			return `${days} ${days === 1 ? 'kveld' : 'kvelder'} med skjermarbeid etter 17, ${hours} timer til sammen.`;
		}
	},

	training_balance: {
		title: 'Treningsbalanse',
		crossLinks: ['Trening'],
		sentence: (latest) => {
			// Nudge-teksten er allerede ferdig norsk prosa fra SignalService.
			const nudge = latest.context.nudge;
			if (nudge && typeof nudge === 'object' && 'message' in nudge) {
				const message = (nudge as { message?: unknown }).message;
				if (typeof message === 'string' && message.length > 0) return message;
			}
			const score = latest.valueNumber;
			if (score === null) return null;
			return `Balansescore ${Math.round(score)} av 100 over fire uker.`;
		}
	},

	nutrition_protein_vs_load: {
		title: 'Protein mot belastning',
		crossLinks: ['Ernæring', 'Trening'],
		sentence: (latest) => {
			// Setningen er ferdig norsk prosa fra evaluateProteinVsLoad — den
			// kjenner både gram, mål og antall loggede dager.
			const message = latest.context.message;
			if (typeof message === 'string' && message.length > 0) return message;
			const deficit = latest.valueNumber;
			if (deficit === null) return null;
			return deficit > 0
				? `Du mangler ${Math.round(deficit)} g protein per dag for treningsmengden din.`
				: 'Proteininntaket dekker treningsbelastningen.';
		}
	},

	egenfrekvens_trend_7d: {
		title: 'Egenfrekvens',
		crossLinks: ['Egenfrekvens', 'Søvn'],
		sentence: (latest) => {
			const recent = num(latest.context, 'recentAvg');
			const baseline = num(latest.context, 'baselineAvg');
			const direction = str(latest.context, 'direction');
			if (recent === null) return null;
			if (baseline === null || direction === null) return `Nivået ligger på ${nb(recent)} av 5.`;
			if (direction === 'stabil') return `Nivået ligger stabilt på ${nb(recent)} av 5.`;
			return `Nivået er i ${direction}: ${nb(recent)} mot ${nb(baseline)} i snitt.`;
		},
		tone: (latest) => (str(latest.context, 'direction') === 'oppgang' ? 'positiv' : null)
	},

	activity_run_pr_week: {
		title: 'Løpeøkter denne uka',
		crossLinks: ['Trening'],
		sentence: (latest) => {
			const count = latest.valueNumber;
			if (count === null) return null;
			if (count === 0) return 'Ingen løpeøkter registrert denne uka ennå.';
			return count === 1 ? '1 løpeøkt denne uka.' : `${count} løpeøkter denne uka.`;
		}
	},

	tracking_series_activity_pr_week: {
		title: 'Registreringer denne uka',
		crossLinks: ['Trening'],
		sentence: (latest) => {
			const count = latest.valueNumber;
			if (count === null) return null;
			return count === 1 ? '1 registrering denne uka.' : `${count} registreringer denne uka.`;
		}
	}
};

/**
 * Signal + siste måling → noe som kan rendres. Returnerer null når signalet
 * ikke har en måling ennå — da har vi ingenting å si, og et tomt kort er verre
 * enn ingen kort.
 *
 * Ukjente signaltyper faller tilbake på signalType og valueText, slik at et
 * nytt signal dukker opp (om enn stygt) i stedet for å forsvinne stille.
 */
export function presentSignal(
	signalType: string,
	latest: SignalLatest | null
): PresentedSignal | null {
	if (!latest) return null;

	const severity = toSeverity(latest.severity);
	const definition = DEFINITIONS[signalType];

	if (!definition) {
		return {
			signalType,
			title: signalType,
			sentence: latest.valueText ?? 'Ingen beskrivelse tilgjengelig.',
			tone: SEVERITY_TONE[severity],
			severity,
			crossLinks: ['Helse'],
			observedAt: latest.observedAt
		};
	}

	const sentence = definition.sentence(latest);
	if (!sentence) return null;

	return {
		signalType,
		title: definition.title,
		sentence,
		tone: definition.tone?.(latest) ?? SEVERITY_TONE[severity],
		severity,
		crossLinks: definition.crossLinks,
		observedAt: latest.observedAt
	};
}

const SEVERITY_ORDER: Record<SignalSeverity, number> = { high: 0, medium: 1, low: 2, info: 3 };

/**
 * Rangerer for mordashboardet: mest alvorlige først, ferskeste ved likhet.
 * Gamle `info`-signaler filtreres bort — de er støy på en oversiktsflate.
 */
export function rankSignalsForOverview(
	signals: PresentedSignal[],
	opts: { now?: Date; limit?: number; maxInfoAgeDays?: number } = {}
): PresentedSignal[] {
	const now = opts.now ?? new Date();
	const maxInfoAgeMs = (opts.maxInfoAgeDays ?? 7) * 86_400_000;

	return signals
		.filter((signal) => {
			if (signal.severity !== 'info') return true;
			const age = now.getTime() - new Date(signal.observedAt).getTime();
			return age <= maxInfoAgeMs;
		})
		.sort((a, b) => {
			const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
			if (bySeverity !== 0) return bySeverity;
			return new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime();
		})
		.slice(0, opts.limit ?? 5);
}
