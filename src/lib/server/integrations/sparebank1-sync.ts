import { db, pgClient } from '$lib/db';
import { sensorEvents, sensors } from '$lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { SensorEventService } from '$lib/server/services/sensor-event-service';
import { createHash } from 'node:crypto';
import { hasFormatPrefix, merchantKeyFromDescription } from '$lib/domain/economics/merchant-key';
import { recordSensorSyncFailure } from '$lib/server/sensors/sync-status';
import { toPgArrayLiteral } from '$lib/db/pg-array';
import {
	loadSalaryProfile,
	buildSalaryProfile,
	isPaycheck,
	type SalaryProfile
} from './salary-profile';
import {
	fetchSparebank1Accounts,
	fetchSparebank1HelloWorld,
	fetchSparebank1Transactions,
	isUnauthorized,
	type RateLimitSnapshot
} from './sparebank1';
import {
	getValidSparebank1AccessToken,
	refreshAfterUnauthorized
} from './sparebank1-token';

function parseNumber(value: unknown): number | undefined {
	if (typeof value === 'number' && !Number.isNaN(value)) return value;
	if (typeof value === 'string') {
		const parsed = Number(value.replace(',', '.'));
		return Number.isNaN(parsed) ? undefined : parsed;
	}
	if (typeof value === 'object' && value !== null) {
		const amountValue = (value as any).amount ?? (value as any).value;
		return parseNumber(amountValue);
	}
	return undefined;
}

/**
 * Bøttenøkkelen bor i `$lib/domain/economics/merchant-key.ts`, med tester.
 *
 * Den lå her, privat og utestet, fram til 18. august 2026 — samtidig som den avgjør hvilke
 * transaksjoner som blir én rad og hvilke som blir to, altså alt som teller kroner. Aliaset
 * beholdes fordi navnet brukes på seks steder i denne fila og betyr det samme.
 */
const normalizeTxDescription = merchantKeyFromDescription;

function bookingStatusRank(value: unknown): number {
	const status = typeof value === 'string' ? value.toUpperCase() : '';
	if (status === 'BOOKED') return 20;
	if (status === 'PENDING') return 10;
	return 0;
}

function rawFingerprintForEvent(event: any): string {
	const txDate = event.timestamp.toISOString().split('T')[0];
	const amount = Math.round((Number(event.data.amount ?? 0) || 0) * 100) / 100;
	const descriptionRaw = String(event.data.description ?? '');
	const descriptionNorm = normalizeTxDescription(event.data.description);
	const externalId = String(event.metadata?.transactionId ?? '');
	const booking = String(event.data.bookingStatus ?? '');
	const accountId = String(event.data.accountId ?? '');
	const sensorId = String(event.sensorId ?? '');
	const payload = `${sensorId}|${accountId}|${txDate}|${amount}|${descriptionNorm}|${descriptionRaw}|${externalId}|${booking}`;
	return createHash('sha256').update(payload).digest('hex');
}

/**
 * Skriver rå-versjoner og canonical-rader.
 *
 * **`rawEvents` skal være PRE-kollaps, `canonicalEvents` POST-kollaps.** Fram til
 * 2026-08 ble begge kalt med den kollapsede batchen, og det gjorde
 * `raw_bank_transaction_versions` til noe annet enn navnet sier: `batchMap` kollapser på
 * nøyaktig bøttenøkkelen (konto, dato, beskrivelse, beløp), så rå-tabellen kunne per
 * konstruksjon aldri ha mer enn én rad per bøtte per svar. Antallet gjentatte kjøp — sju
 * øl samme kveld — var da umulig å måle, og en diagnose mot tabellen ga alltid
 * multiplisitet 1 uansett hva som faktisk hadde skjedd.
 *
 * Rå-strømmen er append-only og nøkles på `raw_fingerprint`, som inkluderer
 * `externalTransactionId`. Sju separate kjøp har sju ulike ID-er og får derfor sju rader.
 * Canonical er uendret: den upserter per bøtte, så flere rå-rader inn gir samme
 * canonical-rad ut, bare med høyere `evidence_count`.
 */
