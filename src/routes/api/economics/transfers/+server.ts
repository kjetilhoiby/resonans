import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { persons } from '$lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { readTransactions, readLatestBalances } from '$lib/server/economics/transactions';
import type { RequestHandler } from './$types';

/**
 * GET /api/economics/transfers?accountId=xxx
 *
 * Overføringer på kontoen som kan knyttes til en person i husholdningen, med retning
 * relativt til kontoen (`incoming` = penger inn). Pluss en saldoserie for kontoen.
 *
 * To ting endret seg i august 2026 (se
 * `docs/changelog/2026-08-11-okonomi-tillitsgjennomgang.md`):
 *
 * 1. **Navnene er ikke hardkodet lenger.** Endepunktet bar to personnavn og fem
 *    ILIKE-mønstre i kildekoden. Nå leses `self` og `partner` fra `persons`, med `aliases`
 *    som allerede finnes der for navnevarianter — så en ny husholdning virker uten en
 *    kodeendring, og repoet bærer ikke persondata.
 * 2. **Leser canonical, ikke rå `sensor_events`.** Den rå strømmen er ~3,8× duplisert, og
 *    her ble den både listet og brukt til å bakprojisere en saldo.
 */

const MONTHS_BACK = 18;

/** Ord som er for generiske å matche på. «Ole» treffer «Olerud», og et fornavn på tre
 *  bokstaver treffer halve kontoutskriften. */
const MIN_NAME_TOKEN_LENGTH = 4;

function nameTokensFor(person: { name: string; fullName: string | null; aliases: string[] }): string[] {
	const raw = [person.name, ...(person.fullName?.split(/\s+/) ?? []), ...person.aliases];
	return [
		...new Set(
			raw
				.map((token) => token.trim().toLowerCase())
				.filter((token) => token.length >= MIN_NAME_TOKEN_LENGTH)
		)
	];
}

export const GET: RequestHandler = async ({ url, locals }) => {
	const userId = locals.userId;
	const accountId = url.searchParams.get('accountId');
	if (!accountId) return json({ error: 'Missing accountId' }, { status: 400 });

	const cutoff = new Date();
	cutoff.setMonth(cutoff.getMonth() - MONTHS_BACK);

	const [{ transactions: rows }, balances, household] = await Promise.all([
		readTransactions({ userId, from: cutoff, accountId }),
		readLatestBalances(userId),
		db
			.select({
				name: persons.name,
				fullName: persons.fullName,
				aliases: persons.aliases,
				kind: persons.kind
			})
			.from(persons)
			.where(
				and(
					eq(persons.userId, userId),
					eq(persons.archived, false),
					inArray(persons.kind, ['self', 'partner'])
				)
			)
	]);

	const people = household.map((person) => ({
		name: person.name,
		tokens: nameTokensFor(person)
	}));

	interface Transfer {
		date: string;
		person: string;
		/** true = money arriving at the selected account */
		incoming: boolean;
		amount: number;
		description: string;
		/** Sann når motparten er en annen av brukerens egne kontoer. */
		internal: boolean;
	}

	const transfers: Transfer[] = [];

	for (const row of rows) {
		const desc = row.description;
		const haystack = desc.toLowerCase();

		// Småsparing/avrunding er ikke en overføring mellom folk.
		if (/småsparing|avrunding/i.test(desc)) continue;

		const match = people.find((person) => person.tokens.some((token) => haystack.includes(token)));
		if (!match) continue;

		transfers.push({
			date: row.date,
			person: match.name,
			incoming: row.amount > 0,
			amount: Math.abs(row.amount),
			description: desc,
			internal: row.isInternalTransfer
		});
	}

	// ── Saldoserie, bakprojisert fra siste kjente saldo ──────────────────────
	// NB: dette er en serie over dagene som HAR en av overføringene over, ikke en daglig
	// saldokurve — den bor i `buildDailyBalances`, som ankres på faktiske saldomålinger.
	const balanceHistory: { date: string; balance: number }[] = [];
	const latest = balances.find((b) => b.accountId === accountId);
	if (latest) {
		const txTotal = rows.reduce((sum, row) => sum + row.amount, 0);
		let running = latest.balance - txTotal;

		const txByDate = new Map<string, number>();
		for (const row of rows) {
			txByDate.set(row.date, (txByDate.get(row.date) ?? 0) + row.amount);
		}
		for (const date of [...txByDate.keys()].sort()) {
			running += txByDate.get(date)!;
			balanceHistory.push({ date, balance: running });
		}
	}

	transfers.sort((a, b) => a.date.localeCompare(b.date));

	return json({ transfers, balanceHistory });
};
