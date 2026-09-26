/**
 * Samples fra en innendørsøkt: tid, kumulativ distanse fra enheten, høyde og puls –
 * uten posisjon.
 *
 * ## Hvorfor et eget felt, og ikke punkter i `trackPoints`
 *
 * `trackPoints` er et GPS-spor. Alt som leser feltet tegner kart, måler sporlengde
 * med haversine, låner spor mellom kilder i klynga eller leter etter «glemt
 * tracker» – og alt det ville fått punkter uten koordinater. En mølleøkt fra Ekko
 * (september 2026) har ingen posisjon, men den har en pulskurve og en fartskurve.
 * De bor her, i `data.samples`, og leses bare av det som trenger en TIDSSERIE:
 * grafene og pulsfordelingen på øktsiden, og soneanalysen.
 *
 * Et sample har samme form som et sporpunkt minus posisjonen, pluss `dist`. Både
 * `$lib/utils/track-stats` og `workout-analytics` bruker `dist` når den finnes, så
 * samplene kan gis til de samme funksjonene som et spor.
 *
 * Kontrakten mot Ekko står i `docs/ekko-molle.md`.
 */

export interface WorkoutSample {
	/** ISO-tidspunkt. */
	time: string;
	/** Kumulativ distanse i meter, fra enheten (mølla: det brukeren tastet, kalibrert). */
	dist: number;
	ele?: number;
	hr?: number;
}

/**
 * Leser `data.samples` defensivt. Rader er skrevet av serveren selv, men feltet er
 * jsonb, og en leser skal aldri velte på en rad den ikke forventet.
 */
export function readWorkoutSamples(raw: unknown): WorkoutSample[] {
	if (!Array.isArray(raw)) return [];
	const out: WorkoutSample[] = [];
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue;
		const s = item as Record<string, unknown>;
		if (typeof s.time !== 'string' || typeof s.dist !== 'number' || !Number.isFinite(s.dist)) continue;
		out.push({
			time: s.time,
			dist: s.dist,
			...(typeof s.ele === 'number' && Number.isFinite(s.ele) ? { ele: s.ele } : {}),
			...(typeof s.hr === 'number' && Number.isFinite(s.hr) ? { hr: s.hr } : {})
		});
	}
	return out;
}

/**
 * Tidsserien grafer og analyse skal lese: sporet når økta har et, ellers samplene.
 *
 * Sporet vinner alltid. En økt med GPS har ingen samples i dag, men skulle en kilde
 * skrive begge, er sporet det rikeste – og kartet og grafene skal beskrive det samme.
 */
export function profileSeries<T extends object>(trackPoints: T[], samples: WorkoutSample[]): Array<T | WorkoutSample> {
	return trackPoints.length >= 2 ? trackPoints : samples.length >= 2 ? samples : trackPoints;
}