async function writeRawAndCanonicalTransactions(
	rawEvents: any[],
	canonicalEvents: any[],
	userId: string,
	sensorId: string,
	salaryProfile: SalaryProfile | null
): Promise<void> {
	if (rawEvents.length === 0 && canonicalEvents.length === 0) return;

	// Pre-compute all derived values in JS — no DB roundtrips here.
	const toRow = (event: any) => {
		const txDate = event.timestamp.toISOString().split('T')[0];
		const amount = Math.round((Number(event.data.amount ?? 0) || 0) * 100) / 100;
		const descriptionRaw = String(event.data.description ?? '');
		const descriptionNorm = normalizeTxDescription(event.data.description);
		const bookingStatus = String(event.data.bookingStatus ?? '').toUpperCase() || '';
		const statusRank = bookingStatusRank(bookingStatus || null);
		const externalId = String(event.metadata?.transactionId ?? '');
		const currency = String(event.data.currency ?? 'NOK');
		const typeText = String(event.data.category ?? '');
		const fingerprint = rawFingerprintForEvent(event);
		const accountId = String(event.data.accountId ?? '');
		const paycheckType = salaryProfile
			? (isPaycheck({ amount, description: descriptionRaw, date: txDate }, salaryProfile) ?? null)
			: null;
		return {
			userId, sensorId, accountId, externalId, bookingStatus, statusRank,
			txDate, postedAt: event.timestamp.toISOString(), amount, currency,
			descriptionRaw, descriptionNorm, typeText,
			payload: JSON.stringify(event.data ?? {}),
			fingerprint, paycheckType
		};
	};

	const rawRows = rawEvents.map(toRow);
	const rows = canonicalEvents.map(toRow);

	// 1. Batch INSERT raw_bank_transaction_versions — one query for all rows.
	//    NB: bruker rawRows (pre-kollaps), ikke rows. Se doc-kommentaren over.
	if (rawRows.length > 0) await pgClient.unsafe(
		`INSERT INTO raw_bank_transaction_versions (
			user_id, sensor_id, account_id, external_transaction_id, booking_status, status_rank,
			transaction_date, posted_at, amount, currency, description_raw, description_normalized,
			merchant_key, type_text, payload, raw_fingerprint, first_seen_at, last_seen_at, seen_count,
			created_at, updated_at
		)
		SELECT
			u, s::uuid, a, NULLIF(e, ''), NULLIF(bs, ''), sr,
			td::date, pa::timestamp, amt, cur, dr, dn,
			dn, NULLIF(tt, ''), p::jsonb, fp, NOW(), NOW(), 1,
			NOW(), NOW()
		FROM UNNEST(
			$1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::int[],
			$7::text[], $8::text[], $9::numeric[], $10::text[], $11::text[], $12::text[],
			$13::text[], $14::text[], $15::text[]
		) AS t(u, s, a, e, bs, sr, td, pa, amt, cur, dr, dn, tt, fp, p)
		ON CONFLICT (raw_fingerprint) DO UPDATE SET
			last_seen_at = NOW(),
			seen_count = raw_bank_transaction_versions.seen_count + 1,
			booking_status = EXCLUDED.booking_status,
			status_rank = GREATEST(raw_bank_transaction_versions.status_rank, EXCLUDED.status_rank),
			description_raw = EXCLUDED.description_raw,
			description_normalized = EXCLUDED.description_normalized,
			merchant_key = EXCLUDED.merchant_key,
			updated_at = NOW()`,
		[
			toPgArrayLiteral(rawRows.map((r) => r.userId)),
			toPgArrayLiteral(rawRows.map((r) => r.sensorId)),
			toPgArrayLiteral(rawRows.map((r) => r.accountId)),
			toPgArrayLiteral(rawRows.map((r) => r.externalId)),
			toPgArrayLiteral(rawRows.map((r) => r.bookingStatus)),
			toPgArrayLiteral(rawRows.map((r) => r.statusRank)),
			toPgArrayLiteral(rawRows.map((r) => r.txDate)),
			toPgArrayLiteral(rawRows.map((r) => r.postedAt)),
			toPgArrayLiteral(rawRows.map((r) => r.amount)),
			toPgArrayLiteral(rawRows.map((r) => r.currency)),
			toPgArrayLiteral(rawRows.map((r) => r.descriptionRaw)),
			toPgArrayLiteral(rawRows.map((r) => r.descriptionNorm)),
			toPgArrayLiteral(rawRows.map((r) => r.typeText)),
			toPgArrayLiteral(rawRows.map((r) => r.fingerprint)),
			toPgArrayLiteral(rawRows.map((r) => r.payload))
		]
	);

	// 2. Batch UPSERT canonical_bank_transactions — one query for all rows.
	//    paycheck_type is computed in JS and included here to avoid a separate UPDATE pass.
	//    NB: bruker rows (post-kollaps). Flere rå-rader i samme bøtte skal bli én
	//    canonical-rad; det er nettopp arbeidsdelingen mellom de to tabellene.
	if (rows.length === 0) return;
	await pgClient.unsafe(
		`INSERT INTO canonical_bank_transactions (
			user_id, sensor_id, account_id, canonical_date, amount, currency, merchant_key,
			description_display, type_text, latest_booking_status, status_rank, latest_posted_at,
			first_seen_at, last_seen_at, evidence_count, is_active, paycheck_type, created_at, updated_at
		)
		SELECT
			u, s::uuid, a, td::date, amt, cur, mk,
			dr, NULLIF(tt, ''), NULLIF(bs, ''), sr, pa::timestamp,
			NOW(), NOW(), 1, TRUE, NULLIF(pt, ''), NOW(), NOW()
		FROM UNNEST(
			$1::text[], $2::text[], $3::text[], $4::text[], $5::numeric[], $6::text[], $7::text[],
			$8::text[], $9::text[], $10::int[], $11::text[], $12::text[], $13::text[]
		) AS t(u, s, a, td, amt, cur, mk, dr, bs, sr, pa, pt, tt)
		ON CONFLICT (sensor_id, account_id, canonical_date, amount, merchant_key) DO UPDATE SET
			currency = EXCLUDED.currency,
			-- typeText fylles bare inn, aldri tømmes: en senere observasjon uten feltet
			-- skal ikke slette kategoriteksten vi alt har.
			type_text = COALESCE(EXCLUDED.type_text, canonical_bank_transactions.type_text),
			-- Visningsteksten: to av SB1s vaner peker i MOTSATT retning, og skillet er
			-- suffiks mot prefiks.
			--
			--   Trunkering: «SPORT 1 RINDAL RINDALSVEG» mot «SPORT 1 RINDAL RINDALSVEGEN RINDAL».
			--     Den korte er et PREFIKS av den lange → den LANGE er mest komplett.
			--   Formatprefiks: «OPENAI» mot «USD OPENAI».
			--     Den korte er en SUFFIKS av den lange → den KORTE er butikkens navn.
			--
			-- Uten det andre tilfellet vinner «USD OPENAI» etter at bøttenøkkelen begynte å
			-- strippe valutakoden, og kategoriseringen — som leser beskrivelsen — blir dårligere
			-- av en opprydding som skulle gjort den bedre.
			--
			-- RIGHT(...) framfor LIKE '%' || x: en beskrivelse kan inneholde understrek og
			-- prosenttegn («Google Workspace_hoi.by»), som er jokertegn i LIKE og ville gitt
			-- løsere treff enn tilsiktet.
			-- Mellomromskravet hindrer at «NORDEA»/«EA» leses som samme navn.
			description_display = CASE
				WHEN EXCLUDED.status_rank > canonical_bank_transactions.status_rank THEN EXCLUDED.description_display
				WHEN EXCLUDED.status_rank < canonical_bank_transactions.status_rank THEN canonical_bank_transactions.description_display
				-- Ny tekst er kortere OG en suffiks av den lagrede → formatprefiks, ta den nye.
				WHEN LENGTH(COALESCE(EXCLUDED.description_display, '')) < LENGTH(COALESCE(canonical_bank_transactions.description_display, ''))
					AND UPPER(COALESCE(EXCLUDED.description_display, '')) = RIGHT(UPPER(COALESCE(canonical_bank_transactions.description_display, '')), LENGTH(COALESCE(EXCLUDED.description_display, '')))
					AND SUBSTRING(canonical_bank_transactions.description_display FROM LENGTH(canonical_bank_transactions.description_display) - LENGTH(EXCLUDED.description_display) FOR 1) = ' '
					THEN EXCLUDED.description_display
				-- Lagret tekst er kortere OG en suffiks av den nye → behold den lagrede.
				WHEN LENGTH(COALESCE(canonical_bank_transactions.description_display, '')) < LENGTH(COALESCE(EXCLUDED.description_display, ''))
					AND UPPER(COALESCE(canonical_bank_transactions.description_display, '')) = RIGHT(UPPER(COALESCE(EXCLUDED.description_display, '')), LENGTH(COALESCE(canonical_bank_transactions.description_display, '')))
					AND SUBSTRING(EXCLUDED.description_display FROM LENGTH(EXCLUDED.description_display) - LENGTH(canonical_bank_transactions.description_display) FOR 1) = ' '
					THEN canonical_bank_transactions.description_display
				-- Ellers: trunkering, og den lengste er mest komplett. Uendret oppførsel.
				WHEN LENGTH(COALESCE(EXCLUDED.description_display, '')) > LENGTH(COALESCE(canonical_bank_transactions.description_display, ''))
					THEN EXCLUDED.description_display
				ELSE canonical_bank_transactions.description_display
			END,
			latest_booking_status = CASE
				WHEN EXCLUDED.status_rank >= canonical_bank_transactions.status_rank THEN EXCLUDED.latest_booking_status
				ELSE canonical_bank_transactions.latest_booking_status
			END,
			status_rank = GREATEST(canonical_bank_transactions.status_rank, EXCLUDED.status_rank),
			latest_posted_at = CASE
				WHEN EXCLUDED.latest_posted_at > canonical_bank_transactions.latest_posted_at THEN EXCLUDED.latest_posted_at
				ELSE canonical_bank_transactions.latest_posted_at
			END,
			last_seen_at = NOW(),
			evidence_count = canonical_bank_transactions.evidence_count + 1,
			is_active = TRUE,
			paycheck_type = COALESCE(EXCLUDED.paycheck_type, canonical_bank_transactions.paycheck_type),
			updated_at = NOW()`,
		[
			toPgArrayLiteral(rows.map((r) => r.userId)),
			toPgArrayLiteral(rows.map((r) => r.sensorId)),
			toPgArrayLiteral(rows.map((r) => r.accountId)),
			toPgArrayLiteral(rows.map((r) => r.txDate)),
			toPgArrayLiteral(rows.map((r) => r.amount)),
			toPgArrayLiteral(rows.map((r) => r.currency)),
			toPgArrayLiteral(rows.map((r) => r.descriptionNorm)), // merchant_key
			toPgArrayLiteral(rows.map((r) => r.descriptionRaw)),  // description_display
			toPgArrayLiteral(rows.map((r) => r.bookingStatus)),
			toPgArrayLiteral(rows.map((r) => r.statusRank)),
			toPgArrayLiteral(rows.map((r) => r.postedAt)),
			toPgArrayLiteral(rows.map((r) => r.paycheckType ?? '')),
			toPgArrayLiteral(rows.map((r) => r.typeText))
		]
	);

	// 3. Batch INSERT aliases — join back to canonical to find canonical_id by unique key.
	const aliasRows = rows.filter((r) => r.externalId);
	if (aliasRows.length > 0) {
		await pgClient.unsafe(
			`INSERT INTO canonical_bank_transaction_aliases (
				canonical_id, sensor_id, external_transaction_id,
				first_seen_at, last_seen_at, seen_count, created_at, updated_at
			)
			SELECT c.id, $1::uuid, t.external_id, NOW(), NOW(), 1, NOW(), NOW()
			FROM UNNEST($2::text[], $3::text[], $4::numeric[], $5::text[], $6::text[])
				AS t(account_id, canonical_date, amount, merchant_key, external_id)
			JOIN canonical_bank_transactions c ON (
				c.sensor_id = $1::uuid
				AND c.account_id = t.account_id
				AND c.canonical_date = t.canonical_date::date
				AND c.amount = t.amount
				AND c.merchant_key = t.merchant_key
			)
			ON CONFLICT (sensor_id, external_transaction_id) DO UPDATE SET
				canonical_id = EXCLUDED.canonical_id,
				last_seen_at = NOW(),
				seen_count = canonical_bank_transaction_aliases.seen_count + 1,
				updated_at = NOW()`,
			[
				sensorId,
				toPgArrayLiteral(aliasRows.map((r) => r.accountId)),
				toPgArrayLiteral(aliasRows.map((r) => r.txDate)),
				toPgArrayLiteral(aliasRows.map((r) => r.amount)),
				toPgArrayLiteral(aliasRows.map((r) => r.descriptionNorm)),
				toPgArrayLiteral(aliasRows.map((r) => r.externalId))
			]
		);
	}

}

