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

/* ── Prompt-blokk: OBSERVERT ATFERD ─────────────────────── */

export interface ObservedBehaviorInputs {
	followThrough?: (FollowThroughCounts & { pct: number | null }) | null;
	naps?: { count: number; totalMinutes: number; withPriorNights: NapWithPriorNight[]; maxPerWeek: number | null } | null;
	proactivity?: { quickWins: number; focusSessions: number; focusMinutes: number } | null;
	routineAdherencePct?: number | null;
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

	return lines;
}
