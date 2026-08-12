import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq, asc, sql } from 'drizzle-orm';
import { readTransactions } from '$lib/server/economics/transactions';

export type DailyBalance = {
	date: string; // YYYY-MM-DD
	balance: number;
	innskudd: number;
	uttak: number;
};

/**
 * Reconstructs a daily balance series using ALL stored bank_balance snapshots
 * as anchor points. Between two consecutive anchors, transactions are applied
 * forward from the earlier one. When the next anchor is reached, the running
 * balance is reset to that snapshot's value — correcting any accumulated drift
 * from missing or incorrect transactions.
 *
 * This is significantly more accurate than single-anchor reconstruction for
 * periods months in the past.
 */
export async function buildDailyBalances(
	userId: string,
	accountId: string
): Promise<DailyBalance[]> {
	// ── Fetch all balance snapshots ───────────────────────────────────────────
	const snapshots = await db
		.select({
			balance: sql<number>`(data->>'balance')::numeric`,
			timestamp: sensorEvents.timestamp
		})
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'bank_balance'),
				sql`data->>'accountId' = ${accountId}`
			)
		)
		.orderBy(asc(sensorEvents.timestamp));

	if (snapshots.length === 0) return [];

	// Keep one snapshot per calendar day — prefer the latest of the day
	// so end-of-day balance is the anchor.
	const snapshotByDate = new Map<string, number>();
	for (const s of snapshots) {
		const d = s.timestamp.toISOString().split('T')[0];
		snapshotByDate.set(d, Number(s.balance) || 0); // last write wins (snapshots are asc)
	}

	// ── Fetch all transactions ────────────────────────────────────────────────
	// **Gjennom canonical, ikke rå `sensor_events`.** Den rå strømmen er ~3,8× duplisert, og
	// her anvendes hver transaksjon på en løpende saldo: et duplikat trekkes fra på nytt, så
	// linja drifter bort fra virkeligheten mellom to ankre og snapper tilbake ved neste. Med
	// tette ankre (synk hvert 5. minutt) er feilen liten; på PDF-importert historikk med
	// månedsankre var formen innad i måneden søppel. Og `uttak` per dag — som er tallet
	// sparefunksjonen skal måle frekvens på — ble tilsvarende blåst opp.
	//
	// PDF-importerte transaksjoner faller ut av seg selv: de finnes bare i `sensor_events`,
	// aldri i canonical. Det er ønsket her, av samme grunn som før — fortegnene deres er
	// heuristisk gjettet. Deres `bank_balance`-ankre leses fortsatt, og de er poenget.
	const { transactions: canonicalRows } = await readTransactions({
		userId,
		from: snapshots[0].timestamp,
		accountId
	});

	const transactions = canonicalRows
		.map((tx) => ({ amount: tx.amount, timestamp: tx.timestamp }))
		.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

	const txByDate = new Map<string, number>();
	const innskuddByDate = new Map<string, number>();
	const uttakByDate = new Map<string, number>();

	for (const tx of transactions) {
		const date = tx.timestamp.toISOString().split('T')[0];
		const amount = Number(tx.amount) || 0;
		txByDate.set(date, (txByDate.get(date) ?? 0) + amount);
		if (amount > 0) {
			innskuddByDate.set(date, (innskuddByDate.get(date) ?? 0) + amount);
		} else {
			uttakByDate.set(date, (uttakByDate.get(date) ?? 0) + amount);
		}
	}

	// Serien starter ved det FØRSTE ankeret, ikke ved første transaksjon.
	//
	// Den forrige utgaven kunne starte tidligere og regnet da åpningsbalansen som
	// `førsteAnker − transaksjonssummenFørDet` — altså en ekstrapolering bakover gjennom den
	// dupliserte strømmen, uten noe anker til å korrigere seg mot. Resultatet var at den
	// ELDSTE delen av kurven var den minst pålitelige, stikk motsatt av hva spørsmålet «går
	// sparekontoen ned over tid» trenger. Nå er startpunktet en målt saldo.
	//
	// Konsekvensen er at tiden før den første saldomålingen ikke tegnes. Det er riktig: der
	// finnes ingen målt saldo, bare et regnestykke. PDF-importerte kontoutskrifter gir ankre
	// år tilbake, så for sparekontoen er vinduet likevel langt.
	const firstSnapshotDate = snapshots[0].timestamp.toISOString().split('T')[0];
	const startDateStr = firstSnapshotDate;
	const openingBalance = snapshotByDate.get(firstSnapshotDate) ?? 0;
	const endDate = new Date().toISOString().split('T')[0];

	return reconstructBalanceSeries(snapshotByDate, txByDate, innskuddByDate, uttakByDate, startDateStr, endDate, openingBalance);
}

export function reconstructBalanceSeries(
	snapshotByDate: Map<string, number>,
	txByDate: Map<string, number>,
	innskuddByDate: Map<string, number>,
	uttakByDate: Map<string, number>,
	startDate: string,
	endDate: string,
	openingBalance: number
): DailyBalance[] {
	const result: DailyBalance[] = [];
	let running = openingBalance;

	const cursor = new Date(startDate);
	cursor.setHours(0, 0, 0, 0);
	const end = new Date(endDate);
	end.setHours(0, 0, 0, 0);

	while (cursor <= end) {
		const dateStr = cursor.toISOString().split('T')[0];
		running += txByDate.get(dateStr) ?? 0;

		if (snapshotByDate.has(dateStr)) {
			running = snapshotByDate.get(dateStr)!;
		}

		result.push({
			date: dateStr,
			balance: Math.round(running * 100) / 100,
			innskudd: Math.round((innskuddByDate.get(dateStr) ?? 0) * 100) / 100,
			uttak: Math.round((uttakByDate.get(dateStr) ?? 0) * 100) / 100
		});

		cursor.setDate(cursor.getDate() + 1);
	}

	return result;
}
