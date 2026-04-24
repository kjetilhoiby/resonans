import { db, pgClient } from '$lib/db';
import { sensorEvents, sensors } from '$lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { SensorEventService } from '$lib/server/services/sensor-event-service';
import { createHash } from 'node:crypto';
import {
	fetchSparebank1Accounts,
	fetchSparebank1HelloWorld,
	fetchSparebank1Transactions,
	refreshSparebank1AccessToken
} from './sparebank1';

type BankCredentials = {
	access_token: string;
	refresh_token?: string;
	expires_at?: number;
	token_type?: string;
	scope?: string;
};

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

function decodeCredentials(encoded: string): BankCredentials {
	return JSON.parse(atob(encoded));
}

function encodeCredentials(credentials: BankCredentials): string {
	return btoa(JSON.stringify(credentials));
}

function normalizeTxDescription(value: unknown): string {
	const raw = typeof value === 'string' ? value : '';
	const normalized = raw
		.normalize('NFKC')
		.replace(/\s+/g, ' ')
		.trim()
		.toUpperCase();

	if (!normalized) return '';

	const compact = normalized.replace(/\s+-\s+[A-Z0-9]{4,}$/g, '').trim();
	const words = compact.split(' ').filter(Boolean);
	const first = (count: number) => words.slice(0, Math.min(count, words.length)).join(' ');

	if (compact.startsWith('COOP MEGA ')) return first(3);
	if (compact.startsWith('COOP EXTRA ')) return first(3);
	if (compact.startsWith('COOP PRIX ')) return first(3);
	if (compact.startsWith('COOP OBS ')) return first(3);
	if (compact.startsWith('KIWI ')) return first(2);
	if (compact.startsWith('REMA ')) return first(2);
	if (compact.startsWith('MENY ')) return first(2);
	if (compact.startsWith('SPAR ')) return first(2);
	if (compact.startsWith('BUNNPRIS ')) return first(2);
	if (compact.startsWith('EXTRA ')) return first(2);
	if (compact.startsWith('JOKER ')) return first(2);
	if (compact.startsWith('NARVESEN ')) return first(2);
	if (compact.startsWith('ODA.COM')) return 'ODA.COM';
	if (compact.startsWith('ODA ')) return 'ODA';

	return compact;
}

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

