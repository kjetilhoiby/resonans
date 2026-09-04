/**
 * Når en `running`-rad i `background_jobs` skal ryddes — og til hva.
 *
 * ## Problemet: en `running`-rad uten eier er en løgn
 *
 * Målt i prod 4. september 2026 sto tre `batch:withings_backfill` i `running`
 * med `locked_by = null` og `started_at` 28 døgn tilbake. Ingen prosess eide
 * dem, ingen kom til å fullføre dem, og de blokkerte ingenting — men tabellen
 * påsto at noe kjørte. `/api/diagnostikk` flagget dem som `stuck` og hadde rett.
 *
 * ## To helt ulike måter å bli stående på, og de skal ikke behandles likt
 *
 * **Worker-jobber** claimes av `claimNextDueJob`, som setter `status`,
 * `locked_at` og `locked_by` i ÉN atomisk UPDATE. En slik rad har alltid en
 * eier. Dør workeren (redeploy ved hver push, eller et OOM-drap som 3.–4.
 * september), står raden låst av en worker som ikke finnes. Den kan trygt
 * kjøres om igjen → `retry` mens forsøk gjenstår, ellers `failed`.
 *
 * **Batch-jobber** (`batch:*`) settes rett i `running` av `startBatchJob`, helt
 * uten lås, og drives av en LØKKE I NETTLESEREN som kaller
 * `/api/admin/batch/step`. Lukker brukeren fanen, er det ingen som fortsetter.
 * Ingen worker kan overta dem heller: `executeJob` har ingen `batch:*`-gren, så
 * en requeue ville gitt tre runder «Unknown background job type» før den endte
 * i `failed` uansett — samme utfall, med en feiltekst som peker feil vei.
 * Derfor går de RETT i `failed`, med en tekst som sier hva som faktisk skjedde.
 *
 * Invarianten dette hviler på: **den som skriver `running` uten lås, skriver en
 * jobb ingen worker kan kjøre.** Legger du til en jobbtype som starter i
 * `running`, gi den enten en lås eller regn med at den blir feilet her.
 *
 * ## Hvorfor «ingen eier» ikke kan måles på `started_at`
 *
 * En batch som faktisk kjører i en åpen fane har også `locked_by = null` — den
 * kan ha stått i `running` i timer og likevel være i live. Det som skiller
 * levende fra forlatt er at `stepBatchJob` skriver `updated_at` for HVERT steg.
 * En aktiv batch rører raden med sekunders mellomrom; en forlatt blir stille.
 * Alderen måles derfor mot `updatedAt`, aldri mot `startedAt`.
 */

export type StaleJobOutcome = 'leave' | 'retry' | 'fail';

/** Feltene avgjørelsen trenger. Dato-feltene er `Date | null` — kalleren
 *  konverterer fra postgres-js sine rå strenger med `toDate` først. */
export interface StaleJobRow {
	status: string;
	attempts: number;
	maxAttempts: number;
	lockedAt: Date | null;
	lockedBy: string | null;
	updatedAt: Date | null;
}

export interface StaleJobDecision {
	outcome: StaleJobOutcome;
	/** Skrives til `error`-kolonnen når utfallet ikke er `leave`. Norsk, og den
	 *  skal si HVA som skjedde — raden leses av et menneske som lurer. */
	reason: string;
}

/**
 * Hvor lenge en worker-låst jobb får kjøre før leasen regnes som død.
 *
 * Romslig med vilje. En `sparebank1_historical_sync` over et år, eller en
 * `workout_projection_refresh` over hele historikken, tar minutter — og
 * `locked_at` settes ÉN gang ved claim, det finnes ingen heartbeat som sier at
 * jobben lever. Er terskelen for stram, requeuer vi en jobb som fortsatt
 * kjører, og en bank-import gjøres to ganger samtidig. Prisen for å være
 * romslig er at en ekte krasj venter opptil en time på nytt forsøk; for en
 * bakgrunnssynk er det en billigere feil.
 *
 * (Var 15 minutter fram til september 2026. Heartbeat er den egentlige
 * løsningen og er ikke bygget — se changeloggen.)
 *
 * NB: `STUCK_AFTER_MINUTES` (30) i `diagnostics-jobs.ts` er et ANNET tall med
 * en annen jobb. Den sier «verdt å se på» i det åpne diagnose-API-et; denne
 * sier «vi griper inn». Terskelen for å handle skal ligge over terskelen for å
 * flagge — ellers ryddes en rad bort før noen rekker å se at den sto der.
 */
export const LEASE_EXPIRY_MINUTES = 60;

/**
 * Hvor lenge en eierløs `running`-rad får være stille før den regnes som
 * forlatt.
 *
 * Måles mot `updated_at`, som en aktiv batch skriver for hvert steg. Ett steg
 * er én dag med data — sekunder, og med rate-limit-backoff noen minutter.
 * Tretti minutters stillhet er derfor ikke en treg batch, det er en lukket fane.
 */
export const ABANDONED_AFTER_MINUTES = 30;

function minutesSince(then: Date | null, now: Date): number | null {
	if (!then) return null;
	const ms = now.getTime() - then.getTime();
	return Number.isFinite(ms) ? ms / 60_000 : null;
}

export function decideStaleJob(row: StaleJobRow, now: Date = new Date()): StaleJobDecision {
	if (row.status !== 'running') {
		return { outcome: 'leave', reason: '' };
	}

	// Eierskap avgjøres av `locked_by` — det er workeren som signerer der.
	// `locked_at` er lease-klokka, men en rad med eier og uten klokke skal ikke
	// bli udødelig: da faller vi tilbake på `updated_at`.
	if (row.lockedBy) {
		const age = minutesSince(row.lockedAt ?? row.updatedAt, now);
		if (age == null || age >= LEASE_EXPIRY_MINUTES) {
			const canRetry = row.attempts < row.maxAttempts;
			return canRetry
				? {
						outcome: 'retry',
						reason: `Worker-leasen utløp (${LEASE_EXPIRY_MINUTES} min uten livstegn) — lagt tilbake i køen.`
					}
				: {
						outcome: 'fail',
						reason: `Worker-leasen utløp (${LEASE_EXPIRY_MINUTES} min uten livstegn), og forsøkene er brukt opp.`
					};
		}
		return { outcome: 'leave', reason: '' };
	}

	const quietFor = minutesSince(row.updatedAt, now);
	if (quietFor != null && quietFor < ABANDONED_AFTER_MINUTES) {
		return { outcome: 'leave', reason: '' };
	}

	return {
		outcome: 'fail',
		reason: `Jobben sto i «running» uten eier og uten livstegn på ${ABANDONED_AFTER_MINUTES} min. Batch-jobber drives av en løkke i nettleseren; denne ble forlatt. Start den på nytt for å fortsette.`
	};
}
