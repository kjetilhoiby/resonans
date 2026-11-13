/**
 * Rema 1000 (Æ) — kvitteringssynken.
 *
 * Kvitteringene lander i `grocery_orders`/`grocery_order_lines` med
 * `provider = 'rema1000'` og `order_ref` = Remas transaksjons-id, altså samme
 * rader som Oda-ordrene fra e-post. Da virker kvitteringskortet på Mat,
 * «Legg i lager» og plan-mot-kjøp uten en tredje modell. Se
 * `docs/changelog/2026-11-13-rema-kvitteringer.md`.
 *
 * - Kvitteringer er uforanderlige: en importert transaksjon hentes aldri igjen.
 * - Ordre og varelinjer skrives i ÉN transaksjon. Ellers kunne et avbrudd
 *   etterlate en ordre uten linjer, og siden «importert» leses av ordreraden
 *   ville den aldri blitt fylt.
 * - Taket per kjøring (`MAX_RECEIPTS_PER_RUN`) gjør førstegangssynken av flere
 *   års historikk til en serie korte kjøringer, nyeste først.
 * - Ingenting skrives til lageret automatisk — samme regel som for Oda.
 */

import { db } from '$lib/db';
import { groceryOrderLines, groceryOrders, sensors, shoppingLists } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { guessPantryLocation } from '$lib/domains/food/grocery';
import {
	describeRowsShape,
	parseTransactionHeads,
	parseTransactionRows,
	selectTransactionsToFetch,
	type RemaTransactionHead
} from '$lib/domains/food/rema-receipts';
import { isoWeekKeyForDate } from '$lib/server/iso-week';
import { recordSensorSyncFailure } from '$lib/server/sensors/sync-status';
import {
	fetchRemaTransactionHeads,
	fetchRemaTransactionRows,
	RemaHttpError,
	type RemaDeviceContext
} from './rema';
import { getValidRemaAccessToken, refreshRemaAfterUnauthorized } from './rema-token';

export const REMA_PROVIDER = 'rema1000';
export const MAX_RECEIPTS_PER_RUN = 40;
/** Pause mellom varelinje-kallene. Et uoffisielt API skal ikke få en salve. */
const ROWS_CALL_SPACING_MS = 250;

export async function getRemaSensor(userId: string) {
	return db.query.sensors.findFirst({
		where: and(eq(sensors.userId, userId), eq(sensors.provider, REMA_PROVIDER), eq(sensors.isActive, true))
	});
}

