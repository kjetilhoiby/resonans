/**
 * Deaktiver reservasjoner som er erstattet av en bokført rad.
 *
 * Fase 3 i `docs/changelog/2026-08-11-okonomi-tillitsgjennomgang.md`, målt i
 * `docs/changelog/2026-08-12-livslop-forsvinning.md`.
 *
 * SB1 leverer samme kjøp først som reservasjon (PENDING), så som bokført (BOOKED), og **både
 * datoen og beskrivelsen kan endre seg** mellom versjonene. Bøttenøkkelen inneholder begge, så
 * de to havner i ulike rader og beløpet telles to ganger. Målt i prod over 90 dager:
 * **249 par, 152 982 kr — 27 % av nettoforbruket**.
 *
 * Tre valg som ikke er kosmetiske:
 *
 * 1. **Leser CANONICAL, ikke rå-strømmen.** `is_active` bor på canonical, og en fix som måler
 *    på ett lag og skriver på et annet kan avvike uten at noe sier fra. Diagnosen måler rått
 *    fordi den svarer på hva banken sendte; fixen leser der den skriver.
 * 2. **`is_active = false`, ALDRI slett.** Å telle for mye er trygt å rette; å fjerne noe
 *    brukeren faktisk gjorde er det ikke. Samme regel som for treningsøkter, og den gjør
 *    dessuten en feilaktig deaktivering reversibel.
 * 3. **Dry-run er standard.** Kalleren må be om å skrive. En jobb som endrer 249 rader skal
 *    ikke kunne kjøres ved et uhell, og planen skal kunne leses før den utføres — som
 *    `reprojiser?dryRun=true` på trening.
 *
 * **Både forbruk og inntekt deaktiveres.** Et dobbelttalt lønnsinnskudd blåser opp inntekten
 * på samme måte som et dobbelttalt kjøp blåser opp forbruket. De rapporteres for seg fordi
 * tallene ikke skal summeres, men begge er duplikater.
 */

import { db } from '$lib/db';
import { canonicalBankTransactions } from '$lib/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { findInternalTransfers } from '$lib/domain/economics/internal-transfers';
import {
	doubleCountedTotals,
	matchReservationsToBooked,
	type ReservationCandidate,
	type ReservationMatch
} from '$lib/domain/economics/reservation-matching';

/** Hvor stor bolk som oppdateres per spørring. Postgres tåler mer, men logglinjene blir lesbare. */
const UPDATE_CHUNK = 200;

export type DeactivateResult = {
	dryRun: boolean;
	/** Retningen som ville blitt skrevet. Standard `out` — bare forbruk. */
	direction: 'out' | 'in' | 'all';
	/** Antall par innenfor `direction`. `pairs` er alt som ble FUNNET. */
	selectedPairs: number;
	window: { days: number; fromDate: string };
	/** Aktive canonical-rader vurdert. */
	rowsConsidered: number;
	/** Rader med status PENDING som ikke er interne overføringer. */
	reservations: number;
	/**
	 * Rader hoppet over fordi statusen er UKJENT — verken PENDING eller BOOKED.
	 *
	 * Skal rapporteres. Første utgave regnet dem som reservasjoner (`statusRank >= topRank` er
	 * falsk for rank 0), og tørrkjøringen i prod foreslo da å deaktivere overføringer.
	 */
	skippedUnknownStatus: number;
	/** Rader hoppet over fordi de er interne overføringer. */
	skippedInternalTransfers: number;
	pairs: { out: number; in: number };
	doubleCounted: { spend: number; income: number };
	/** Reservasjoner uten en ledig bokført motpart — ekte ubokførte, eller endret beløp. */
	unmatched: number;
	/** Rader som faktisk fikk `is_active = false`. 0 ved dry-run. */
	deactivated: number;
	/** Et utvalg par, så planen kan leses før den utføres. */
	samples: Array<{
		reservationId: string;
		bookedId: string;
		amount: number;
		direction: 'out' | 'in';
		deltaDays: number;
		merchantKeyChanged: boolean;
		reservationDate: string;
		bookedDate: string;
		reservationMerchantKey: string;
		bookedMerchantKey: string;
	}>;
};

const MAX_SAMPLES = 25;

function toDateKey(value: unknown): string {
	return typeof value === 'string' ? value.slice(0, 10) : String(value).slice(0, 10);
}

/**
 * Statusen som tri-tilstand. **Ukjent er ukjent** — den gjettes ikke til noen av sidene.
 *
 * `latestBookingStatus` er nullable, og rader skrevet før statuslogikken eller uten feltet fra
 * banken havner der. Å regne dem som reservasjoner var feilen tørrkjøringen avslørte.
 */
function normalizeStatus(value: string | null): 'pending' | 'booked' | 'unknown' {
	const status = (value ?? '').trim().toUpperCase();
	if (status === 'BOOKED') return 'booked';
	if (status === 'PENDING') return 'pending';
	return 'unknown';
}