export type Sparebank1TransactionDebugDecision =
	| 'queued_for_insert'
	| 'skipped_existing_in_db'
	| 'duplicate_in_batch'
	| 'replaced_by_booked_in_batch';

export type Sparebank1TransactionDebugRow = {
	accountId: string;
	timestamp: string;
	date: string;
	description: string;
	amount: number;
	bookingStatus: string | null;
	semanticKey: string;
	decision: Sparebank1TransactionDebugDecision;
	reason: string;
	transactionId?: string | null;
};

export type Sparebank1SyncDebug = {
	since: string | null;
	rawTransactionCount: number;
	uniqueTransactionCount: number;
	queuedForInsertCount: number;
	skippedExistingCount: number;
	duplicateInBatchCount: number;
	replacedByBookedInBatchCount: number;
	transactions: Sparebank1TransactionDebugRow[];
};

export type Sparebank1SyncResult = {
	balanceEvents: number;
	transactionEvents: number;
	accounts: number;
	accountNames: string[];
	rateLimitHeaders: RateLimitSnapshot;
	debug?: Sparebank1SyncDebug;
};

export async function wipeSparebank1EconomicsData(userId: string): Promise<{
	categorizedEvents: number;
	canonicalAliases: number;
	rawBankTransactionVersions: number;
	canonicalBankTransactions: number;
	sensorEvents: number;
}> {
	const rows = await pgClient.unsafe<{
		categorized_count: number;
		alias_count: number;
		raw_count: number;
		canonical_count: number;
		sensor_count: number;
	}[]>(`
		WITH deleted_categorized AS (
			DELETE FROM categorized_events
			WHERE user_id = $1
			RETURNING id
		), deleted_aliases AS (
			DELETE FROM canonical_bank_transaction_aliases a
			USING canonical_bank_transactions c
			WHERE a.canonical_id = c.id
			  AND c.user_id = $1
			RETURNING a.id
		), deleted_raw AS (
			DELETE FROM raw_bank_transaction_versions
			WHERE user_id = $1
			RETURNING id
		), deleted_canonical AS (
			DELETE FROM canonical_bank_transactions
			WHERE user_id = $1
			RETURNING id
		), deleted_sensor AS (
			DELETE FROM sensor_events
			WHERE user_id = $1
			  AND data_type IN ('bank_balance', 'bank_transaction')
			RETURNING id
		)
		SELECT
			(SELECT COUNT(*)::int FROM deleted_categorized) AS categorized_count,
			(SELECT COUNT(*)::int FROM deleted_aliases) AS alias_count,
			(SELECT COUNT(*)::int FROM deleted_raw) AS raw_count,
			(SELECT COUNT(*)::int FROM deleted_canonical) AS canonical_count,
			(SELECT COUNT(*)::int FROM deleted_sensor) AS sensor_count
	`, [userId]);

	const row = rows[0] ?? {
		categorized_count: 0,
		alias_count: 0,
		raw_count: 0,
		canonical_count: 0,
		sensor_count: 0
	};

	return {
		categorizedEvents: Number(row.categorized_count ?? 0),
		canonicalAliases: Number(row.alias_count ?? 0),
		rawBankTransactionVersions: Number(row.raw_count ?? 0),
		canonicalBankTransactions: Number(row.canonical_count ?? 0),
		sensorEvents: Number(row.sensor_count ?? 0)
	};
}

