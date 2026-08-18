/**
 * Radene som duplikatarbeidet vurderer — én laster for både ryddingen og diagnosen.
 *
 * Fram til 18. august 2026 lå denne lesingen inni `deactivate-superseded.ts`, altså inni en
 * SKRIVEjobb. Diagnosen måtte derfor POSTe mot skriveendepunktet med `dryRun=true` for å se
 * hva som sto igjen. Det er feil verktøy å polle: en diagnose skal kunne kjøres hundre ganger
 * uten at noen tenker på om den skriver.
 *
 * Den viktigere grunnen er den samme som ellers i dette arbeidet: **to veier inn til samme tall
 * driver fra hverandre.** Statusnormaliseringen, overføringsvakten og vindusberegningen er
 * kalibrering, ikke plumbing — hadde diagnosen hatt sin egen kopi, ville den svart på et litt
 * annet spørsmål enn ryddingen og ingen ville sett hvorfor.
 *
 * Se `docs/changelog/2026-08-12-livslop-forsvinning.md`.
 */

import { db } from '$lib/db';
import { canonicalBankTransactions } from '$lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { findInternalTransfers } from '$lib/domain/economics/internal-transfers';
import { looksLikeTransferText } from '$lib/domain/economics/reservation-matching';

/**
 * Statusen som tri-tilstand. **Ukjent er ukjent** — den gjettes ikke til noen av sidene.
 *
 * `latestBookingStatus` er nullable, og rader skrevet før statuslogikken eller uten feltet fra
 * banken havner der. Å regne dem som reservasjoner var feilen tørrkjøringen avslørte:
 * `bookingStatusRank` returnerer 0 for «ingen status», så `rank < topRank` gjorde «vi vet ikke»
 * til «ubokført reservasjon», og planen foreslo å deaktivere overføringer.
 */
export function normalizeBookingStatus(value: string | null): 'pending' | 'booked' | 'unknown' {
	const status = (value ?? '').trim().toUpperCase();
	if (status === 'BOOKED') return 'booked';
	if (status === 'PENDING') return 'pending';
	return 'unknown';
}

export type DuplicateCandidateRow = {
	id: string;
	accountId: string;
	/** YYYY-MM-DD, Oslo-dagen slik canonical lagret den. */
	date: string;
	/** Negativ = ut av kontoen. **Eksakt**, ikke avrundet — hele beløpsdriften bor i desimalene. */
	amount: number;
	merchantKey: string;
	description: string;
	/**
	 * Valutaen canonical lagret. **Uavhengig bekreftelse** på at et valutaprefiks i beskrivelsen
	 * faktisk ER en valutakode og ikke en del av butikknavnet — to signaler fra ulike felt.
	 */
	currency: string;
	typeText: string;
	status: 'pending' | 'booked' | 'unknown';
	/** Begge bein av overføringen finnes hos oss — en observasjon. */
	pairedTransfer: boolean;
	/** Radens egen tekst peker på overføring — en lesning av ordbruk, svakere. */
	textTransfer: boolean;
	/** Union av de to. Det er denne matchingen og diagnosen skal bruke. */
	internalTransfer: boolean;
};

export type DuplicateCandidates = {
	fromDate: string;
	rows: DuplicateCandidateRow[];
	counts: {
		rowsConsidered: number;
		unknownStatus: number;
		pairedTransfers: number;
		/** Bare tekstfunnene som IKKE alt var parvis matchet, så tallene ikke overlapper. */
		textOnlyTransfers: number;
	};
};

function toDateKey(value: unknown): string {
	return typeof value === 'string' ? value.slice(0, 10) : String(value).slice(0, 10);
}

/**
 * Aktive canonical-rader i vinduet, med status og overføringsflagg påført.
 *
 * **Leser canonical, ikke rå-strømmen.** `is_active` bor på canonical, og en jobb som måler på
 * ett lag og skriver på et annet kan avvike uten at noe sier fra. Bankdiagnosen måler rått fordi
 * den svarer på hva banken sendte; dette svarer på hva vi teller.
 *
 * **Bare aktive rader.** En rad som alt er deaktivert skal ikke kunne bli en motpart, og det er
 * det som gjør ryddingen idempotent.
 */
export async function loadDuplicateCandidates(
	userId: string,
	options: { days: number }
): Promise<DuplicateCandidates> {
	const fromDate = new Date(Date.now() - options.days * 86400000).toISOString().slice(0, 10);

	const raw = await db
		.select({
			id: canonicalBankTransactions.id,
			accountId: canonicalBankTransactions.accountId,
			date: canonicalBankTransactions.canonicalDate,
			amount: canonicalBankTransactions.amount,
			merchantKey: canonicalBankTransactions.merchantKey,
			currency: canonicalBankTransactions.currency,
			// **Statusen leses eksplisitt, ikke utledet av rangen.** Se `normalizeBookingStatus`.
			bookingStatus: canonicalBankTransactions.latestBookingStatus,
			description: canonicalBankTransactions.descriptionDisplay,
			// `typeText` er SB1s `category`, og ofte det eneste stedet ordet «overføring» står.
			typeText: canonicalBankTransactions.typeText
		})
		.from(canonicalBankTransactions)
		.where(
			and(
				eq(canonicalBankTransactions.userId, userId),
				eq(canonicalBankTransactions.isActive, true),
				sql`${canonicalBankTransactions.canonicalDate} >= ${fromDate}::date`
			)
		);

	// Interne overføringer identifiseres med DEN DELTE matchingen, ikke en egen variant. De går i
	// runde beløp som gjentas (2 500, 4 000, 7 600), og to separate overføringer på samme beløp
	// innen tre dager ville ellers blitt paret som reservasjon + bokført.
	const transfers = findInternalTransfers(
		raw.map((row) => ({
			id: row.id,
			accountId: row.accountId,
			date: toDateKey(row.date),
			amount: Number(row.amount) || 0
		}))
	);

	let unknownStatus = 0;
	let pairedTransfers = 0;
	let textOnlyTransfers = 0;

	const rows: DuplicateCandidateRow[] = raw.map((row) => {
		const status = normalizeBookingStatus(row.bookingStatus);
		const pairedTransfer = transfers.internalIds.has(row.id);
		// **To uavhengige signaler, og det svakere er nødvendig.** Den parvise matchingen er en
		// observasjon (begge bein finnes) og treffer ikke overføringer fra kontoer vi ikke synker.
		// Tekstlesingen fanger dem, og de telles hver for seg så det er synlig hvilken som gjorde
		// jobben.
		const textTransfer = looksLikeTransferText(row);
		if (status === 'unknown') unknownStatus += 1;
		if (pairedTransfer) pairedTransfers += 1;
		if (textTransfer && !pairedTransfer) textOnlyTransfers += 1;
		return {
			id: row.id,
			accountId: row.accountId,
			date: toDateKey(row.date),
			amount: Number(row.amount) || 0,
			merchantKey: row.merchantKey ?? '',
			currency: row.currency ?? '',
			description: row.description ?? '',
			typeText: row.typeText ?? '',
			status,
			pairedTransfer,
			textTransfer,
			internalTransfer: pairedTransfer || textTransfer
		};
	});

	return {
		fromDate,
		rows,
		counts: {
			rowsConsidered: rows.length,
			unknownStatus,
			pairedTransfers,
			textOnlyTransfers
		}
	};
}
