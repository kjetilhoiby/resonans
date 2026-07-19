/**
 * Ren logikk for observerte atferdssignaler: gjennomføring (planlagt→fullført→
 * snoozet/skippet), proaktivitet (quick wins/fokusøkter) og powernap-belastning.
 * DB-lesing og signal-skriving bor i signal-service; prompt-blokken bygges her
 * så den kan enhetstestes.
 */

import type { NapWithPriorNight } from './sleep-goals';

export type SignalSeverity = 'info' | 'low' | 'medium' | 'high';

/* ── Gjennomføring («gjort» observert) ──────────────────── */

export interface FollowThroughCounts {
	plannedItems: number;
	checkedItems: number;
	skippedItems: number;
	snoozedItems: number;
}

export interface FollowThroughResult {
	/** Fullført av planlagt, 0–100. Null når ingenting var planlagt. */
	pct: number | null;
	band: 'high' | 'medium' | 'low' | 'very_low' | 'ingen_plan';
	severity: SignalSeverity;
}

/** Klassifiser gjennomføring fra dagsplan-tellinger. */
export function classifyFollowThrough(counts: FollowThroughCounts): FollowThroughResult {
	if (counts.plannedItems <= 0) {
		return { pct: null, band: 'ingen_plan', severity: 'info' };
	}
	const pct = Math.round((counts.checkedItems / counts.plannedItems) * 100);
	const band = pct >= 80 ? 'high' : pct >= 60 ? 'medium' : pct >= 40 ? 'low' : 'very_low';
	const severity: SignalSeverity =
		pct >= 80 ? 'info' : pct >= 60 ? 'low' : pct >= 40 ? 'medium' : 'high';
	return { pct, band, severity };
}

/* ── Powernap-belastning ────────────────────────────────── */

/**
 * Alvorlighetsgrad for naps siste uke. Med nap-mål brukes målets grense;
 * uten mål: 0–1 info, 2 low, 3–4 medium, 5+ high.
 */
export function classifyNapLoad(napCount: number, maxPerWeek: number | null): SignalSeverity {
	if (maxPerWeek !== null) {
		if (napCount <= maxPerWeek) return 'info';
		return napCount - maxPerWeek >= 3 ? 'high' : napCount - maxPerWeek >= 2 ? 'medium' : 'low';
	}
	if (napCount <= 1) return 'info';
	if (napCount === 2) return 'low';
	if (napCount <= 4) return 'medium';
	return 'high';
}

/* ── Husarbeid-balanse (familie) ────────────────────────── */

export interface ChoreBalance {
	myCount: number;
	otherCount: number;
	total: number;
	/** Min andel 0..1 av loggede husarbeids-oppgaver */
	myShare: number;
	/** Avvik fra 50/50-idealet, signert (+ = jeg gjør mer, − = partner gjør mer) */
	deviation: number;
}

export const CHORE_IDEAL_SHARE = 0.5;

/**
 * Balanse i husarbeid mot 50/50-idealet. Ren funksjon — teller loggede
 * oppgaver gjort av meg vs. andre (partner). Returnerer null under et minimum
 * (for få oppgaver til å si noe meningsfullt).
 */
export function computeChoreBalance(
	myCount: number,
	otherCount: number,
	minTotal = 4
): ChoreBalance | null {
	const total = myCount + otherCount;
	if (total < minTotal) return null;
	const myShare = myCount / total;
	return {
		myCount,
		otherCount,
		total,
		myShare,
		deviation: myShare - CHORE_IDEAL_SHARE
	};
}

/**
 * Alvorlighetsgrad for husarbeids-skjevhet. Symmetrisk på avstand fra 50 % —
 * både å bære for mye og for lite er verdt å vite. ±10pp balansert, ±20pp low,
 * ±30pp medium, over det high.
 */
export function classifyChoreBalance(balance: ChoreBalance): SignalSeverity {
	// Rund bort flyttallsstøy (0.8 − 0.5 = 0.3000…04) før terskelsjekk
	const gap = Math.round(Math.abs(balance.deviation) * 100) / 100;
	if (gap <= 0.1) return 'info';
	if (gap <= 0.2) return 'low';
	if (gap <= 0.3) return 'medium';
	return 'high';
}

