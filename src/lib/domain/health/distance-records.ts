/**
 * Distanserekorder og PR-flagg.
 *
 * Se `docs/changelog/2026-08-11-distanserekorder.md`.
 *
 * Grunnlaget er `bestEfforts` på `canonical_workouts` — raskeste sammenhengende
 * strekk på hver distanse innad i en økt. De har vært regnet og lagret hele
 * tiden, men bare brukt til VDOT-estimering; ingen flate viste dem.
 *
 * **«Satte PR» og «holder rekorden» er to ulike flagg, og bare det første hører
 * på en økt.** Holder-rekorden flytter seg når du slår den, så merket ville
 * forsvunnet fra en økt du husker som god — og lista ble et øyeblikksbilde
 * framfor en historikk. «Satte PR» er en fakta om økta som aldri endrer seg.
 *
 * Det betyr at flagget måles mot øktene FØR den, aldri mot hele settet. Samme
 * prinsipp som at en median holder dagens observasjon utenfor seg selv.
 *
 * Ren modul.
 */

/** Distansene vi fører rekord på, korteste først. */
export const RECORD_DISTANCES = [
	{ key: '400m', meters: 400, label: '400 m' },
	{ key: '1k', meters: 1000, label: '1 km' },
	{ key: '3k', meters: 3000, label: '3 km' },
	{ key: '5k', meters: 5000, label: '5 km' },
	{ key: '10k', meters: 10000, label: '10 km' }
] as const;

export type RecordDistanceKey = (typeof RECORD_DISTANCES)[number]['key'];

export type RecordWorkout = {
	/**
	 * `sensor_events.id` for klyngen — det aktivitetssida slår opp på.
	 *
	 * **`null` når klyngen ikke har et evidence-event å peke på.** Rekorden er
	 * fortsatt sann; det er bare lenka som mangler. En tom streng eller
	 * `canonical_workouts.id` ville gitt en lenke som ser ut å virke og gir 404.
	 */
	activityId: string | null;
	startTime: Date;
	sportFamily: string;
	/** Sekunder per distansenøkkel, som lagret. */
	bestEfforts: Partial<Record<string, number>> | null;
};

/**
 * Bare løping.
 *
 * En «5 km-rekord» på sykkel er en annen øvelse, og el-sykkelens er motorens.
 * Blandes de, blir rekordlista uleselig.
 */
export const RECORD_SPORT_FAMILY = 'running';

export type DistanceRecord = {
	key: RecordDistanceKey;
	label: string;
	seconds: number;
	/** Økta som holder rekorden, eller `null` når den ikke kan lenkes til. */
	activityId: string | null;
	date: Date;
};

/**
 * Raskeste tid et menneske har løpt hver distanse — verdensrekorden, i sekunder.
 *
 * Terskelen er VERDENSREKORD og ikke «fort», og det er et bevisst valg: alt under
 * er ikke en god økt, det er en måling som ikke kan være riktig. Er den her, er
 * årsaken en feilmerket idrett eller en GPS-artefakt, aldri en prestasjon.
 *
 * Felttest 17. august: en elsykkeltur til jobb ble lagret som løping, og
 * «tidenes raskeste 5 km» havnet i Ekko, Resonans OG Strava. Tempoet var
 * 2:29/km, altså 12:25 over fem kilometer — tolv sekunder RASKERE enn
 * verdensrekorden. En vakt på «urimelig fort» ville sluppet det gjennom; en vakt
 * på rekorden gjør det ikke.
 *
 * Vakten hindrer ikke feilmerkingen, den hindrer at den forurenser rekordlista,
 * VO2max-estimatet og formkurven. Rot-årsaken hører i appen.
 */
const WORLD_RECORD_SECONDS: Record<string, number> = {
	'400m': 43, // 43,03 (Johnson)
	'1k': 132, // 2:11,96 (Ngeny)
	'3k': 440, // 7:20,67 (Komen)
	'5k': 755, // 12:35,36 (Cheptegei)
	'10k': 1571 // 26:11,00 (Cheptegei)
};