export interface RemaSyncResult {
	/** Kvitteringer Rema lister for kontoen. */
	receiptsListed: number;
	imported: number;
	linesImported: number;
	/** Igjen til neste kjøring (taket). */
	remaining: number;
	failed: number;
	rejectedHeads: number;
	rejectedLines: number;
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function syncRemaForUser(
	userId: string,
	options: { maxReceipts?: number } = {}
): Promise<RemaSyncResult> {
	const sensor = await getRemaSensor(userId);
	if (!sensor) throw new Error('Ingen aktiv Rema-sensor for bruker');

	try {
		const result = await runSync(userId, sensor, options.maxReceipts ?? MAX_RECEIPTS_PER_RUN);
		await db
			.update(sensors)
			.set({
				lastSync: new Date(),
				// Begge halvdelene: en rettet feil skal ikke bli stående (se CLAUDE.md).
				lastError:
					result.failed > 0
						? `${result.failed} kvittering(er) kunne ikke hentes — prøves igjen neste kjøring`
						: null,
				updatedAt: new Date()
			})
			.where(eq(sensors.id, sensor.id));
		return result;
	} catch (err) {
		await recordSensorSyncFailure(userId, REMA_PROVIDER, err);
		throw err;
	}
}

async function runSync(
	userId: string,
	sensor: { id: string; config: Record<string, unknown> | null },
	maxReceipts: number
): Promise<RemaSyncResult> {
	const config = sensor.config ?? {};
	const device: RemaDeviceContext = {
		deviceId: typeof config.deviceId === 'string' ? config.deviceId : sensor.id,
		mobileNumber: typeof config.mobileNumber === 'string' ? config.mobileNumber : null
	};

	let accessToken = await getValidRemaAccessToken(sensor);
	/** Ett nytt forsøk etter en 401 — tokenet kan være utløpt før klokka sa det. */
	async function withAuth<T>(call: (token: string) => Promise<T>): Promise<T> {
		try {
			return await call(accessToken);
		} catch (err) {
			if (!(err instanceof RemaHttpError) || err.status !== 401) throw err;
			accessToken = await refreshRemaAfterUnauthorized(sensor, accessToken);
			return call(accessToken);
		}
	}

	const { heads, rejected: rejectedHeads } = parseTransactionHeads(
		await withAuth((token) => fetchRemaTransactionHeads(token, device))
	);

	const existing = await db
		.select({ orderRef: groceryOrders.orderRef })
		.from(groceryOrders)
		.where(and(eq(groceryOrders.userId, userId), eq(groceryOrders.provider, REMA_PROVIDER)));
	const imported = new Set(existing.map((r) => r.orderRef).filter((r): r is string => Boolean(r)));

	const { toFetch, remaining } = selectTransactionsToFetch(heads, imported, maxReceipts);

	const weekListCache = new Map<string, string | null>();
	let importedCount = 0;
	let linesImported = 0;
	let rejectedLines = 0;
	let failed = 0;
	let loggedKeys = false;
	const rejectedFields = new Set<string>();

	for (const [index, head] of toFetch.entries()) {
		if (index > 0) await sleep(ROWS_CALL_SPACING_MS);
		let rowsPayload: unknown;
		try {
			rowsPayload = await withAuth((token) => fetchRemaTransactionRows(token, device, head.id));
		} catch (err) {
			// En 401 etter refresh betyr at innloggingen er død — da er det ingen
			// vits å prøve de neste 39. Alt annet gjelder bare denne kvitteringen.
			if (err instanceof RemaHttpError && err.status === 401) throw err;
			failed++;
			console.error(`[rema] varelinjer feilet tid=${head.id}: ${err instanceof Error ? err.message : err}`);
			continue;
		}

		// Feltnavnene (aldri verdiene) logges én gang per kjøring: kontrakten er
		// lest ut av en app, og det er navnene som endrer seg uten varsel.
		if (!loggedKeys) {
			const shape = describeRowsShape(rowsPayload);
			console.log(
				`[rema] varelinjefelt: ${shape.rowKeys.join(',') || '<ingen>'}` +
					(shape.wrapperKeys ? ` innpakning: ${shape.wrapperKeys.join(',')}` : '')
			);
			loggedKeys = true;
		}

		let parsed: ReturnType<typeof parseTransactionRows>;
		try {
			parsed = parseTransactionRows(rowsPayload);
		} catch (err) {
			failed++;
			console.error(`[rema] uventet varelinjeformat tid=${head.id}: ${err instanceof Error ? err.message : err}`);
			continue;
		}
		rejectedLines += parsed.rejected;
		for (const field of parsed.rejectedFields) rejectedFields.add(field);

		const wrote = await writeReceipt(userId, head, parsed.lines, weekListCache);
		if (wrote) {
			importedCount++;
			linesImported += parsed.lines.length;
		}
	}

	const result: RemaSyncResult = {
		receiptsListed: heads.length,
		imported: importedCount,
		linesImported,
		remaining,
		failed,
		rejectedHeads,
		rejectedLines
	};
	console.log(
		`[rema] user=${userId} listet=${result.receiptsListed} importert=${result.imported} ` +
			`linjer=${result.linesImported} igjen=${result.remaining} feilet=${result.failed} ` +
			`avvist_hoder=${result.rejectedHeads} avviste_linjer=${result.rejectedLines}`
	);
	if (rejectedFields.size > 0) {
		console.log(`[rema] avviste linjer hadde feltene: ${[...rejectedFields].sort().join(',')}`);
	}
	return result;
}

async function weekListId(userId: string, weekContext: string, cache: Map<string, string | null>) {
	if (cache.has(weekContext)) return cache.get(weekContext) ?? null;
	const list = await db.query.shoppingLists.findFirst({
		where: and(
			eq(shoppingLists.userId, userId),
			eq(shoppingLists.weekContext, weekContext),
			eq(shoppingLists.kind, 'week')
		),
		columns: { id: true }
	});
	cache.set(weekContext, list?.id ?? null);
	return list?.id ?? null;
}

/** Skriver én kvittering. `false` når en samtidig kjøring kom først. */
async function writeReceipt(
	userId: string,
	head: RemaTransactionHead,
	lines: ReturnType<typeof parseTransactionRows>['lines'],
	weekListCache: Map<string, string | null>
): Promise<boolean> {
	const weekContext = isoWeekKeyForDate(head.purchaseDay);
	const shoppingListId = await weekListId(userId, weekContext, weekListCache);

	return db.transaction(async (tx) => {
		const [order] = await tx
			.insert(groceryOrders)
			.values({
				userId,
				provider: REMA_PROVIDER,
				orderRef: head.id,
				kind: 'receipt',
				orderDate: head.purchaseDay,
				deliveryDate: null,
				weekContext,
				totalAmount: head.amount != null ? String(head.amount) : null,
				storeName: head.storeName,
				purchasedAt: head.purchasedAt,
				shoppingListId
			})
			// Unik (user, provider, order_ref): cron og «Synk nå» samtidig skal
			// ikke gi to kopier av samme kvittering.
			.onConflictDoNothing()
			.returning({ id: groceryOrders.id });
		if (!order) return false;

		if (lines.length > 0) {
			await tx.insert(groceryOrderLines).values(
				lines.map((line, sortOrder) => ({
					userId,
					orderId: order.id,
					name: line.name,
					quantity: line.quantity != null ? String(line.quantity) : null,
					unit: null,
					unitPrice: line.unitPrice != null ? String(line.unitPrice) : null,
					totalPrice: line.totalPrice != null ? String(line.totalPrice) : null,
					discount: line.discount != null ? String(line.discount) : null,
					ean: line.ean,
					productGroup: line.productGroup,
					category: line.category,
					pantryLocationGuess: guessPantryLocation(line.category, line.name),
					sortOrder
				}))
			);
		}
		return true;
	});
}