/* ── Budsjettpress per kategori ─────────────────────────── */

export interface BudgetProjection {
	/** Forbruk hittil i måneden */
	spent: number;
	/** Månedstaket */
	cap: number;
	/** Framskrevet månedsslutt basert på forbruk hittil og dag-i-måneden */
	projected: number;
	/** Allerede over taket */
	exceeded: boolean;
	/** På vei over (framskrevet > tak) selv om ikke over ennå */
	onTrackToExceed: boolean;
}

/**
 * Framskriv månedsforbruk i en kategori mot taket. `dayOfMonth`/`daysInMonth`
 * gir lineær pace-projeksjon — «du har brukt 800 av 2000 på kafé, men er bare
 * 10 dager inn → ligger an til 2400».
 */
export function projectBudget(
	spent: number,
	cap: number,
	dayOfMonth: number,
	daysInMonth: number
): BudgetProjection {
	const safeDay = Math.max(1, Math.min(dayOfMonth, daysInMonth));
	const projected = Math.round((spent / safeDay) * daysInMonth);
	return {
		spent: Math.round(spent),
		cap,
		projected,
		exceeded: spent > cap,
		onTrackToExceed: projected > cap
	};
}

/** Alvorlighetsgrad for budsjettpress: over taket = high, på vei over = medium. */
export function classifyBudgetPressure(p: BudgetProjection): SignalSeverity {
	if (p.exceeded) return 'high';
	if (p.onTrackToExceed) return 'medium';
	// Nær grensen (framskrevet ≥ 85 % av taket) → low
	if (p.cap > 0 && p.projected >= p.cap * 0.85) return 'low';
	return 'info';
}

/* ── Humør-/egenfrekvens-trend (mental helse) ───────────── */

export type MoodDirection = 'bedring' | 'stabil' | 'nedgang';

export interface MoodTrend {
	/** Snitt egenfrekvens-nivå (1–5) siste uke */
	recentAvg: number;
	/** Snitt over baseline-vinduet (8–28 dager tilbake) */
	baselineAvg: number;
	/** recent − baseline (positiv = bedring) */
	delta: number;
	direction: MoodDirection;
}

/**
 * Trend i egenfrekvens-nivå (1–5): fersk uke mot baseline. Ren funksjon.
 * Endring under ±0,4 regnes som stabil.
 */
export function computeMoodTrend(recentAvg: number, baselineAvg: number): MoodTrend {
	const delta = Math.round((recentAvg - baselineAvg) * 100) / 100;
	const direction: MoodDirection = delta <= -0.4 ? 'nedgang' : delta >= 0.4 ? 'bedring' : 'stabil';
	return {
		recentAvg: Math.round(recentAvg * 100) / 100,
		baselineAvg: Math.round(baselineAvg * 100) / 100,
		delta,
		direction
	};
}

/**
 * Alvorlighetsgrad for humør-trend. **Asymmetrisk** — bare nedgang hever
 * severity (bedring/stabil er info). Nedgang: −0,4 low, −0,8 medium, −1,2 high.
 * Lavt absolutt nivå (recent ≤ 2) løfter minst til medium uansett trend.
 */
export function classifyMoodTrend(trend: MoodTrend): SignalSeverity {
	let base: SignalSeverity = 'info';
	if (trend.delta <= -1.2) base = 'high';
	else if (trend.delta <= -0.8) base = 'medium';
	else if (trend.delta <= -0.4) base = 'low';

	if (trend.recentAvg <= 2 && base !== 'high') {
		return base === 'medium' ? 'high' : 'medium';
	}
	return base;
}

/* ── Hvilepuls-forhøyning ───────────────────────────────── */

/**
 * Klassifiser forhøyet hvilepuls: snitt siste 7 netter mot baseline (nettene
 * 8–28 dager tilbake). Forhøyet hvilepuls varsler sykdom, overtrening eller
 * søvnunderskudd — lavere/uendret er info.
 */
