import type { EnduranceWorkout } from './types';
import { mondayOfDate } from './curve';

/**
 * Balanse-motoren: det tredje hodet ved siden av styrke- og utholdenhetsløpet.
 * Effort-budsjettet belønner TOTAL innsats — blindt for om det er fem like
 * tredemølleturer eller en balansert miks. Denne modulen måler *variasjon*:
 *
 *  - disiplin-miks (andel effort per family siste ~4 uker),
 *  - styrke-dekning denne uka (registrerte styrkeøkter mot et enkelt ukemål),
 *  - intensitetsfordeling for løp (rolig / moderat / hard mot brukerens
 *    easy-pace) — polarisering framfor alt i grå sone.
 *
 * Ren modul (mønster som effort-budget.ts): data injiseres, ingen DB. Balanse
 * PÅVIRKER FORSLAG, ikke effort-skåringen — variasjon belønnes ved å styre
 * forslaget mot underbrukte hoder (nudge), aldri ved å blåse opp poeng.
 */

const WINDOW_DAYS = 28; // 4 uker for miks + intensitet
const STRENGTH_SESSIONS_TARGET = 2; // enkelt ukemål for styrke-dekning
const CONCENTRATION_THRESHOLD = 0.7; // én family > 70 % av effort → for ensidig
const GRAY_ZONE_THRESHOLD = 0.8; // > 80 % i én intensitetssone → for lite variert
const MIN_RUNS_FOR_INTENSITY = 3; // færre løp → ikke grunnlag for intensitets-nudge

// Intensitetssoner mot brukerens easy-pace (samme logikk som rute-seedene:
// moderat ≈ 0.9 × easy, terskel ≈ 0.82 × easy).
const ROLIG_MIN_RATIO = 0.95; // pace ≥ 95 % av easy-tid → rolig
const HARD_MAX_RATIO = 0.85; // pace ≤ 85 % av easy-tid → hard

export type IntensityBand = 'rolig' | 'moderat' | 'hard';

export type BalanceNudgeKind = 'styrke' | 'konsentrasjon' | 'intensitet';

export interface BalanceNudge {
	kind: BalanceNudgeKind;
	message: string;
	severity: 'info' | 'low' | 'medium';
}

export interface DisciplineSlice {
	family: string;
	effort: number;
	sessions: number;
	/** Andel av samlet effort i vinduet, 0–100. */
	pct: number;
}

export interface BalanceState {
	/** Disipliner sortert synkende på effort. */
	disciplines: DisciplineSlice[];
	totalEffort: number;
	strengthSessionsThisWeek: number;
	runSessionsThisWeek: number;
	/** Andel av løpe-effort i hver sone (0–100). Null når det ikke er nok løp. */
	intensity: { rolig: number; moderat: number; hard: number } | null;
	/** Sammensatt balanse-score 0–100 (heuristikk, ikke måling). */
	score: number;
	/** Én nudge om gangen — det største avviket. Null når balansen er god. */
	nudge: BalanceNudge | null;
}

const FAMILY_LABELS: Record<string, string> = {
	running: 'løp',
	cycling: 'sykkel',
	ebike: 'el-sykkel',
	strength: 'styrke',
	swimming: 'svømming',
	walking: 'gange',
	hiking: 'tur',
	yoga: 'yoga',
	football: 'fotball',
	other: 'annet'
};

function familyLabel(family: string): string {
	return FAMILY_LABELS[family] ?? family;
}

function clamp01(v: number): number {
	if (!Number.isFinite(v)) return 0;
	return Math.max(0, Math.min(1, v));
}

/** Klassifiserer én løpeøkt i intensitetssone mot easy-pace. */
export function classifyIntensity(
	paceSekPerKm: number,
	easyPaceSekPerKm: number
): IntensityBand {
	if (easyPaceSekPerKm <= 0 || paceSekPerKm <= 0) return 'moderat';
	const ratio = paceSekPerKm / easyPaceSekPerKm; // < 1 = raskere enn easy
	if (ratio >= ROLIG_MIN_RATIO) return 'rolig';
	if (ratio <= HARD_MAX_RATIO) return 'hard';
	return 'moderat';
}