export async function getSparebank1Sensor(userId: string) {
	return db.query.sensors.findFirst({
		where: and(
			eq(sensors.userId, userId),
			eq(sensors.provider, 'sparebank1'),
			eq(sensors.isActive, true)
		),
		orderBy: (sensors, { desc }) => [desc(sensors.lastSync)]
	});
}

/**
 * Token-håndteringen bor i `sparebank1-token.ts`. Re-eksportert her fordi seks
 * kallsteder importerer den fra denne modulen — og fordi den gamle utgaven tok
 * et sensor-OBJEKT og leste legitimasjonen derfra. Den nye tar bare `id` og
 * leser alltid fra basen; se modul-kommentaren der for hvorfor det skillet er
 * hele rettelsen.
 */
export { getValidSparebank1AccessToken };

export async function syncAllSparebank1Data(
	userId: string,
	options: Sparebank1SyncOptions = {}
): Promise<Sparebank1SyncResult> {
	try {
		return await runSparebank1Sync(userId, options);
	} catch (err) {
		await recordSensorSyncFailure(userId, 'sparebank1', err);
		throw err;
	}
}

type Sparebank1SyncOptions = {
	fromDate?: Date;
	toDate?: Date;
	includeDebug?: boolean;
	resetBeforeImport?: boolean;
	skipExistingDedup?: boolean;
	prefetchedAccounts?: { accounts: any[]; accessToken?: string; rateLimitHeaders: RateLimitSnapshot };
	/** Pre-fetched transactions keyed by accountKey. Skips fetchSparebank1Transactions for matching accounts. */
	prefetchedTransactions?: Record<string, any[]>;
};

