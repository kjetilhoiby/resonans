/**
 * Én vei inn til banktransaksjoner. Alt som teller kroner skal gå gjennom denne fila.
 *
 * Bakgrunn (`docs/changelog/2026-08-11-okonomi-tillitsgjennomgang.md`): domenet hadde tre
 * parallelle lagre, og hvilket et endepunkt leste avgjordes av når koden ble skrevet. Målt
 * mot prod over 365 dager:
 *
 * | Lager | Rader | Forbruk |
 * |-------|------:|--------:|
 * | `sensor_events` | 8 891 | 6 008 834 kr |
 * | `canonical_bank_transactions` | 2 245 | 1 583 723 kr |
 * | `categorized_events` | 2 043 | 1 481 802 kr |
 *
 * Brukeren så «ulike tall på ulike steder» og sluttet å åpne flaten. `sensor_events` er
 * ~3,8× for høy fordi dedupliseringens sikkerhetsnett bare dekker det ferske synkvinduet.
 *
 * **Canonical er sannheten.** Dedupen bor der: bøttenøkkelen kollapser observasjoner av
 * samme transaksjon, og `status_rank` løfter PENDING → BOOKED i samme rad.
 *
 * To ting denne leseren gjør som ingen kaller skal gjøre selv:
 *
 * 1. **Kategoriserer én gang**, med merchant-mappings, manuelle overstyringer og DB-regler
 *    lastet én gang per kall. Tidligere gjentok hver flate dette med ulike argumenter.
 * 2. **Merker interne overføringer.** De skal ikke telle som forbruk (68 % av «forbruket»
 *    var flytting mellom egne kontoer), men de skal ikke forsvinne heller — et uttak fra
 *    sparekontoen er nettopp en intern overføring, og det er signalet sparefunksjonen
 *    trenger.
 */

import { db, rowsOf } from '$lib/db';
import { canonicalBankTransactions } from '$lib/db/schema';
import { and, desc, eq, sql } from 'drizzle-orm';
import { categorizeTransaction } from '$lib/server/integrations/transaction-categories';
import type { CategoryId } from '$lib/integrations/transaction-categories-client';
import { loadMerchantMappings } from '$lib/server/integrations/spending-analyzer';
import {
	loadClassificationOverrides,
	loadTransactionMatchingRules
} from '$lib/server/classification-overrides';
import {
	findInternalTransfers,
	type InternalTransferResult
} from '$lib/domain/economics/internal-transfers';

// Summeringen bor i domenelaget så den kan testes uten DB. Re-eksporteres her fordi
// kallerne henter alt annet herfra.
export {
	summarizeSpending,
	recurringKeyFor,
	type SpendingSummary,
	type CategoryTotal
} from '$lib/domain/economics/spending-summary';

export type EconomicsTransaction = {
	/** `canonical_bank_transactions.id` — stabil, og det prosjektkoblinger skal peke på. */
	id: string;
	/** YYYY-MM-DD. Canonical lagrer dato, ikke tidspunkt. */
	date: string;
	/** Midt på dagen i UTC, for kallere som trenger et Date-objekt. Se `canonicalDateToUtcDate`. */
	timestamp: Date;
	accountId: string;
	/** Negativ = ut av kontoen. */
	amount: number;
	description: string;
	merchantKey: string;
	typeText: string | null;
	bookingStatus: string | null;
	category: CategoryId;
	label: string;
	emoji: string;
	isFixed: boolean;
	subcategory: string | null;
	/** Sann når raden har en motpost på en annen egen konto samme dag. */
	isInternalTransfer: boolean;
	/** Kontoen pengene kom fra / gikk til, når `isInternalTransfer`. */
	counterAccountId: string | null;
};

export type ReadTransactionsOptions = {
	userId: string;
	/** Inklusiv, YYYY-MM-DD eller Date. */
	from: Date | string;
	/** Eksklusiv, YYYY-MM-DD eller Date. Utelates = i dag + 1 dag. */
	to?: Date | string;
	accountId?: string;
	/**
	 * Utelat interne overføringer fra resultatet. **Bruk dette for forbrukstall.**
	 * Standard er `false`, altså alt med — leseren skjuler ingenting av seg selv, den
	 * merker. En kaller som teller forbruk må si det.
	 */
	excludeInternalTransfers?: boolean;
	sortBy?: 'date' | 'amount';
	limit?: number;
};