/**
 * Beregner balanse-tilstanden fra siste ~4 ukers økter. `workouts` er alle
 * familier (fra canonical_workouts, klassifisert) kronologisk. `strengthDates`
 * er datoer med registrert styrkeøkt fra rå sensor_events — styrke-effort kan
 * mangle i canonical_workouts, så dekningstellingen bruker begge kilder.
 */
export function computeBalanceState(
	workouts: EnduranceWorkout[],
	strengthDates: string[],
	easyPaceSekPerKm: number | null,
	today: string
): BalanceState {
	const cutoff = addDays(today, -(WINDOW_DAYS - 1));
	const monday = mondayOfDate(today);
	const inWindow = workouts.filter((w) => w.date >= cutoff && w.date <= today);

	// ── Disiplin-miks ──
	const byFamily = new Map<string, { effort: number; sessions: number }>();
	for (const w of inWindow) {
		const effort = w.effortScore ?? 0;
		const cur = byFamily.get(w.family) ?? { effort: 0, sessions: 0 };
		cur.effort += effort;
		cur.sessions += 1;
		byFamily.set(w.family, cur);
	}
	const totalEffort = Math.round([...byFamily.values()].reduce((s, v) => s + v.effort, 0));
	const disciplines: DisciplineSlice[] = [...byFamily.entries()]
		.map(([family, v]) => ({
			family,
			effort: Math.round(v.effort),
			sessions: v.sessions,
			pct: totalEffort > 0 ? Math.round((v.effort / totalEffort) * 100) : 0
		}))
		.sort((a, b) => b.effort - a.effort);

	// ── Denne uka: styrke- og løpsdekning ──
	const strengthDatesThisWeek = new Set(
		strengthDates.filter((d) => d >= monday && d <= today)
	);
	// Styrke som canonical_workout (family='strength') teller også
	for (const w of inWindow) {
		if (w.family === 'strength' && w.date >= monday && w.date <= today) {
			strengthDatesThisWeek.add(w.date);
		}
	}
	const strengthSessionsThisWeek = strengthDatesThisWeek.size;
	const runSessionsThisWeek = inWindow.filter(
		(w) => w.family === 'running' && w.date >= monday && w.date <= today
	).length;

	// ── Intensitetsfordeling (løp, hele vinduet) ──
	const intensity = computeIntensity(inWindow, easyPaceSekPerKm);

	// ── Nudge: største avvik, én om gangen ──
	const nudge = pickNudge({
		disciplines,
		totalEffort,
		strengthSessionsThisWeek,
		runSessionsThisWeek,
		intensity
	});

	// ── Score: grov heuristikk (diversitet + styrke-dekning + intensitetsspredning) ──
	const score = computeScore({ disciplines, strengthSessionsThisWeek, intensity });

	return {
		disciplines,
		totalEffort,
		strengthSessionsThisWeek,
		runSessionsThisWeek,
		intensity,
		score,
		nudge
	};
}

function computeIntensity(
	inWindow: EnduranceWorkout[],
	easyPaceSekPerKm: number | null
): BalanceState['intensity'] {
	if (!easyPaceSekPerKm || easyPaceSekPerKm <= 0) return null;
	const runs = inWindow.filter(
		(w) =>
			w.family === 'running' &&
			(w.distanceMeters ?? 0) >= 500 &&
			(w.durationSeconds ?? 0) > 0
	);
	if (runs.length < MIN_RUNS_FOR_INTENSITY) return null;

	const bandEffort = { rolig: 0, moderat: 0, hard: 0 };
	for (const w of runs) {
		const pace = (w.durationSeconds ?? 0) / ((w.distanceMeters ?? 0) / 1000);
		const band = classifyIntensity(pace, easyPaceSekPerKm);
		bandEffort[band] += w.effortScore ?? 0;
	}
	const total = bandEffort.rolig + bandEffort.moderat + bandEffort.hard;
	if (total <= 0) return null;
	return {
		rolig: Math.round((bandEffort.rolig / total) * 100),
		moderat: Math.round((bandEffort.moderat / total) * 100),
		hard: Math.round((bandEffort.hard / total) * 100)
	};
}

