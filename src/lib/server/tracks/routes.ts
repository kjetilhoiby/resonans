/**
 * Rute-effort: beregner effort per fartsvariant fra rutens fysiske fakta.
 * Konsistent med effort-modellen (minutt × MET × 2.5, met_pace-intensitet for
 * løp). Ren modul — DB-tilgang ligger i repository.ts.
 *
 * Slik blir «pendlerunden 8 km» til «rolig ≈133 / moderat ≈152 / terskel ≈190»,
 * og en bakke til «10×200 m ≈ …» — grunnlaget for varierte, ærlige forslag.
 */

const MET_CALIBRATION = 2.5;
const RUN_MET = 1.0;
const CYCLING_MET = 0.85;
const EBIKE_MET = 0.4;
// Fart mellom intervalldrag (jogg/gange) i sek/km — for total-tid på bakkeøkter.
const HILL_RECOVERY_PACE = 480;
// Klatre-ekvivalens: 100 høydemeter ≈ 1 km flatt løp (tommelfingerregel for
// trail/kupert løp). Høydemeteren legger på tid/effort uavhengig av fart.
const VERTICAL_M_PER_EQUIV_KM = 100;
// På sti er sakte IKKE lett (teknisk terreng) — intensiteten gulves høyere enn
// på vei så en langsom stiøkt ikke feilaktig skåres som en rolig joggetur.
const TRAIL_INTENSITY_FLOOR = 1.0;
const ROAD_INTENSITY_FLOOR = 0.75;

export type RouteKind = 'run' | 'bike' | 'hill' | 'trail' | 'mixed';

export interface RouteVariant {
	label: string;
	paceSecPerKm?: number;
	reps?: number;
	repDistanceMeters?: number;
	family?: 'running' | 'cycling' | 'ebike';
}

export interface RouteInput {
	kind: RouteKind;
	distanceMeters?: number | null;
	elevationMeters?: number | null;
	variants: RouteVariant[];
}

export interface VariantEffort {
	label: string;
	effort: number;
	durationMin: number;
	/** Kort menneskelig beskrivelse: «8,0 km @ 5:30» / «10×200 m». */
	detail: string;
}

function fmtPace(secPerKm: number): string {
	const m = Math.floor(secPerKm / 60);
	const s = Math.round(secPerKm - m * 60);
	return `${m}:${s.toString().padStart(2, '0')}`;
}

function fmtKm(meters: number): string {
	const km = meters / 1000;
	return (km % 1 === 0 ? km.toFixed(0) : km.toFixed(1).replace('.', ',')) + ' km';
}

/**
 * Effort for én variant. `easyPaceSecPerKm` er brukerens referanse for
 * intensitets-justering av løp (samme (typisk/økt)²-modell som effort-service,
 * klampet [0.75, 1.5]). Null → flat MET.
 */