export type TransactionsResult = {
	transactions: EconomicsTransaction[];
	/**
	 * Overføringene som ble funnet i vinduet, uansett `excludeInternalTransfers`.
	 * Dette er inngangen til sparebevegelser: `links` bærer beløp, dato og begge kontoene.
	 */
	internalTransfers: InternalTransferResult;
};

function toDateString(value: Date | string): string {
	return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

/**
 * Canonical lagrer `date`, ikke `timestamp`. Midt på dagen i UTC gjør at en
 * `toISOString().slice(0, 10)` hos en kaller gir samme dato tilbake uansett tidssone —
 * midnatt ville tippet over til dagen før for negative offsets.
 */
export function canonicalDateToUtcDate(value: string | Date): Date {
	if (value instanceof Date) {
		return new Date(
			Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 12, 0, 0, 0)
		);
	}
	if (value.includes('T')) {
		const parsed = new Date(value);
		return new Date(
			Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate(), 12, 0, 0, 0)
		);
	}
	return new Date(`${value}T12:00:00Z`);
}

/**
 * Leser transaksjoner fra canonical, kategoriserer dem og merker interne overføringer.
 *
 * NB: `limit` klippes **etter** at overføringene er funnet, ellers ville en motpost like
 * utenfor grensa gjort at den andre siden så ut som et ekte kjøp.
 */
export async function readTransactions(
	options: ReadTransactionsOptions
): Promise<TransactionsResult> {
	const { userId, accountId, excludeInternalTransfers = false, sortBy = 'date', limit } = options;

	const fromDate = toDateString(options.from);
	const toDate = options.to
		? toDateString(options.to)
		: toDateString(new Date(Date.now() + 24 * 60 * 60 * 1000));

	const conditions = [
		eq(canonicalBankTransactions.userId, userId),
		eq(canonicalBankTransactions.isActive, true),
		sql`${canonicalBankTransactions.canonicalDate} >= ${fromDate}::date`,
		sql`${canonicalBankTransactions.canonicalDate} < ${toDate}::date`
	];
	if (accountId) conditions.push(eq(canonicalBankTransactions.accountId, accountId));

	const [rows, merchantMappings, overrides, rules] = await Promise.all([
		db
			.select({
				id: canonicalBankTransactions.id,
				date: canonicalBankTransactions.canonicalDate,
				accountId: canonicalBankTransactions.accountId,
				amount: canonicalBankTransactions.amount,
				description: canonicalBankTransactions.descriptionDisplay,
				merchantKey: canonicalBankTransactions.merchantKey,
				typeText: canonicalBankTransactions.typeText,
				bookingStatus: canonicalBankTransactions.latestBookingStatus
			})
			.from(canonicalBankTransactions)
			.where(and(...conditions))
			.orderBy(desc(canonicalBankTransactions.canonicalDate)),
		loadMerchantMappings(userId),
		loadClassificationOverrides(userId, 'transaction'),
		loadTransactionMatchingRules()
	]);

	// Overføringene finnes over HELE vinduet, før filtrering og klipping.
	const internalTransfers = findInternalTransfers(
		rows.map((row) => ({
			id: row.id,
			accountId: row.accountId,
			date: toDateString(row.date),
			amount: Number(row.amount) || 0
		}))
	);

	let transactions: EconomicsTransaction[] = rows.map((row) => {
		const amount = Number(row.amount) || 0;
		const description = (row.description ?? row.merchantKey ?? '').trim();
		const classified = categorizeTransaction(
			description,
			row.typeText,
			amount,
			merchantMappings,
			overrides,
			rules
		);

		return {
			id: row.id,
			date: toDateString(row.date),
			timestamp: canonicalDateToUtcDate(row.date),
			accountId: row.accountId,
			amount,
			description,
			merchantKey: row.merchantKey,
			typeText: row.typeText,
			bookingStatus: row.bookingStatus,
			category: classified.category,
			label: classified.label,
			emoji: classified.emoji,
			isFixed: classified.isFixed,
			subcategory: classified.subcategory ?? null,
			isInternalTransfer: internalTransfers.internalIds.has(row.id),
			counterAccountId: internalTransfers.counterAccountById.get(row.id) ?? null
		};
	});

	if (excludeInternalTransfers) {
		transactions = transactions.filter((tx) => !tx.isInternalTransfer);
	}

	if (sortBy === 'amount') {
		transactions.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
	}

	if (limit !== undefined && limit > 0) {
		transactions = transactions.slice(0, limit);
	}

	return { transactions, internalTransfers };
}

