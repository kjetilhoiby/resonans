import { db, pgClient } from '$lib/db';
import { sensorEvents, sensors } from '$lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { SensorEventService } from '$lib/server/services/sensor-event-service';
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
	options: { fromDate?: Date; includeDebug?: boolean } = {}
): Promise<Sparebank1SyncResult> {
	const sensor = await getSparebank1Sensor(userId);

	if (!sensor) {
		throw new Error('No active SpareBank1 sensor found');
	}

	const accessToken = await getValidSparebank1AccessToken(sensor);
	const since = options.fromDate ?? sensor.lastSync ?? undefined;
	const includeDebug = options.includeDebug === true;
	const txDebugByEvent = new WeakMap<object, Sparebank1TransactionDebugRow>();
	const txDebugRows: Sparebank1TransactionDebugRow[] = [];
	const replacedPendingKeys = new Set<string>();
	let rawTransactionCount = 0;
	let uniqueTransactionCount = 0;

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

		const newBalanceEvents = balanceEvents.filter((e) => {
			const key = `${e.data.accountId}:${e.timestamp.toISOString().split('T')[0]}`;
			return !existingBalanceKeys.has(key);
		});

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
			const semanticKey = `${event.data.accountId}:${date}:${event.data.description}:${amount}`;
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
			return `${e.data.accountId}:${date}:${e.data.description}:${amount}`;
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

		console.log(`Filtered ${transactionEvents.length} -> ${uniqueNewEvents.length} unique transactions in batch`);

		// Step 2: Fetch existing semantic keys from DB; skip anything already stored.
		// We fetch only from the relevant date range (earliest date in this batch) to
		// avoid loading the entire transaction history on every sync.
		const batchDates = uniqueNewEvents.map((e) => e.timestamp as Date);
		const earliestDate = batchDates.length
			? new Date(Math.min(...batchDates.map((d) => d.getTime())))
			: new Date();

		const existingRows = await pgClient.unsafe<{
			account_id: string;
			date: string;
			description: string;
			amount: string;
			booking_status: string;
		}[]>(`
			SELECT
				data->>'accountId'                          AS account_id,
				timestamp::date                             AS date,
				data->>'description'                        AS description,
				ROUND((data->>'amount')::numeric, 2)        AS amount,
				data->>'bookingStatus'                      AS booking_status
			FROM sensor_events
			WHERE sensor_id = $1
			  AND data_type = 'bank_transaction'
			  AND timestamp >= $2::timestamptz
		`, [sensor.id, earliestDate.toISOString()]);

		// Build a Set of existing semantic signatures
		const existingSemanticKeys = new Set(
			existingRows.map((r: any) =>
				`${r.account_id}:${String(r.date).split('T')[0]}:${r.description}:${Math.round(Number(r.amount) * 100)}`
			)
		);
		// Also track which existing entries are PENDING so we can upgrade them to BOOKED
		const existingPendingKeys = new Set(
			existingRows
				.filter((r: any) => r.booking_status === 'PENDING')
				.map((r: any) =>
					`${r.account_id}:${String(r.date).split('T')[0]}:${r.description}:${Math.round(Number(r.amount) * 100)}`
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
				await db.execute(sql`
					DELETE FROM sensor_events
					WHERE sensor_id = ${sensor.id}
					  AND data_type = 'bank_transaction'
					  AND data->>'bookingStatus' = 'PENDING'
					  AND data->>'accountId' = ${event.data.accountId ?? ''}
					  AND data->>'description' = ${event.data.description ?? ''}
					  AND ROUND((data->>'amount')::numeric, 2) = ${amount}
					  AND timestamp::date = ${date}::date
				`);
				existingSemanticKeys.delete(key); // allow BOOKED to be inserted
			}
		}

		const newEvents = uniqueNewEvents.filter((e) => !existingSemanticKeys.has(makeSemanticKey(e)));

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