export function variantEffort(
	route: RouteInput,
	variant: RouteVariant,
	easyPaceSecPerKm: number | null
): VariantEffort {
	const family = variant.family ?? (route.kind === 'bike' ? 'cycling' : 'running');

	// Bakke/intervall: reps × (dragtid + hvile-jogg), effort på løping i drag-fart
	if (variant.reps && variant.repDistanceMeters) {
		const dragKm = variant.repDistanceMeters / 1000;
		const dragPace = variant.paceSecPerKm ?? 300; // hardt default
		const dragSec = dragKm * dragPace;
		const recoverySec = dragKm * HILL_RECOVERY_PACE; // tilbake ned/jogg
		const totalSec = variant.reps * (dragSec + recoverySec);
		const durationMin = totalSec / 60;
		// Intervall-intensitet: bruk drag-farten mot easy-pace, hele økta
		const intensity = easyPaceSecPerKm
			? clamp((easyPaceSecPerKm / dragPace) ** 2, 0.75, 1.5)
			: 1.3;
		const effort = Math.round(durationMin * RUN_MET * MET_CALIBRATION * intensity);
		return {
			label: variant.label,
			effort,
			durationMin: Math.round(durationMin),
			detail: `${variant.reps}×${variant.repDistanceMeters} m`
		};
	}

	// Distansebasert (løp/tur/sykkel på en fast rute)
	const distanceMeters = route.distanceMeters ?? 0;
	if (family === 'cycling' || family === 'ebike') {
		// Sykkel: anta rutens distanse; fart fra variant (default 22 km/t sykkel, 20 el)
		const speedKmh = variant.paceSecPerKm ? 3600 / variant.paceSecPerKm : family === 'ebike' ? 20 : 22;
		const durationMin = distanceMeters > 0 ? (distanceMeters / 1000 / speedKmh) * 60 : 40;
		const met = family === 'ebike' ? EBIKE_MET : CYCLING_MET;
		return {
			label: variant.label,
			effort: Math.round(durationMin * met * MET_CALIBRATION),
			durationMin: Math.round(durationMin),
			detail: distanceMeters > 0 ? fmtKm(distanceMeters) : `${Math.round(durationMin)} min`
		};
	}

	// Løp: pace fra variant, intensitet mot easy-pace. Høydemeter legger på
	// klatre-ekvivalent distanse (100 hm ≈ 1 km flatt) — så en kupert rute koster
	// mer i både tid og effort uavhengig av farten. På sti gulves intensiteten
	// høyere (sakte ≠ lett): høydemeteren og terrenget bærer belastningen, ikke
	// pace-modellen som ellers ville lest en langsom stiøkt som rolig.
	const pace = variant.paceSecPerKm ?? easyPaceSecPerKm ?? 400;
	const km = distanceMeters / 1000;
	const elevation = route.elevationMeters ?? 0;
	const climbKm = elevation > 0 ? elevation / VERTICAL_M_PER_EQUIV_KM : 0;
	const durationMin = ((km + climbKm) * pace) / 60;
	const isTrail = route.kind === 'trail';
	const floor = isTrail ? TRAIL_INTENSITY_FLOOR : ROAD_INTENSITY_FLOOR;
	const intensity = easyPaceSecPerKm
		? clamp((easyPaceSecPerKm / pace) ** 2, floor, 1.5)
		: isTrail
			? TRAIL_INTENSITY_FLOOR
			: 1;
	const effort = Math.round(durationMin * RUN_MET * MET_CALIBRATION * intensity);
	const climbNote = elevation > 0 ? ` · ${elevation} hm` : '';
	return {
		label: variant.label,
		effort,
		durationMin: Math.round(durationMin),
		detail: distanceMeters > 0 ? `${fmtKm(distanceMeters)} @ ${fmtPace(pace)}${climbNote}` : `@ ${fmtPace(pace)}`
	};
}

export function routeEffortRange(
	route: RouteInput,
	easyPaceSecPerKm: number | null
): { variants: VariantEffort[]; minEffort: number; maxEffort: number } {
	const variants = route.variants.map((v) => variantEffort(route, v, easyPaceSecPerKm));
	const efforts = variants.map((v) => v.effort);
	return {
		variants,
		minEffort: efforts.length ? Math.min(...efforts) : 0,
		maxEffort: efforts.length ? Math.max(...efforts) : 0
	};
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

/**
 * Startruter som seedes ved plan-oppsett — brukerens egne eksempler, klare
 * til å redigeres. Distanser/fart er plassholdere som justeres i UI.
 */
export function defaultRouteSeeds(easyPaceSecPerKm: number | null): Array<{
	name: string;
	kind: RouteKind;
	distanceMeters: number | null;
	elevationMeters: number | null;
	terrain: string | null;
	variants: RouteVariant[];
}> {
	const easy = easyPaceSecPerKm ?? 400;
	const moderate = Math.round(easy * 0.9);
	const threshold = Math.round(easy * 0.82);
	return [
		{
			name: 'Pendlerunde',
			kind: 'run',
			distanceMeters: 8000,
			elevationMeters: null,
			terrain: 'vei',
			variants: [
				{ label: 'Rolig', paceSecPerKm: easy },
				{ label: 'Moderat', paceSecPerKm: moderate },
				{ label: 'Terskel', paceSecPerKm: threshold }
			]
		},
		{
			name: 'Pendlerunde (sykkel)',
			kind: 'bike',
			distanceMeters: 8000,
			elevationMeters: null,
			terrain: 'vei',
			variants: [
				{ label: 'Sykkel', family: 'cycling' },
				{ label: 'El-sykkel', family: 'ebike' }
			]
		},
		{
			name: 'Vannrunden',
			kind: 'trail',
			distanceMeters: 6000,
			elevationMeters: 80,
			terrain: 'variert / sti',
			variants: [
				{ label: 'Rolig', paceSecPerKm: Math.round(easy * 1.05) },
				{ label: 'Jevnt', paceSecPerKm: easy }
			]
		},
		{
			name: 'Motbakke 200 m',
			kind: 'hill',
			distanceMeters: null,
			elevationMeters: null,
			terrain: 'bakke',
			variants: [
				{ label: '6 × 200 m', reps: 6, repDistanceMeters: 200, paceSecPerKm: 300 },
				{ label: '10 × 200 m', reps: 10, repDistanceMeters: 200, paceSecPerKm: 300 }
			]
		}
	];
}