export async function deactivateSupersededReservations(
	userId: string,
	options: {
		days: number;
		dryRun?: boolean;
		maxDeltaDays?: number;
		/**
		 * Hvilken retning som skal deaktiveres. **Standard er `out`, altså bare forbruk.**
		 *
		 * Tørrkjøringen viste at `inn`-parene fortsatt bar preg av runde overføringsbeløp
		 * (23 000 ×2, 15 000, 12 500) som ingen kunne sette navn på, mens `ut`-parene hadde
		 * ujevne beløp som er signaturen på ekte reservasjon→bokføring. De to har ulik
		 * troverdighet og skal derfor ikke skrives i samme operasjon.
		 */
		direction?: 'out' | 'in' | 'all';
	}
): Promise<DeactivateResult> {
	const dryRun = options.dryRun !== false;
	const fromDate = new Date(Date.now() - options.days * 86400000).toISOString().slice(0, 10);

	// Bare AKTIVE rader. En rad som alt er deaktivert skal ikke kunne bli en motpart, og et
	// gjentatt kall skal ikke finne de samme parene om igjen — det er det som gjør jobben
	// idempotent.
	const rows = await db
		.select({
			id: canonicalBankTransactions.id,
			accountId: canonicalBankTransactions.accountId,
			date: canonicalBankTransactions.canonicalDate,
			amount: canonicalBankTransactions.amount,
			merchantKey: canonicalBankTransactions.merchantKey,
			// **Statusen leses eksplisitt, ikke utledet av rangen.** `bookingStatusRank` gir 0
			// for manglende status, så `rank < topRank` gjorde «ukjent» til «reservasjon».
			bookingStatus: canonicalBankTransactions.latestBookingStatus
		})
		.from(canonicalBankTransactions)
		.where(
			and(
				eq(canonicalBankTransactions.userId, userId),
				eq(canonicalBankTransactions.isActive, true),
				sql`${canonicalBankTransactions.canonicalDate} >= ${fromDate}::date`
			)
		);

	// Interne overføringer identifiseres med DEN DELTE matchingen, ikke en egen variant.
	// De går i runde beløp som gjentas (2 500, 4 000, 7 600), og to separate overføringer på
	// samme beløp innen tre dager ville blitt paret som reservasjon + bokført.
	const transfers = findInternalTransfers(
		rows.map((row) => ({
			id: row.id,
			accountId: row.accountId,
			date: toDateKey(row.date),
			amount: Number(row.amount) || 0
		}))
	);

	let skippedUnknownStatus = 0;
	let skippedInternalTransfers = 0;

	const candidates: ReservationCandidate[] = rows.map((row) => {
		const status = normalizeStatus(row.bookingStatus);
		const internalTransfer = transfers.internalIds.has(row.id);
		if (status === 'unknown') skippedUnknownStatus += 1;
		if (internalTransfer) skippedInternalTransfers += 1;
		return {
			id: row.id,
			accountId: row.accountId,
			date: toDateKey(row.date),
			amount: Number(row.amount) || 0,
			merchantKey: row.merchantKey ?? '',
			status,
			internalTransfer
		};
	});

	const { matches, unmatched } = matchReservationsToBooked(candidates, {
		maxDeltaDays: options.maxDeltaDays
	});

	const direction = options.direction ?? 'out';
	const selected = matches.filter(
		(m) => direction === 'all' || m.direction === direction
	);

	const totals = doubleCountedTotals(matches);
	let deactivated = 0;

	if (!dryRun && selected.length > 0) {
		const ids = selected.map((m) => m.reservationId);
		for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
			const chunk = ids.slice(i, i + UPDATE_CHUNK);
			const updated = await db
				.update(canonicalBankTransactions)
				.set({ isActive: false, updatedAt: new Date() })
				.where(
					and(
						eq(canonicalBankTransactions.userId, userId),
						inArray(canonicalBankTransactions.id, chunk),
						// Fortsatt aktiv. Uten dette kunne to samtidige kjøringer tellt samme rad
						// to ganger i `deactivated`.
						eq(canonicalBankTransactions.isActive, true)
					)
				)
				.returning({ id: canonicalBankTransactions.id });
			deactivated += updated.length;
		}
		console.log(
			`[deactivate-superseded] user=${userId} days=${options.days} direction=${direction} selected=${selected.length} deactivated=${deactivated} spend=${Math.round(totals.spend)} income=${Math.round(totals.income)}`
		);
	}

	return {
		dryRun,
		direction,
		/** Par som VILLE blitt skrevet med gjeldende retning. Skiller funn fra handling. */
		selectedPairs: selected.length,
		window: { days: options.days, fromDate },
		rowsConsidered: rows.length,
		reservations: candidates.filter((c) => c.status === 'pending' && !c.internalTransfer).length,
		skippedUnknownStatus,
		skippedInternalTransfers,
		pairs: {
			out: matches.filter((m) => m.direction === 'out').length,
			in: matches.filter((m) => m.direction === 'in').length
		},
		doubleCounted: { spend: Math.round(totals.spend), income: Math.round(totals.income) },
		unmatched: unmatched.length,
		deactivated,
		samples: pickSamples(matches)
	};
}

/**
 * Et utvalg par til inspeksjon: de største først, siden det er dem en feil ville kostet mest.
 */
function pickSamples(matches: readonly ReservationMatch[]): DeactivateResult['samples'] {
	return [...matches]
		.sort((a, b) => b.amount - a.amount)
		.slice(0, MAX_SAMPLES)
		.map((m) => ({
			reservationId: m.reservationId,
			bookedId: m.bookedId,
			amount: m.amount,
			direction: m.direction,
			deltaDays: m.deltaDays,
			merchantKeyChanged: m.merchantKeyChanged,
			reservationDate: m.reservationDate,
			bookedDate: m.bookedDate,
			reservationMerchantKey: m.reservationMerchantKey,
			bookedMerchantKey: m.bookedMerchantKey
		}));
}