/**
 * Siste kjente saldo per konto.
 *
 * Bor her fordi saldoene fortsatt leses fra `sensor_events` (`bank_balance`) — canonical
 * dekker transaksjoner, ikke saldo — og fordi den forrige utgaven hentet **alle**
 * saldorader noensinne uten datofilter og plukket den ferskeste i JS.
 */
export async function readLatestBalances(
	userId: string,
	options: { sinceDays?: number } = {}
): Promise<
	Array<{
		accountId: string;
		accountName: string | null;
		accountType: string | null;
		accountNumber: string | null;
		balance: number;
		availableBalance: number | null;
		currency: string | null;
		observedAt: Date;
	}>
> {
	// Ett år, ikke «alt». En konto uten en eneste saldoobservasjon på et år er borte, og
	// forrige utgave hentet hver saldorad som noensinne var skrevet for å finne den ferskeste.
	const sinceDays = options.sinceDays ?? 365;
	const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

	// **Saldoen og NAVNET kommer fra ulike rader, med vilje.**
	//
	// PDF-importerte kontoutskrifter skriver `bank_balance`-ankre med bare `accountId`,
	// `accountNumber`, `balance` og `currency` — ingen `accountName`, ingen `accountType`
	// (`routes/api/admin/import-statements`). Et rent `DISTINCT ON … ORDER BY timestamp DESC`
	// ville derfor gitt navn = null for enhver konto der det ferskeste ankeret er
	// PDF-importert, og konsekvensen var stille: `looksLikeSavingsAccount` leser nettopp navn
	// og type, så sparekontoen ville falt ut av bufferflaten uten et ord.
	//
	// Derfor: saldoen fra den nyeste raden, identiteten fra den nyeste raden som HAR den.
	const rows = await db.execute(sql`
		WITH balance_rows AS (
			SELECT
				data->>'accountId'   AS account_id,
				data->>'accountName' AS account_name,
				data->>'accountType' AS account_type,
				data->>'accountNumber' AS account_number,
				(data->>'balance')::numeric AS balance,
				(data->>'availableBalance')::numeric AS available_balance,
				data->>'currency'    AS currency,
				timestamp            AS observed_at
			FROM sensor_events
			WHERE user_id = ${userId}
			  AND data_type = 'bank_balance'
			  AND timestamp >= ${since.toISOString()}
			  AND data->>'accountId' IS NOT NULL
		),
		latest AS (
			SELECT DISTINCT ON (account_id)
				account_id, balance, available_balance, currency, account_number, observed_at
			FROM balance_rows
			ORDER BY account_id, observed_at DESC
		),
		named AS (
			SELECT DISTINCT ON (account_id)
				account_id, account_name, account_type, account_number
			FROM balance_rows
			WHERE account_name IS NOT NULL
			ORDER BY account_id, observed_at DESC
		)
		SELECT
			l.account_id,
			n.account_name,
			n.account_type,
			COALESCE(l.account_number, n.account_number) AS account_number,
			l.balance,
			l.available_balance,
			l.currency,
			l.observed_at
		FROM latest l
		LEFT JOIN named n ON n.account_id = l.account_id
	`);

	return rowsOf<{
		account_id: string;
		account_name: string | null;
		account_type: string | null;
		account_number: string | null;
		balance: string;
		available_balance: string | null;
		currency: string | null;
		observed_at: string | Date;
	}>(rows)
		.filter((row) => Boolean(row.account_id))
		.map((row) => ({
			accountId: row.account_id,
			accountName: row.account_name,
			accountType: row.account_type,
			accountNumber: row.account_number,
			balance: Number(row.balance) || 0,
			availableBalance: row.available_balance === null ? null : Number(row.available_balance),
			currency: row.currency,
			observedAt: row.observed_at instanceof Date ? row.observed_at : new Date(row.observed_at)
		}))
		.sort((a, b) => b.balance - a.balance);
}