function pickNudge(state: {
	disciplines: DisciplineSlice[];
	totalEffort: number;
	strengthSessionsThisWeek: number;
	runSessionsThisWeek: number;
	intensity: BalanceState['intensity'];
}): BalanceNudge | null {
	const { disciplines, totalEffort, strengthSessionsThisWeek, runSessionsThisWeek, intensity } =
		state;

	// 1. Styrke-dekning: har trent utholdenhet, men ingen/lite styrke denne uka.
	if (strengthSessionsThisWeek === 0 && runSessionsThisWeek >= 2) {
		return {
			kind: 'styrke',
			message: `${runSessionsThisWeek} løp og ingen styrke denne uka — ta en kort styrkeøkt (armhevinger, planke).`,
			severity: 'medium'
		};
	}

	// 2. Konsentrasjon: én disiplin dominerer effort-en, og det finnes alternativer.
	if (totalEffort > 0 && disciplines.length >= 2) {
		const top = disciplines[0];
		if (top.pct >= CONCENTRATION_THRESHOLD * 100) {
			const alt = disciplines.find((d) => d.family !== top.family);
			const altHint = alt ? ` Prøv mer ${familyLabel(alt.family)}` : '';
			return {
				kind: 'konsentrasjon',
				message: `${top.pct} % av innsatsen er ${familyLabel(top.family)} de siste fire ukene.${altHint} for bedre balanse og færre belastningsskader.`,
				severity: 'low'
			};
		}
	}

	// 3. Intensitet: for mye i én sone (typisk grå sone) — mangler polarisering.
	if (intensity) {
		const entries = Object.entries(intensity) as Array<[IntensityBand, number]>;
		const [band, pct] = entries.reduce((a, b) => (b[1] > a[1] ? b : a));
		if (pct >= GRAY_ZONE_THRESHOLD * 100) {
			const message =
				band === 'moderat'
					? 'Nesten alle løp ligger i moderat sone — legg inn én rolig restitusjonstur og én med fart.'
					: band === 'rolig'
						? 'Alle løp er rolige — legg inn en økt med fart (tempo eller intervaller) for progresjon.'
						: 'Mye hardt løp — husk de rolige turene for restitusjon.';
			return { kind: 'intensitet', message, severity: 'low' };
		}
	}

	return null;
}

function computeScore(state: {
	disciplines: DisciplineSlice[];
	strengthSessionsThisWeek: number;
	intensity: BalanceState['intensity'];
}): number {
	const { disciplines, strengthSessionsThisWeek, intensity } = state;
	if (disciplines.length === 0) return 0; // ingen aktivitet → ingen balanse å vurdere

	// Diversitet: 1 når toppdisiplinen er ≤ 50 %, fallende mot 0 ved 100 %.
	const topPct = disciplines.length > 0 ? disciplines[0].pct / 100 : 0;
	const diversity = disciplines.length === 0 ? 0 : topPct <= 0.5 ? 1 : clamp01(1 - (topPct - 0.5) / 0.5);

	// Styrke-dekning: mot ukemålet.
	const strength = clamp01(strengthSessionsThisWeek / STRENGTH_SESSIONS_TARGET);

	// Intensitetsspredning: 1 når største sone ≤ 50 %, fallende mot 0 ved 100 %.
	// Nøytral (1) når det ikke er nok løp til å vurdere.
	let intensitySpread = 1;
	if (intensity) {
		const maxBand = Math.max(intensity.rolig, intensity.moderat, intensity.hard) / 100;
		intensitySpread = maxBand <= 0.5 ? 1 : clamp01(1 - (maxBand - 0.5) / 0.5);
	}

	return Math.round(100 * (0.4 * diversity + 0.35 * strength + 0.25 * intensitySpread));
}

function addDays(iso: string, days: number): string {
	const d = new Date(`${iso}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

// Gjenbrukt av UI for konsistent merkelapp.
export { familyLabel };