export function classifyRestingHrElevation(deltaBpm: number): SignalSeverity {
	if (deltaBpm >= 5) return 'high';
	if (deltaBpm >= 3) return 'medium';
	if (deltaBpm >= 1.5) return 'low';
	return 'info';
}

/* ── Floke-stagnasjon (knute-risiko) ────────────────────── */

export type FlokeStage = 'i_bevegelse' | 'stillestaaende' | 'knute_risiko';

/** Dager uten bevegelse før en floke regnes som stillestående / på vei til å bli knute. */
export const FLOKE_STAGNANT_DAYS = 14;
export const FLOKE_KNOT_RISK_DAYS = 28;

/**
 * Klassifiser en flokes tilstand fra dager siden siste bevegelse (steg gjort,
 * steg lagt til, eller opprettelse). VISION: «Floker kan bli til knuter om de
 * ikke løses rolig» — signalet fanger dem FØR de strammes.
 */
export function classifyFlokeStagnation(daysSinceMovement: number): FlokeStage {
	if (daysSinceMovement >= FLOKE_KNOT_RISK_DAYS) return 'knute_risiko';
	if (daysSinceMovement >= FLOKE_STAGNANT_DAYS) return 'stillestaaende';
	return 'i_bevegelse';
}

export interface FlokeStatus {
	title: string;
	/** 'active' = under nedbryting (har steg), 'planning' = aldri brutt ned */
	status: 'active' | 'planning';
	daysSinceMovement: number;
	stage: FlokeStage;
}

/** Alvorlighetsgrad for floke-stagnasjonssignalet. */
export function classifyFlokeLoad(floker: FlokeStatus[]): SignalSeverity {
	if (floker.some((f) => f.stage === 'knute_risiko')) return 'high';
	if (floker.some((f) => f.stage === 'stillestaaende')) return 'medium';
	return 'info';
}

/* ── Prompt-blokk: OBSERVERT ATFERD ─────────────────────── */

export interface ObservedBehaviorInputs {
	followThrough?: (FollowThroughCounts & { pct: number | null }) | null;
	naps?: { count: number; totalMinutes: number; withPriorNights: NapWithPriorNight[]; maxPerWeek: number | null } | null;
	proactivity?: { quickWins: number; focusSessions: number; focusMinutes: number } | null;
	routineAdherencePct?: number | null;
	/** Siste hodedump («skaffer oversikt») innen 7 dager */
	oversikt?: { daysAgo: number } | null;
	/** Floker fra hodedump: aktive (under nedbryting) og åpne (planning) prosjekter,
	 *  med evt. stillestående floker (≥14 dager uten bevegelse — knute-risiko) */
	floker?: { active: number; open: number; stillestaaende?: FlokeStatus[] } | null;
	/** Åpne løkker: uavsjekkede innboks-punkter (tapper energi så lenge de er åpne) */
	aapneLokker?: { inbox: number } | null;
	/** Husarbeid-balanse siste to uker (mot 50/50-idealet) */
	choreBalance?: ChoreBalance | null;
	/** Humør-/egenfrekvens-trend (fersk uke mot baseline) */
	moodTrend?: MoodTrend | null;
}

function formatHoursShort(h: number): string {
	return `${(Math.round(h * 10) / 10).toString().replace('.', ',')}t`;
}

/**
 * Bygg linjene i «OBSERVERT ATFERD»-blokken (siste 7 dager). Returnerer tom
 * array når ingenting er observert — da skal blokken utelates helt.
 */
