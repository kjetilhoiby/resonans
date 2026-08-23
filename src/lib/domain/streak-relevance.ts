/**
 * Hvilke temaer en streak hører hjemme på.
 *
 * ## Hvorfor dette ikke bare er `themeId`
 *
 * `streakDefinitions.metadata.themeId` finnes, men den er tom for alle streaks som
 * ble opprettet uten at noen tenkte på temakobling — og det er de fleste. En
 * løpestreak har åpenbart noe å gjøre på Trening-temaet, og brukeren skal ikke
 * måtte konfigurere det som allerede står i definisjonen: kilden ER koblingen.
 *
 * Derfor to veier inn, i denne rekkefølgen:
 *
 * 1. **Eksplisitt `themeId`** — en bruker som har koblet streaken til et tema har
 *    bestemt seg, og det valget overstyrer alt.
 * 2. **Utledet fra kilden** — en `workout`-streak hører på trening, en
 *    `sensor_event`-streak hører der datatypen hører.
 *
 * Utledningen treffer `DashboardKind` og ikke temanavn, fordi det er dashboardtypen
 * temasiden alt resolver seg til (`resolveThemeDashboardKind`). Et tema som heter
 * «Løping» får kind `training` uten at noen liste over navn må vedlikeholdes her.
 *
 * ## Hva som IKKE er relevant
 *
 * Manuelle streaks (hårklipp, badevask) har ingen kilde å utlede fra, og havner
 * ingen steder uten en eksplisitt kobling. Det er riktig: å gjette at «Badevask»
 * hører på Hjem ut av tittelen er en tekstgjetning som treffer nesten, og et kort
 * som dukker opp på feil tema er verre enn et kort som ikke dukker opp.
 *
 * Mortemaet Helse får heller ingen streaks utledet til seg. Det viser
 * sammenhengene mellom undertemaene gjennom sine egne fliser; en løpestreak der i
 * tillegg er samme informasjon to steder på samme skjerm.
 */

import type { DashboardKind } from './theme-dashboard-registry';
import type { StreakSource } from './streaks';

/**
 * Datatype → dashboardtype. Bare typer som faktisk kan bære en streak står her;
 * resten er null, og da vises streaken bare der den er koblet eksplisitt.
 */
const DATA_TYPE_KIND: Record<string, DashboardKind> = {
	workout: 'training',
	strength_workout: 'training',
	weight: 'weight',
	waist: 'weight',
	sleep: 'sleep',
	sleep_disturbance: 'sleep',
	nutrition: 'nutrition',
	hunger: 'nutrition',
	screen_time: 'screentime',
	chore_done: 'home',
	reflection: 'egenfrekvens',
	checkin: 'egenfrekvens'
};

/** Dashboardtypen en streak hører til ut fra kilden sin, eller null. */
export function streakDashboardKind(source: StreakSource): DashboardKind | null {
	if (source.kind === 'workout') return 'training';
	if (source.kind === 'sensor_event') return DATA_TYPE_KIND[source.dataType] ?? null;
	return null;
}

export interface StreakRelevanceTarget {
	/** Temaets id — matcher en eksplisitt kobling. */
	themeId?: string | null;
	/** Temaets dashboardtype, fra `resolveThemeDashboardKind`. */
	dashboardKind?: DashboardKind | null;
}

export interface StreakRelevanceInput {
	source: StreakSource;
	/** Eksplisitt kobling fra `metadata.themeId`. */
	themeId?: string | null;
}

/**
 * Skal streaken vises på dette temaet?
 *
 * Eksplisitt kobling til et ANNET tema utelukker: har brukeren sagt at
 * løpestreaken hører på «Maraton 2027», skal den ikke også stå på Trening. Uten
 * det ville en bevisst plassering blitt en tilleggsplassering.
 */
export function isStreakRelevantForTheme(
	streak: StreakRelevanceInput,
	target: StreakRelevanceTarget
): boolean {
	if (streak.themeId) return streak.themeId === target.themeId;
	const kind = streakDashboardKind(streak.source);
	return kind !== null && kind === target.dashboardKind;
}