async function writeRawAndCanonicalTransactions(events: any[], userId: string, sensorId: string): Promise<void> {
	for (const event of events) {
		const txDate = event.timestamp.toISOString().split('T')[0];
		const amount = Math.round((Number(event.data.amount ?? 0) || 0) * 100) / 100;
		const descriptionRaw = String(event.data.description ?? '');
		const descriptionNorm = normalizeTxDescription(event.data.description);
		const merchantKey = descriptionNorm;
		const bookingStatus = String(event.data.bookingStatus ?? '').toUpperCase() || null;
		const statusRank = bookingStatusRank(bookingStatus);
		const externalId = String(event.metadata?.transactionId ?? '');
		const currency = String(event.data.currency ?? 'NOK');
		const typeText = String(event.data.category ?? '');
		const fingerprint = rawFingerprintForEvent(event);

		await pgClient.unsafe(
			`INSERT INTO raw_bank_transaction_versions (
				user_id, sensor_id, account_id, external_transaction_id, booking_status, status_rank,
				transaction_date, posted_at, amount, currency, description_raw, description_normalized,
				merchant_key, type_text, payload, raw_fingerprint, first_seen_at, last_seen_at, seen_count,
				created_at, updated_at
			) VALUES (
				$1, $2, $3, NULLIF($4, ''), NULLIF($5, ''), $6,
				$7::date, $8::timestamp, $9, $10, $11, $12,
				$13, NULLIF($14, ''), $15::jsonb, $16, NOW(), NOW(), 1,
				NOW(), NOW()
			)
			ON CONFLICT (raw_fingerprint)
			DO UPDATE SET
				last_seen_at = NOW(),
				seen_count = raw_bank_transaction_versions.seen_count + 1,
				booking_status = EXCLUDED.booking_status,
				status_rank = GREATEST(raw_bank_transaction_versions.status_rank, EXCLUDED.status_rank),
				description_raw = EXCLUDED.description_raw,
				description_normalized = EXCLUDED.description_normalized,
				merchant_key = EXCLUDED.merchant_key,
				updated_at = NOW()`,
			[
				userId,
				sensorId,
				String(event.data.accountId ?? ''),
				externalId,
				bookingStatus ?? '',
				statusRank,
				txDate,
				event.timestamp.toISOString(),
				amount,
				currency,
				descriptionRaw,
				descriptionNorm,
				merchantKey,
				typeText,
				JSON.stringify(event.data ?? {}),
				fingerprint
			]
		);

		const upserted = await pgClient.unsafe<{ id: string }[]>(
			`INSERT INTO canonical_bank_transactions (
				user_id, sensor_id, account_id, canonical_date, amount, currency, merchant_key,
				description_display, latest_booking_status, status_rank, latest_posted_at,
				first_seen_at, last_seen_at, evidence_count, is_active, created_at, updated_at
			) VALUES (
				$1, $2, $3, $4::date, $5, $6, $7,
				$8, NULLIF($9, ''), $10, $11::timestamp,
				NOW(), NOW(), 1, TRUE, NOW(), NOW()
			)
			ON CONFLICT (sensor_id, account_id, canonical_date, amount, merchant_key)
			DO UPDATE SET
				currency = EXCLUDED.currency,
				description_display = CASE
					WHEN EXCLUDED.status_rank > canonical_bank_transactions.status_rank THEN EXCLUDED.description_display
					WHEN EXCLUDED.status_rank = canonical_bank_transactions.status_rank
						AND LENGTH(COALESCE(EXCLUDED.description_display, '')) > LENGTH(COALESCE(canonical_bank_transactions.description_display, ''))
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
				updated_at = NOW()
			RETURNING id`,
			[
				userId,
				sensorId,
				String(event.data.accountId ?? ''),
				txDate,
				amount,
				currency,
				merchantKey,
				descriptionRaw || null,
				bookingStatus ?? '',
				statusRank,
				event.timestamp.toISOString()
			]
		);

		if (externalId && upserted[0]?.id) {
			await pgClient.unsafe(
				`INSERT INTO canonical_bank_transaction_aliases (
					canonical_id, sensor_id, external_transaction_id,
					first_seen_at, last_seen_at, seen_count, created_at, updated_at
				) VALUES (
					$1, $2, $3, NOW(), NOW(), 1, NOW(), NOW()
				)
				ON CONFLICT (sensor_id, external_transaction_id)
				DO UPDATE SET
					canonical_id = EXCLUDED.canonical_id,
					last_seen_at = NOW(),
					seen_count = canonical_bank_transaction_aliases.seen_count + 1,
					updated_at = NOW()`,
				[upserted[0].id, sensorId, externalId]
			);
		}
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
	debug?: Sparebank1SyncDebug;
};

export async function wipeSparebank1EconomicsData(userId: string, sensorId: string): Promise<{
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
			DELETE FROM categorized_events ce
			USING sensor_events se
			WHERE ce.sensor_event_id = se.id
			  AND se.sensor_id = $1
			  AND se.user_id = $2
			RETURNING ce.id
		), deleted_aliases AS (
			DELETE FROM canonical_bank_transaction_aliases
			WHERE sensor_id = $1
			RETURNING id
		), deleted_raw AS (
			DELETE FROM raw_bank_transaction_versions
			WHERE sensor_id = $1
			RETURNING id
		), deleted_canonical AS (
			DELETE FROM canonical_bank_transactions
			WHERE sensor_id = $1
			RETURNING id
		), deleted_sensor AS (
			DELETE FROM sensor_events
			WHERE sensor_id = $1
			  AND user_id = $2
			  AND data_type IN ('bank_balance', 'bank_transaction')
			RETURNING id
		)
		SELECT
			(SELECT COUNT(*)::int FROM deleted_categorized) AS categorized_count,
			(SELECT COUNT(*)::int FROM deleted_aliases) AS alias_count,
			(SELECT COUNT(*)::int FROM deleted_raw) AS raw_count,
			(SELECT COUNT(*)::int FROM deleted_canonical) AS canonical_count,
			(SELECT COUNT(*)::int FROM deleted_sensor) AS sensor_count
	`, [sensorId, userId]);

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

export async function getValidSparebank1AccessToken(sensor: any): Promise<string> {
	if (!sensor.credentials) {
		throw new Error('No stored credentials for SpareBank1 sensor');
	}

	const credentials = decodeCredentials(sensor.credentials);
	const now = Math.floor(Date.now() / 1000);

	if (credentials.expires_at && now >= credentials.expires_at - 60) {
		if (!credentials.refresh_token) {
			throw new Error('SpareBank1 access token is expired and refresh token is missing');
		}

		const refreshed = await refreshSparebank1AccessToken(credentials.refresh_token);

		if (!refreshed.access_token) {
			throw new Error(`Invalid refresh response from SpareBank1: ${JSON.stringify(refreshed)}`);
		}

		const refreshedCredentials: BankCredentials = {
			access_token: refreshed.access_token,
			refresh_token: refreshed.refresh_token || credentials.refresh_token,
			expires_at: refreshed.expires_in ? now + refreshed.expires_in : credentials.expires_at,
			token_type: refreshed.token_type || credentials.token_type,
			scope: refreshed.scope || credentials.scope
		};

		await db
			.update(sensors)
			.set({
				credentials: encodeCredentials(refreshedCredentials),
				config: {
					...(sensor.config as any),
					expiresAt: refreshedCredentials.expires_at
				},
				updatedAt: new Date()
			})
			.where(eq(sensors.id, sensor.id));

		return refreshedCredentials.access_token;
	}

	return credentials.access_token;
}

export async function syncAllSparebank1Data(
	userId: string,
	options: { fromDate?: Date; includeDebug?: boolean; resetBeforeImport?: boolean; skipExistingDedup?: boolean } = {}
): Promise<Sparebank1SyncResult> {
	const sensor = await getSparebank1Sensor(userId);

	if (!sensor) {
		throw new Error('No active SpareBank1 sensor found');
	}

	const accessToken = await getValidSparebank1AccessToken(sensor);
	const since = options.fromDate ?? sensor.lastSync ?? undefined;
	const includeDebug = options.includeDebug === true;
	const resetBeforeImport = options.resetBeforeImport === true;
	const skipExistingDedup = options.skipExistingDedup === true;
	const txDebugByEvent = new WeakMap<object, Sparebank1TransactionDebugRow>();
	const txDebugRows: Sparebank1TransactionDebugRow[] = [];
	const replacedPendingKeys = new Set<string>();
	let rawTransactionCount = 0;
	let uniqueTransactionCount = 0;

	if (resetBeforeImport) {
		const wiped = await wipeSparebank1EconomicsData(userId, sensor.id);
		console.log('[sparebank1-sync] replace-mode wipe completed', { userId, sensorId: sensor.id, wiped });
	}

	await fetchSparebank1HelloWorld(accessToken);

	const accounts = await fetchSparebank1Accounts(accessToken);

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

	if (accounts.length > 0) {
		// Fetch all accounts in parallel
		const results = await Promise.all(
			accounts.map(async (account) => {
				const accountKey = String(account.key || account.accountKey || account.id || account.accountId || account.number || '');
				if (!accountKey) return [];

				const transactions = await fetchSparebank1Transactions(accessToken, accountKey, since);
				return transactions.map((transaction) => {
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
				});
			})
		);
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

		try {
			await writeRawAndCanonicalTransactions(uniqueNewEvents, userId, sensor.id);
		} catch (error) {
			console.warn('[sparebank1-sync] raw+canonical ingest write skipped:', error);
		}

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