export function buildObservedBehaviorLines(inputs: ObservedBehaviorInputs): string[] {
	const lines: string[] = [];

	const ft = inputs.followThrough;
	if (ft && ft.plannedItems > 0) {
		const parts = [`${ft.checkedItems} av ${ft.plannedItems} planlagte punkter fullført${ft.pct !== null ? ` (${ft.pct}%)` : ''}`];
		if (ft.snoozedItems > 0) parts.push(`${ft.snoozedItems} snoozet`);
		if (ft.skippedItems > 0) parts.push(`${ft.skippedItems} hoppet over`);
		lines.push(`- Gjennomføring: ${parts.join(', ')}.`);
	}

	const naps = inputs.naps;
	if (naps && naps.count > 0) {
		let napLine = `- Powernaps: ${naps.count} siste uke (${naps.totalMinutes} min totalt)`;
		if (naps.maxPerWeek !== null) {
			napLine += naps.count <= naps.maxPerWeek ? ` — innenfor målet på maks ${naps.maxPerWeek}` : ` — OVER målet på maks ${naps.maxPerWeek}`;
		}
		const shortNights = naps.withPriorNights.filter(
			(n) => n.priorNightHours !== null && n.priorNightHours < 6.5
		);
		if (shortNights.length > 0) {
			napLine += `. ${shortNights.length} av dem kom etter netter under 6,5t (${shortNights
				.map((n) => formatHoursShort(n.priorNightHours as number))
				.join(', ')}) — søvnunderskudd ser ut til å drive dem`;
		}
		lines.push(`${napLine}.`);
	}

	const pro = inputs.proactivity;
	if (pro && (pro.quickWins > 0 || pro.focusSessions > 0)) {
		const parts: string[] = [];
		if (pro.quickWins > 0) parts.push(`${pro.quickWins} quick win${pro.quickWins === 1 ? '' : 's'}`);
		if (pro.focusSessions > 0) parts.push(`${pro.focusSessions} fokusøkt${pro.focusSessions === 1 ? '' : 'er'} (${pro.focusMinutes} min)`);
		lines.push(`- Tar tak: ${parts.join(' og ')}.`);
	}

	if (typeof inputs.routineAdherencePct === 'number') {
		lines.push(`- Rutine-etterlevelse: ${Math.round(inputs.routineAdherencePct)}%.`);
	}

	if (inputs.oversikt) {
		const d = inputs.oversikt.daysAgo;
		const when = d === 0 ? 'i dag' : d === 1 ? 'i går' : `for ${d} dager siden`;
		lines.push(`- Skaffet oversikt: hodedump ${when}.`);
	}

	const floker = inputs.floker;
	if (floker && (floker.active > 0 || floker.open > 0)) {
		const parts: string[] = [];
		if (floker.active > 0) parts.push(`${floker.active} under nedbryting`);
		if (floker.open > 0) parts.push(`${floker.open} åpne som prosjekter`);
		let line = `- Floker: ${parts.join(', ')}.`;
		const verst = [...(floker.stillestaaende ?? [])].sort(
			(a, b) => b.daysSinceMovement - a.daysSinceMovement
		)[0];
		if (verst) {
			line += ` «${verst.title}» har ligget ${verst.daysSinceMovement} dager uten bevegelse${
				verst.stage === 'knute_risiko' ? ' — på vei til å bli knute' : ''
			}.`;
		}
		lines.push(line);
	}

	if (inputs.aapneLokker && inputs.aapneLokker.inbox > 0) {
		lines.push(`- Åpne løkker: ${inputs.aapneLokker.inbox} i innboksen.`);
	}

	const mt = inputs.moodTrend;
	if (mt && mt.direction !== 'stabil') {
		const retning =
			mt.direction === 'nedgang'
				? `ned fra ${mt.baselineAvg.toString().replace('.', ',')} til ${mt.recentAvg.toString().replace('.', ',')} av 5`
				: `opp fra ${mt.baselineAvg.toString().replace('.', ',')} til ${mt.recentAvg.toString().replace('.', ',')} av 5`;
		lines.push(
			`- Egenfrekvens siste uke: ${mt.direction} (${retning})${mt.direction === 'nedgang' ? ' — verdt å høre hvordan det står til' : ''}.`
		);
	}

	const cb = inputs.choreBalance;
	if (cb) {
		const mine = Math.round(cb.myShare * 100);
		const andre = 100 - mine;
		let tail = ' — jevnt fordelt';
		if (cb.deviation > 0.1) tail = ' — du bærer mer enn halvparten';
		else if (cb.deviation < -0.1) tail = ' — partner bærer mer enn halvparten';
		lines.push(`- Husarbeid siste to uker: du ${mine} %, partner ${andre} % (ideal 50/50)${tail}.`);
	}

	return lines;
}
