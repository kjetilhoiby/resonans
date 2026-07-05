import type { EnduranceConfig, EnduranceGoal, StrengthGoal } from './types';

/** Defaults for brukerens 6-måneders løp (seedes ved oppsett, kan justeres i DB). */

export const DEFAULT_STRENGTH_GOAL: StrengthGoal = {
	armhevinger: { fra: 10, til: 100 },
	planke: { fraSek: 30, tilSek: 60 }
};

export const DEFAULT_ENDURANCE_GOAL: EnduranceGoal = {
	ukesKm: { fra: 14, til: 22 },
	paceSekPerKm: { fra: 400, til: 330 } // 6:40 → 5:30
};

export const DEFAULT_ENDURANCE_CONFIG: EnduranceConfig = {
	deloadHverNteUke: 4,
	maksIkkeLopAndel: 0.4
};

export const DEFAULT_PLAN_DURATION_WEEKS = 26;

/**
 * Hvilket løp som "eier" hver ukedag (1=man..7=søn) når planen ikke
 * overstyrer. Ekko-kontrakten er én økt per dag.
 */
export const DEFAULT_SCHEDULE: Record<number, 'styrke' | 'utholdenhet' | 'hvile'> = {
	1: 'styrke',
	2: 'utholdenhet',
	3: 'styrke',
	4: 'utholdenhet',
	5: 'styrke',
	6: 'utholdenhet',
	7: 'hvile'
};

/** Pull-up-fasene som seedes som milepæler ved oppsett. */
export const PULLUP_PHASES = [
	{ navn: '3×10 s negativer', criteria: { metric: 'pullup_negativ_sek', value: 10 } },
	{ navn: '3×15 s negativer', criteria: { metric: 'pullup_negativ_sek', value: 15 } },
	{ navn: '3×20 s negativer', criteria: { metric: 'pullup_negativ_sek', value: 20 } },
	{ navn: '1 strikt pull-up', criteria: { metric: 'pullup_reps', value: 1, manual: true } },
	{ navn: '2 strikte pull-ups', criteria: { metric: 'pullup_reps', value: 2, manual: true } },
	{ navn: '3 strikte pull-ups', criteria: { metric: 'pullup_reps', value: 3, manual: true } }
] as const;

/** Milepæler for armhevinger/planke som seedes ved oppsett. */
export const STRENGTH_MILESTONES = [
	{ navn: '25 armhevinger totalt', criteria: { metric: 'armhevinger_total', value: 25 } },
	{ navn: '50 armhevinger totalt', criteria: { metric: 'armhevinger_total', value: 50 } },
	{ navn: '75 armhevinger totalt', criteria: { metric: 'armhevinger_total', value: 75 } },
	{ navn: '100 armhevinger totalt', criteria: { metric: 'armhevinger_total', value: 100 } },
	{ navn: '45 s planke', criteria: { metric: 'planke_sekunder', value: 45 } },
	{ navn: '60 s planke', criteria: { metric: 'planke_sekunder', value: 60 } }
] as const;

export const ENDURANCE_MILESTONES = [
	{ navn: '16 km på en uke', criteria: { metric: 'ukes_km', value: 16 } },
	{ navn: '18 km på en uke', criteria: { metric: 'ukes_km', value: 18 } },
	{ navn: '20 km på en uke', criteria: { metric: 'ukes_km', value: 20 } },
	{ navn: '22 km på en uke', criteria: { metric: 'ukes_km', value: 22 } }
] as const;

// Navnet Ekko bruker for negativer — må matche STRENGTH_EXERCISES i programs/constants.
export const PULLUP_NEGATIV_NAME = 'Sakte senking fra pullup-stang';
export const ARMHEVINGER_NAME = 'Armhevinger';
export const PLANKE_NAME = 'Planke';
// Strikte pull-ups er ikke blant de 5 gamle øvelsene, men event-data valideres
// ikke mot navnelisten — Ekko kan sende dette når brukeren når strikte-fasen.
export const PULLUP_NAME = 'Pull-ups';