async function runSparebank1Sync(
	userId: string,
	options: Sparebank1SyncOptions = {}
): Promise<Sparebank1SyncResult> {
	const sensor = await getSparebank1Sensor(userId);

	if (!sensor) {
		throw new Error('No active SpareBank1 sensor found');
	}

	const since = options.fromDate ?? sensor.lastSync ?? undefined;
	const toDate = options.toDate;
	const includeDebug = options.includeDebug === true;
	const resetBeforeImport = options.resetBeforeImport === true;
	const skipExistingDedup = options.skipExistingDedup === true;
	const txDebugByEvent = new WeakMap<object, Sparebank1TransactionDebugRow>();
	const txDebugRows: Sparebank1TransactionDebugRow[] = [];
	const replacedPendingKeys = new Set<string>();
	let rawTransactionCount = 0;
	let uniqueTransactionCount = 0;

	if (resetBeforeImport) {
		const wiped = await wipeSparebank1EconomicsData(userId);
		console.log('[sparebank1-sync] replace-mode wipe completed', { userId, sensorId: sensor.id, wiped });
	}

	let accounts: any[];
	const rateLimitHeaders: RateLimitSnapshot = {};

	// Tokenet hentes LAT. Backfillen sender med et prefetchet sett der alle
	// transaksjonene alt ligger i payloaden, og da gjøres det ingen API-kall i
	// det hele tatt — å hente et token per chunk var ren rotasjonsslitasje på
	// refresh-kjeden. Se sparebank1-token.ts.
	let cachedToken: string | null = options.prefetchedAccounts?.accessToken ?? null;
	const resolveToken = async (): Promise<string> =>
		(cachedToken ??= await getValidSparebank1AccessToken(sensor));

	/**
	 * Kall SB1 med et gyldig token, og gjør ETT nytt forsøk etter en 401.
	 *
	 * Et token kan dø før `expires_at` sier — tilbakekalt, klokkeavvik, kortere
	 * levetid enn oppgitt. Uten dette ble en slik 401 en hard feil som bare en
	 * ny innlogging kunne rette. Retryen er bevisst ÉN: går den andre også i
	 * 401, er det ikke tokenet som er problemet.
	 */
	const callWithAuth = async <T>(fn: (token: string) => Promise<T>): Promise<T> => {
		const token = await resolveToken();
		try {
			return await fn(token);
		} catch (err) {
			if (!isUnauthorized(err)) throw err;
			const refreshed = await refreshAfterUnauthorized(sensor, token);
			cachedToken = refreshed;
			return fn(refreshed);
		}
	};

	if (options.prefetchedAccounts) {
		accounts = options.prefetchedAccounts.accounts;
		Object.assign(rateLimitHeaders, options.prefetchedAccounts.rateLimitHeaders);
	} else {
		await callWithAuth((token) => fetchSparebank1HelloWorld(token, rateLimitHeaders));
		accounts = await callWithAuth((token) => fetchSparebank1Accounts(token, rateLimitHeaders));
	}

	const balanceEvents = accounts.map((account) => {
		const timestamp =
			account.updatedAt || account.lastUpdated || account.timestamp || new Date().toISOString();

		return {
			userId,
			sensorId: sensor.id,
			eventType: 'measurement' as const,
			dataType: 'bank_balance',
			timestamp: new Date(timestamp),
			data: {
				accountId: account.key || account.accountKey || account.id || account.accountId || account.number,
				accountName: account.name || account.accountName,
				accountType: account.description || account.type || account.accountType,
				currency: account.currencyCode || account.currency || 'NOK',
				accountNumber: account.accountNumber || null,
				balance: parseNumber(account.balance ?? account.bookedBalance),
				availableBalance: parseNumber(account.availableBalance)
			},
			metadata: {
				provider: 'sparebank1',
				source: 'api',
				accountKey: account.key || null
			},
			source: 'sparebank1_api'
		};
	});

	// Dedup balance events: Only insert if not already present for same account + date
	if (balanceEvents.length > 0) {
		let newBalanceEvents = balanceEvents;
		if (!skipExistingDedup) {
			const existingBalanceRows = await db
				.select({
					accountId: sql<string>`data->>'accountId'`,
					date: sql<string>`timestamp::date`
				})
				.from(sensorEvents)
				.where(and(
					eq(sensorEvents.sensorId, sensor.id),
					eq(sensorEvents.dataType, 'bank_balance')
				));

			const existingBalanceKeys = new Set(
				existingBalanceRows.map((r) => `${r.accountId}:${r.date}`)
			);

			newBalanceEvents = balanceEvents.filter((e) => {
				const key = `${e.data.accountId}:${e.timestamp.toISOString().split('T')[0]}`;
				return !existingBalanceKeys.has(key);
			});
		}

		if (newBalanceEvents.length > 0) {
			await SensorEventService.writeMany(newBalanceEvents, {
				conflictMode: 'ignore'
			});
		}
	}

	let transactionEvents: any[] = [];

	const syncedAccountNames: string[] = [];

	if (accounts.length > 0) {
		// Fetch accounts sequentially to avoid hitting rate limits
		const results: any[][] = [];
		for (const account of accounts) {
			const accountKey = String(account.key || account.accountKey || account.id || account.accountId || account.number || '');
			if (!accountKey) {
				results.push([]);
				continue;
			}

			const accountName = String(account.name || account.accountName || accountKey);
			syncedAccountNames.push(accountName);
			console.log(`[sparebank1-sync] syncing account ${accountName} (${accountKey})`);
			const transactions =
				options.prefetchedTransactions?.[accountKey] ??
				(await callWithAuth((token) =>
					fetchSparebank1Transactions(token, accountKey, since, toDate, rateLimitHeaders)
				));
			console.log(`[sparebank1-sync] fetched ${transactions.length} transactions for ${accountName}`);
			results.push(transactions.map((transaction) => {
				const timestamp =
					typeof transaction.date === 'number'
						? new Date(transaction.date)
						: new Date(transaction.bookingDate || transaction.transactionDate || transaction.valueDate || Date.now());

				const amount = parseNumber(transaction.amount ?? transaction.bookedAmount ?? transaction.amountDetails);

				return {
					userId,
					sensorId: sensor.id,
					eventType: 'activity' as const,
					dataType: 'bank_transaction',
					timestamp,
					data: {
						accountId: transaction.accountKey || accountKey,
						amount,
						currency: transaction.currencyCode || transaction.currency || account.currencyCode || 'NOK',
						description: transaction.cleanedDescription || transaction.description || transaction.text || null,
						merchant: transaction.cleanedDescription || transaction.description || null,
						category: transaction.typeText || transaction.category || null,
						bookingStatus: transaction.bookingStatus || null,
						typeCode: transaction.typeCode || null,
						isFixedExpense: false
					},
					metadata: {
						provider: 'sparebank1',
						source: 'api',
						transactionId: transaction.id || transaction.transactionId
					},
					source: 'sparebank1_api'
				};
			}));
		}
		transactionEvents = results.flat();
	}

	if (transactionEvents.length > 0) {
		rawTransactionCount = transactionEvents.length;
		for (const event of transactionEvents) {
			const date = event.timestamp.toISOString().split('T')[0];
			const amount = Math.round((event.data.amount ?? 0) * 100);
			const semanticKey = `${event.data.accountId}:${date}:${normalizeTxDescription(event.data.description)}:${amount}`;
			if (includeDebug) {
				const row: Sparebank1TransactionDebugRow = {
					accountId: event.data.accountId ?? '',
					timestamp: event.timestamp.toISOString(),
					date,
					description: event.data.description ?? '',
					amount: Number(event.data.amount ?? 0),
					bookingStatus: event.data.bookingStatus ?? null,
					semanticKey,
					decision: 'queued_for_insert',
					reason: 'Candidate before dedup checks',
					transactionId: event.metadata?.transactionId ?? null
				};
				txDebugByEvent.set(event, row);
				txDebugRows.push(row);
			}
		}

		// Step 1: Deduplicate within the new batch itself (by transactionId)
		// Step 1: Deduplicate within this batch by semantic key
		// SB1 does NOT issue stable transactionIds — the same transaction can appear
		// with a new ID on every sync call (especially PENDING, but also BOOKED).
		// Primary dedup must therefore be semantic: (accountId, date, description, amount).
		// Prefer BOOKED over PENDING when both appear in the same batch.
		const makeSemanticKey = (e: any): string => {
			const date = e.timestamp.toISOString().split('T')[0];
			const amount = Math.round((e.data.amount ?? 0) * 100);
			return `${e.data.accountId}:${date}:${normalizeTxDescription(e.data.description)}:${amount}`;
		};
		const batchMap = new Map<string, any>();
		for (const e of transactionEvents) {
			const key = makeSemanticKey(e);
			const existing = batchMap.get(key);
			if (!existing) {
				batchMap.set(key, e);
				continue;
			}

			const currentIsBooked = e.data.bookingStatus === 'BOOKED';
			const existingIsBooked = existing.data.bookingStatus === 'BOOKED';

			if (currentIsBooked && !existingIsBooked) {
				if (includeDebug) {
					const existingDebug = txDebugByEvent.get(existing);
					if (existingDebug) {
						existingDebug.decision = 'replaced_by_booked_in_batch';
						existingDebug.reason = 'Replaced by BOOKED variant with same semantic key in this sync';
					}
				}
				batchMap.set(key, e);
			} else if (includeDebug) {
				const currentDebug = txDebugByEvent.get(e);
				if (currentDebug) {
					currentDebug.decision = 'duplicate_in_batch';
					currentDebug.reason = 'Duplicate semantic key in same sync batch';
				}
			}
		}
		const uniqueNewEvents = [...batchMap.values()];
		uniqueTransactionCount = uniqueNewEvents.length;

		// Load salary profile once per sync; build it if missing
		let salaryProfile = await loadSalaryProfile(userId);
		if (!salaryProfile) {
			salaryProfile = await buildSalaryProfile(userId).catch(() => null);
		}

		// Rå-strømmen får ALLE observasjonene fra dette svaret (transactionEvents),
		// canonical får den kollapsede batchen. Se doc-kommentaren på funksjonen: kalles
		// begge med uniqueNewEvents, blir multiplisiteten umålelig.
		await writeRawAndCanonicalTransactions(
			transactionEvents,
			uniqueNewEvents,
			userId,
			sensor.id,
			salaryProfile
		);

		console.log(`Filtered ${transactionEvents.length} -> ${uniqueNewEvents.length} unique transactions in batch`);

		// Step 2: Fetch existing semantic keys from DB; skip anything already stored.
		// We fetch only from the relevant date range (earliest date in this batch) to
		// avoid loading the entire transaction history on every sync.
		const batchDates = uniqueNewEvents.map((e) => e.timestamp as Date);
		const earliestDate = batchDates.length
			? new Date(Math.min(...batchDates.map((d) => d.getTime())))
			: new Date();

		let newEvents = uniqueNewEvents;
		if (!skipExistingDedup) {
			const existingRows = await pgClient.unsafe<{
				account_id: string;
				date: string;
				description_key: string;
				amount: string;
				booking_status: string;
			}[]>(`
			SELECT
				account_id,
				date,
				CASE
					WHEN description_raw LIKE 'COOP MEGA %' THEN TRIM(CONCAT_WS(' ', split_part(description_raw, ' ', 1), split_part(description_raw, ' ', 2), split_part(description_raw, ' ', 3)))
					WHEN description_raw LIKE 'COOP EXTRA %' THEN TRIM(CONCAT_WS(' ', split_part(description_raw, ' ', 1), split_part(description_raw, ' ', 2), split_part(description_raw, ' ', 3)))
					WHEN description_raw LIKE 'COOP PRIX %' THEN TRIM(CONCAT_WS(' ', split_part(description_raw, ' ', 1), split_part(description_raw, ' ', 2), split_part(description_raw, ' ', 3)))
					WHEN description_raw LIKE 'COOP OBS %' THEN TRIM(CONCAT_WS(' ', split_part(description_raw, ' ', 1), split_part(description_raw, ' ', 2), split_part(description_raw, ' ', 3)))
					WHEN description_raw LIKE 'KIWI %' THEN TRIM(CONCAT_WS(' ', split_part(description_raw, ' ', 1), split_part(description_raw, ' ', 2)))
					WHEN description_raw LIKE 'REMA %' THEN TRIM(CONCAT_WS(' ', split_part(description_raw, ' ', 1), split_part(description_raw, ' ', 2)))
					WHEN description_raw LIKE 'MENY %' THEN TRIM(CONCAT_WS(' ', split_part(description_raw, ' ', 1), split_part(description_raw, ' ', 2)))
					WHEN description_raw LIKE 'SPAR %' THEN TRIM(CONCAT_WS(' ', split_part(description_raw, ' ', 1), split_part(description_raw, ' ', 2)))
					WHEN description_raw LIKE 'BUNNPRIS %' THEN TRIM(CONCAT_WS(' ', split_part(description_raw, ' ', 1), split_part(description_raw, ' ', 2)))
					WHEN description_raw LIKE 'EXTRA %' THEN TRIM(CONCAT_WS(' ', split_part(description_raw, ' ', 1), split_part(description_raw, ' ', 2)))
					WHEN description_raw LIKE 'JOKER %' THEN TRIM(CONCAT_WS(' ', split_part(description_raw, ' ', 1), split_part(description_raw, ' ', 2)))
					WHEN description_raw LIKE 'NARVESEN %' THEN TRIM(CONCAT_WS(' ', split_part(description_raw, ' ', 1), split_part(description_raw, ' ', 2)))
					WHEN description_raw LIKE 'ODA.COM%' THEN 'ODA.COM'
					WHEN description_raw LIKE 'ODA %' THEN 'ODA'
					ELSE description_raw
				END AS description_key,
				amount,
				booking_status
			FROM (
				SELECT
					data->>'accountId' AS account_id,
					timestamp::date AS date,
					UPPER(REGEXP_REPLACE(TRIM(COALESCE(data->>'description', '')), '\\s+', ' ', 'g')) AS description_raw,
					ROUND((data->>'amount')::numeric, 2) AS amount,
					data->>'bookingStatus' AS booking_status
				FROM sensor_events
				WHERE sensor_id = $1
				  AND data_type = 'bank_transaction'
				  AND timestamp >= $2::timestamptz
			) base
			`, [sensor.id, earliestDate.toISOString()]);

			// Build a Set of existing semantic signatures
			const existingSemanticKeys = new Set(
				existingRows.map((r: any) =>
					`${r.account_id}:${String(r.date).split('T')[0]}:${r.description_key}:${Math.round(Number(r.amount) * 100)}`
				)
			);
			// Also track which existing entries are PENDING so we can upgrade them to BOOKED
			const existingPendingKeys = new Set(
				existingRows
					.filter((r: any) => r.booking_status === 'PENDING')
					.map((r: any) =>
						`${r.account_id}:${String(r.date).split('T')[0]}:${r.description_key}:${Math.round(Number(r.amount) * 100)}`
					)
			);

			// For incoming BOOKED transactions that match an existing PENDING record,
			// delete the PENDING rows so the BOOKED version can be inserted cleanly.
			const incomingBooked = uniqueNewEvents.filter((e) => e.data.bookingStatus === 'BOOKED');
			for (const event of incomingBooked) {
				const key = makeSemanticKey(event);
				if (existingPendingKeys.has(key)) {
					replacedPendingKeys.add(key);
					const date = event.timestamp.toISOString().split('T')[0];
					const amount = Math.round((event.data.amount ?? 0) * 100) / 100;
					const descriptionKey = normalizeTxDescription(event.data.description);
					await pgClient.unsafe(`
					WITH to_delete AS (
						SELECT id
						FROM sensor_events
						WHERE sensor_id = $1
						  AND data_type = 'bank_transaction'
						  AND data->>'bookingStatus' = 'PENDING'
						  AND data->>'accountId' = $2
						  AND CASE
								WHEN UPPER(REGEXP_REPLACE(TRIM(COALESCE(data->>'description', '')), '\\s+', ' ', 'g')) LIKE 'COOP MEGA %' THEN TRIM(CONCAT_WS(' ', split_part(UPPER(REGEXP_REPLACE(TRIM(COALESCE(data->>'description', '')), '\\s+', ' ', 'g')), ' ', 1), split_part(UPPER(REGEXP_REPLACE(TRIM(COALESCE(data->>'description', '')), '\\s+', ' ', 'g')), ' ', 2), split_part(UPPER(REGEXP_REPLACE(TRIM(COALESCE(data->>'description', '')), '\\s+', ' ', 'g')), ' ', 3)))
								WHEN UPPER(REGEXP_REPLACE(TRIM(COALESCE(data->>'description', '')), '\\s+', ' ', 'g')) LIKE 'COOP EXTRA %' THEN TRIM(CONCAT_WS(' ', split_part(UPPER(REGEXP_REPLACE(TRIM(COALESCE(data->>'description', '')), '\\s+', ' ', 'g')), ' ', 1), split_part(UPPER(REGEXP_REPLACE(TRIM(COALESCE(data->>'description', '')), '\\s+', ' ', 'g')), ' ', 2), split_part(UPPER(REGEXP_REPLACE(TRIM(COALESCE(data->>'description', '')), '\\s+', ' ', 'g')), ' ', 3)))
								WHEN UPPER(REGEXP_REPLACE(TRIM(COALESCE(data->>'description', '')), '\\s+', ' ', 'g')) LIKE 'KIWI %' THEN TRIM(CONCAT_WS(' ', split_part(UPPER(REGEXP_REPLACE(TRIM(COALESCE(data->>'description', '')), '\\s+', ' ', 'g')), ' ', 1), split_part(UPPER(REGEXP_REPLACE(TRIM(COALESCE(data->>'description', '')), '\\s+', ' ', 'g')), ' ', 2)))
								WHEN UPPER(REGEXP_REPLACE(TRIM(COALESCE(data->>'description', '')), '\\s+', ' ', 'g')) LIKE 'REMA %' THEN TRIM(CONCAT_WS(' ', split_part(UPPER(REGEXP_REPLACE(TRIM(COALESCE(data->>'description', '')), '\\s+', ' ', 'g')), ' ', 1), split_part(UPPER(REGEXP_REPLACE(TRIM(COALESCE(data->>'description', '')), '\\s+', ' ', 'g')), ' ', 2)))
								WHEN UPPER(REGEXP_REPLACE(TRIM(COALESCE(data->>'description', '')), '\\s+', ' ', 'g')) LIKE 'ODA.COM%' THEN 'ODA.COM'
								WHEN UPPER(REGEXP_REPLACE(TRIM(COALESCE(data->>'description', '')), '\\s+', ' ', 'g')) LIKE 'ODA %' THEN 'ODA'
								ELSE UPPER(REGEXP_REPLACE(TRIM(COALESCE(data->>'description', '')), '\\s+', ' ', 'g'))
							  END = $3
						  AND ROUND((data->>'amount')::numeric, 2) = $4
						  AND timestamp::date = $5::date
					), deleted_categorized AS (
						DELETE FROM categorized_events
						WHERE sensor_event_id IN (SELECT id FROM to_delete)
					)
					DELETE FROM sensor_events
					WHERE id IN (SELECT id FROM to_delete)
					`, [sensor.id, event.data.accountId ?? '', descriptionKey, amount, date]);
					existingSemanticKeys.delete(key); // allow BOOKED to be inserted
				}
			}

			newEvents = uniqueNewEvents.filter((e) => !existingSemanticKeys.has(makeSemanticKey(e)));

			if (includeDebug) {
				for (const event of uniqueNewEvents) {
					const key = makeSemanticKey(event);
					const debug = txDebugByEvent.get(event);
					if (!debug) continue;

					if (existingSemanticKeys.has(key)) {
						debug.decision = 'skipped_existing_in_db';
						debug.reason = 'Already exists in sensor_events by semantic key';
					} else {
						debug.decision = 'queued_for_insert';
						debug.reason = replacedPendingKeys.has(key)
							? 'BOOKED transaction replaces existing PENDING row'
							: 'Unique in batch and not found in DB';
					}
				}
			}
		}

		console.log(`Filtered ${uniqueNewEvents.length} -> ${newEvents.length} new transactions (not in DB)`);

		if (newEvents.length > 0) {
			const batchSize = 200;
			for (let index = 0; index < newEvents.length; index += batchSize) {
				await SensorEventService.writeMany(newEvents.slice(index, index + batchSize), {
					conflictMode: 'ignore'
				});
			}
		}

		// Safety net: remove semantic duplicates in the recent sync window.
		// This heals already-accumulated duplicates and protects charts/lists from inflated totals.
		if (!skipExistingDedup) {
			await pgClient.unsafe(`
			WITH ranked AS (
				SELECT
					id,
					ROW_NUMBER() OVER (
						PARTITION BY
							data->>'accountId',
							timestamp::date,
							CASE
								WHEN UPPER(REGEXP_REPLACE(TRIM(COALESCE(data->>'description', '')), '\\s+', ' ', 'g')) LIKE 'COOP MEGA %' THEN TRIM(CONCAT_WS(' ', split_part(UPPER(REGEXP_REPLACE(TRIM(COALESCE(data->>'description', '')), '\\s+', ' ', 'g')), ' ', 1), split_part(UPPER(REGEXP_REPLACE(TRIM(COALESCE(data->>'description', '')), '\\s+', ' ', 'g')), ' ', 2), split_part(UPPER(REGEXP_REPLACE(TRIM(COALESCE(data->>'description', '')), '\\s+', ' ', 'g')), ' ', 3)))
								WHEN UPPER(REGEXP_REPLACE(TRIM(COALESCE(data->>'description', '')), '\\s+', ' ', 'g')) LIKE 'COOP EXTRA %' THEN TRIM(CONCAT_WS(' ', split_part(UPPER(REGEXP_REPLACE(TRIM(COALESCE(data->>'description', '')), '\\s+', ' ', 'g')), ' ', 1), split_part(UPPER(REGEXP_REPLACE(TRIM(COALESCE(data->>'description', '')), '\\s+', ' ', 'g')), ' ', 2), split_part(UPPER(REGEXP_REPLACE(TRIM(COALESCE(data->>'description', '')), '\\s+', ' ', 'g')), ' ', 3)))
								WHEN UPPER(REGEXP_REPLACE(TRIM(COALESCE(data->>'description', '')), '\\s+', ' ', 'g')) LIKE 'KIWI %' THEN TRIM(CONCAT_WS(' ', split_part(UPPER(REGEXP_REPLACE(TRIM(COALESCE(data->>'description', '')), '\\s+', ' ', 'g')), ' ', 1), split_part(UPPER(REGEXP_REPLACE(TRIM(COALESCE(data->>'description', '')), '\\s+', ' ', 'g')), ' ', 2)))
								WHEN UPPER(REGEXP_REPLACE(TRIM(COALESCE(data->>'description', '')), '\\s+', ' ', 'g')) LIKE 'REMA %' THEN TRIM(CONCAT_WS(' ', split_part(UPPER(REGEXP_REPLACE(TRIM(COALESCE(data->>'description', '')), '\\s+', ' ', 'g')), ' ', 1), split_part(UPPER(REGEXP_REPLACE(TRIM(COALESCE(data->>'description', '')), '\\s+', ' ', 'g')), ' ', 2)))
								WHEN UPPER(REGEXP_REPLACE(TRIM(COALESCE(data->>'description', '')), '\\s+', ' ', 'g')) LIKE 'ODA.COM%' THEN 'ODA.COM'
								WHEN UPPER(REGEXP_REPLACE(TRIM(COALESCE(data->>'description', '')), '\\s+', ' ', 'g')) LIKE 'ODA %' THEN 'ODA'
								ELSE UPPER(REGEXP_REPLACE(TRIM(COALESCE(data->>'description', '')), '\\s+', ' ', 'g'))
							END,
							ROUND((data->>'amount')::numeric, 2)
						ORDER BY
							CASE WHEN data->>'bookingStatus' = 'BOOKED' THEN 0 ELSE 1 END,
							timestamp ASC,
							id ASC
					) AS rn
				FROM sensor_events
				WHERE sensor_id = $1
				  AND data_type = 'bank_transaction'
				  AND timestamp >= $2::timestamptz
			), to_delete AS (
				SELECT id FROM ranked WHERE rn > 1
			), deleted_categorized AS (
				DELETE FROM categorized_events
				WHERE sensor_event_id IN (SELECT id FROM to_delete)
			)
			DELETE FROM sensor_events
			WHERE id IN (SELECT id FROM to_delete)
			`, [sensor.id, earliestDate.toISOString()]);

			// Second pass: remove SB1 multi-text duplicates (same account+date+amount, different description).
			// SB1 returns 2-3 description variants for the same transaction (e.g. "Lønn" + employer name +
			// "Fra: employer Betalt:"). Keep the most informative one.
			await pgClient.unsafe(`
			WITH ranked AS (
				SELECT
					id,
					ROW_NUMBER() OVER (
						PARTITION BY
							data->>'accountId',
							timestamp::date,
							ROUND((data->>'amount')::numeric, 2)
						ORDER BY
							CASE WHEN data->>'bookingStatus' = 'BOOKED' THEN 0 ELSE 1 END,
							CASE
								WHEN UPPER(TRIM(data->>'description')) LIKE '%MELLOM EGNE KONTI%' THEN 100
								WHEN UPPER(TRIM(data->>'description')) IN (
									'AVTALE', 'LØNN', 'NETTGIRO', 'OVERØRSEL', 'OVERFØRING',
									'REGNINGER', 'SMÅSPARING', 'TIL: BETALT:', 'NETTGIRO TIL: BETALT:'
								) THEN 90
								ELSE 1
							END ASC,
							LENGTH(COALESCE(data->>'description', '')) DESC,
							id ASC
					) AS rn
				FROM sensor_events
				WHERE sensor_id = $1
				  AND data_type = 'bank_transaction'
				  AND timestamp >= $2::timestamptz
			), to_delete AS (
				SELECT id FROM ranked WHERE rn > 1
			), deleted_categorized AS (
				DELETE FROM categorized_events
				WHERE sensor_event_id IN (SELECT id FROM to_delete)
			)
			DELETE FROM sensor_events
			WHERE id IN (SELECT id FROM to_delete)
			`, [sensor.id, earliestDate.toISOString()]);
		}

		transactionEvents = newEvents; // return actual inserted count
	}

	await db
		.update(sensors)
		.set({
			lastSync: new Date(),
			updatedAt: new Date(),
			lastError: null
		})
		.where(eq(sensors.id, sensor.id));

	return {
		balanceEvents: balanceEvents.length,
		transactionEvents: transactionEvents.length,
		accounts: accounts.length,
		accountNames: syncedAccountNames,
		rateLimitHeaders,
		...(includeDebug
			? {
					debug: {
						since: since ? since.toISOString() : null,
						rawTransactionCount,
						uniqueTransactionCount,
						queuedForInsertCount: txDebugRows.filter((r) => r.decision === 'queued_for_insert').length,
						skippedExistingCount: txDebugRows.filter((r) => r.decision === 'skipped_existing_in_db').length,
						duplicateInBatchCount: txDebugRows.filter((r) => r.decision === 'duplicate_in_batch').length,
						replacedByBookedInBatchCount: txDebugRows.filter((r) => r.decision === 'replaced_by_booked_in_batch').length,
						transactions: [...txDebugRows].sort((a, b) => b.timestamp.localeCompare(a.timestamp))
					}
			  }
			: {})
	};
}
