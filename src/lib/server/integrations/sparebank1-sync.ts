import { db } from '$lib/db';
import { sensorEvents, sensors } from '$lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
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

export async function getSparebank1Sensor(userId: string) {
	return db.query.sensors.findFirst({
		where: and(
			eq(sensors.userId, userId),
			eq(sensors.provider, 'sparebank1'),
			eq(sensors.isActive, true)
		)
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
	options: { fromDate?: Date } = {}
): Promise<{
	balanceEvents: number;
	transactionEvents: number;
	accounts: number;
}> {
	const sensor = await getSparebank1Sensor(userId);

	if (!sensor) {
		throw new Error('No active SpareBank1 sensor found');
	}

	const accessToken = await getValidSparebank1AccessToken(sensor);
	const since = options.fromDate ?? sensor.lastSync ?? undefined;

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
				accountKey: account.key || null
			}
		};
	});

	if (balanceEvents.length > 0) {
		await db.insert(sensorEvents).values(balanceEvents);
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
							transactionId: transaction.id || transaction.transactionId
						}
					};
				});
			})
		);
		transactionEvents = results.flat();
	}

	if (transactionEvents.length > 0) {
		// Dedup: fetch existing transaction IDs for this sensor to avoid duplicates
		const existingRows = await db
			.select({ txId: sql<string>`metadata->>'transactionId'` })
			.from(sensorEvents)
			.where(and(eq(sensorEvents.sensorId, sensor.id), eq(sensorEvents.dataType, 'bank_transaction')));
		const existingIds = new Set(existingRows.map((r) => r.txId).filter(Boolean));

		const newEvents = transactionEvents.filter(
			(e) => !existingIds.has((e.metadata as any)?.transactionId)
		);

		if (newEvents.length > 0) {
			const batchSize = 200;
			for (let index = 0; index < newEvents.length; index += batchSize) {
				await db.insert(sensorEvents).values(newEvents.slice(index, index + batchSize));
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
		accounts: accounts.length
	};
}
