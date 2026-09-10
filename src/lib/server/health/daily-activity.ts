/**
 * daily-activity.ts — døgnraden fra klokka: bevegelse og laveste puls.
 *
 * Withings' `activity`-hendelse er ETT sammendrag per døgn, og de tre feltene
 * denne fila leser bor i den samme raden. Derfor én spørring og tre kart, ikke
 * tre lesere som henter de samme radene etter hverandre.
 *
 * ## Puls: ett bevisst valg av kilde
 *
 * `hr_min` betyr ulike ting per `data_type` (se `heart-rate-baseline.ts`): fra
 * `sleep` er det hvilepuls under søvn, fra `workout` er det laveste puls UNDER
 * trening (90–120), og punktpulsen vekta måler (`weight.restingHeartRate`) er
 * tatt STÅENDE og ligger 5–15 slag over ekte hvilepuls.
 *
 * Her leses bare `activity` — «dagens laveste målte puls». Det er den eneste av
 * dem som finnes hver dag uten at brukeren gjør noe, og et forløp som blandet
 * inn punktpuls på veiedagene ville vist et hopp på 5–15 slag som ser ut som en
 * endring i kroppen. Samme lærdom som «serien bruker én forbrukskilde, aldri
 * blandet».
 *
 * Sovepuls er et ANNET spørsmål og har sin egen vei inn (`loadSleepHeartRate`).
 * Denne skal aldri brukes til å svare på «ligger hvilepulsen høyere enn
 * vanlig?» — det er den lesningen som ble konsolidert i september 2026.
 *
 * ## Bevegelse: to spørsmål, ikke ett
 *
 * Skritt og aktive minutter er ikke to visninger av det samme. En dag i senga
 * med en tur på butikken gir skritt uten intensitet; en spinningtime gir
 * intensitet uten mange skritt. I et sykdomsforløp er begge svar man vil ha —
 * «kom jeg meg ut av senga» og «orket jeg noe».
 */

import { and, asc, eq, gte } from 'drizzle-orm';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { osloDayKey } from '$lib/domain/oslo-time';

export const DAILY_ACTIVITY_DATA_TYPE = 'activity';

/** Menneskelig navn på kilden. Følger tallet inn i flaten — se regel 3 i sick-episode. */
export const DAILY_HR_SOURCE_LABEL = 'laveste målte puls per døgn, fra klokka';
export const DAILY_STEPS_SOURCE_LABEL = 'fra klokka';

/**
 * **Aktive minutter er `moderate + intense`, ikke `soft`.**
 *
 * Withings teller `soft` som «lett aktivitet», og en vanlig kontordag gir
 * timevis av den bare av å gå rundt. Tas den med, måler raden hvor mye man var
 * oppe av stolen — som er nesten det samme som at klokka satt på håndleddet, og
 * dermed flatt gjennom et forløp der nettopp INTENSITETEN forsvant. Navnet
 * står i kilden fordi «aktive minutter» betyr ulike ting i ulike apper.
 */
export const DAILY_ACTIVE_MINUTES_SOURCE_LABEL = 'moderat + intens aktivitet, fra klokka';

export interface DailyActivity {
	/** Dagsnøkkel → laveste puls det døgnet. */
	hrMin: Map<string, number>;
	/** Dagsnøkkel → skritt. */
	steps: Map<string, number>;
	/** Dagsnøkkel → minutter moderat + intens aktivitet. */
	activeMinutes: Map<string, number>;
}

function numeric(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Døgnrader fra klokka, som tre kart nøklet på Oslo-dag.
 *
 * Flere `activity`-rader per dag skal ikke skje (upserten er unik på
 * sensor + type + tidspunkt), men skjer det, slås de sammen med feltets egen
 * regel: puls er et MINIMUM, så to minima slås sammen ved å ta det minste;
 * skritt og minutter er SUMMER, så de legges sammen.
 */
export async function readDailyActivity(
	userId: string,
	sinceDays: number
): Promise<DailyActivity> {
	const since = new Date(Date.now() - sinceDays * 86_400_000);
	const rows = await db
		.select({ timestamp: sensorEvents.timestamp, data: sensorEvents.data })
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, DAILY_ACTIVITY_DATA_TYPE),
				gte(sensorEvents.timestamp, since)
			)
		)
		.orderBy(asc(sensorEvents.timestamp));

	const hrMin = new Map<string, number>();
	const steps = new Map<string, number>();
	const activeMinutes = new Map<string, number>();

	for (const row of rows) {
		const data = row.data as Record<string, unknown> | null;
		const day = osloDayKey(row.timestamp);

		const hr = numeric(data?.hr_min);
		if (hr !== null && hr > 0) {
			const existing = hrMin.get(day);
			if (existing === undefined || hr < existing) hrMin.set(day, hr);
		}

		const stepCount = numeric(data?.steps);
		if (stepCount !== null && stepCount >= 0) {
			steps.set(day, (steps.get(day) ?? 0) + stepCount);
		}

		// Sekunder hos Withings. Feltene er uavhengige: en dag kan ha `moderate`
		// uten `intense`, så en manglende halvdel skal ikke gjøre dagen umålt.
		const moderate = numeric(data?.moderate) ?? 0;
		const intense = numeric(data?.intense) ?? 0;
		if (data?.moderate !== undefined || data?.intense !== undefined) {
			const minutes = Math.round((moderate + intense) / 60);
			activeMinutes.set(day, (activeMinutes.get(day) ?? 0) + minutes);
		}
	}

	return { hrMin, steps, activeMinutes };
}