/**
 * Sann når tida er raskere enn noe menneske har løpt distansen.
 *
 * Ukjent distansenøkkel gir `false` — en ny nøkkel uten rekord skal ikke stille
 * forsvinne fra lista. Legger du en distanse i `RECORD_DISTANCES`, legg rekorden her.
 */
export function isImplausibleEffort(key: string, seconds: number): boolean {
	const floor = WORLD_RECORD_SECONDS[key];
	return floor !== undefined && seconds < floor;
}

function effort(workout: RecordWorkout, key: string): number | null {
	const value = workout.bestEfforts?.[key];
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
	// Umulige tider forkastes framfor å konkurrere: én feilmerket økt ville ellers
	// holdt rekorden på alle distanser for alltid, og skjult de ekte tallene.
	return isImplausibleEffort(key, value) ? null : value;
}

function eligible(workout: RecordWorkout): boolean {
	return workout.sportFamily === RECORD_SPORT_FAMILY && workout.bestEfforts != null;
}

/**
 * Beste tid per distanse over alle økter, med hvilken økt som holder den.
 *
 * Distanser ingen økt har et tall for utelates helt — en rad som sier «—» ser
 * ut som en manglende måling, når svaret er at du aldri har løpt så langt.
 */
export function distanceRecords(workouts: RecordWorkout[]): DistanceRecord[] {
	const records: DistanceRecord[] = [];

	for (const { key, label } of RECORD_DISTANCES) {
		let best: DistanceRecord | null = null;
		for (const workout of workouts) {
			if (!eligible(workout)) continue;
			const seconds = effort(workout, key);
			if (seconds === null) continue;
			if (best === null || seconds < best.seconds) {
				best = { key, label, seconds, activityId: workout.activityId, date: workout.startTime };
			}
		}
		if (best) records.push(best);
	}

	return records;
}

/**
 * Distansene denne økta satte PR på, målt mot øktene før den.
 *
 * **Første gang du løper en distanse er ikke en PR.** Uten tidligere tall å slå
 * ville hver ny distanse gitt et rekordflagg, og «PR» sluttet å bety noe.
 * Returnerer derfor bare distanser der det fantes et tall å slå.
 */
export function recordsSetBy(
	workout: RecordWorkout,
	priorWorkouts: RecordWorkout[]
): DistanceRecord[] {
	if (!eligible(workout)) return [];

	const earlier = priorWorkouts.filter(
		(w) => eligible(w) && w.startTime.getTime() < workout.startTime.getTime()
	);

	const set: DistanceRecord[] = [];
	for (const { key, label } of RECORD_DISTANCES) {
		const seconds = effort(workout, key);
		if (seconds === null) continue;

		const previous = earlier
			.map((w) => effort(w, key))
			.filter((v): v is number => v !== null);
		if (previous.length === 0) continue;

		if (seconds < Math.min(...previous)) {
			set.push({ key, label, seconds, activityId: workout.activityId, date: workout.startTime });
		}
	}

	return set;
}

/** «5:12» / «23:20» / «1:02:14». */
export function formatRecordTime(seconds: number): string {
	const total = Math.round(seconds);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
	return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Krydderteksten for en PR, eller null.
 *
 * Den **lengste** distansen vinner når en økt satte flere: en 5 km-rekord er en
 * større nyhet enn 400 m-rekorden som ligger inni den, og de kommer nesten
 * alltid sammen.
 */
export function recordNuggetText(records: DistanceRecord[]): string | null {
	if (records.length === 0) return null;
	const byDistance = [...records].sort((a, b) => {
		const order = RECORD_DISTANCES.map((d) => d.key);
		return order.indexOf(b.key) - order.indexOf(a.key);
	});
	const best = byDistance[0];
	const extra = records.length > 1 ? ` (+${records.length - 1} til)` : '';
	return `Ny ${best.label}-rekord: ${formatRecordTime(best.seconds)}!${extra}`;
}
