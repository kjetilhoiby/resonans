import { error, json } from '@sveltejs/kit';
import { db, rowsOf } from '$lib/db';
import { sql } from 'drizzle-orm';
import { requireAdmin } from '$lib/server/admin-auth';
import {
	reconcileBalances,
	significantDiffTotal,
	type BalanceAnchor,
	type ReconTx
} from '$lib/domain/economics/balance-reconciliation';
import type { RequestHandler } from './$types';

/**
 * GET /api/admin/economics/avstemming?days=180
 *
 * **Stemmer transaksjonene med saldoen?** Ren lesing.
 *
 * ## Hvorfor dette er det avgjørende målet
 *
 * Åtte runder i dette domenet har prøvd å avgjøre om to rader er samme transaksjon ut fra
 * teksten. Siden juni 2026 skriver SB1 samme overføring som «Avtale», «Regninger» og
 * «Regninger Betalt:», som ikke deler noe, og bankens `externalTransactionId` er ubrukelig som
 * identitet: **222 av 222 grupper har ulike id-er**, fordi id-en roterer ved hver synk.
 *
 * Saldoen kan ikke diskuteres. Beveget kontoen seg 27 000 mens vi har bokført 81 000, teller vi
 * for mye — og det er en observasjon, ikke en tolkning.
 *
 * Avviket sier ikke HVILKE rader som er duplikater. Det sier **om** vi teller feil, **hvor mye**,
 * **på hvilken konto** og **i hvilken periode**, og det er grunnlaget en fix må hvile på framfor
 * en ny terskel.
 *
 * ## Hva som leses
 *
 * Saldoankrene fra `sensor_events` (`bank_balance`) — canonical dekker transaksjoner, ikke saldo.
 * Transaksjonene fra `canonical_bank_transactions` med `is_active = true`, altså **nøyaktig det
 * flatene teller**. Måler vi mot noe annet enn det som vises, svarer vi på et annet spørsmål.
 *
 * Se `docs/changelog/2026-08-18-avstemming-mot-saldo.md`.
 */

const DEFAULT_DAYS = 180;
const MAX_DAYS = 400;
/** Kontoer med færre enn to saldoankre kan ikke avstemmes i det hele tatt. */
const MIN_ANCHORS = 2;

export const GET: RequestHandler = async ({ locals, url }) => {
	await requireAdmin(locals.userId);

	const daysParam = Number(url.searchParams.get('days') ?? DEFAULT_DAYS);
	if (!Number.isFinite(daysParam) || daysParam < 2 || daysParam > MAX_DAYS) {
		error(400, `days må være mellom 2 og ${MAX_DAYS}.`);
	}
	const days = Math.floor(daysParam);

	// Ett saldoanker per konto per DAG — den siste observasjonen. Synken kjører hver 6. time, så
	// uten dette blir det fire ankere om dagen og intervaller på seks timer, der dagsoppløsningen
	// på transaksjonene gjør avviket meningsløst.
	const anchorRows = rowsOf<{ account_id: string; day: string; balance: string }>(
		await db.execute(sql`
			SELECT DISTINCT ON (data->>'accountId', (timestamp AT TIME ZONE 'Europe/Oslo')::date)
				data->>'accountId' AS account_id,
				(timestamp AT TIME ZONE 'Europe/Oslo')::date::text AS day,
				(data->>'balance') AS balance
			FROM sensor_events
			WHERE user_id = ${locals.userId}
				AND data_type = 'bank_balance'
				AND timestamp >= NOW() - (${days}::int * INTERVAL '1 day')
				AND data->>'accountId' IS NOT NULL
				AND data->>'balance' IS NOT NULL
			ORDER BY
				data->>'accountId',
				(timestamp AT TIME ZONE 'Europe/Oslo')::date,
				timestamp DESC
		`)
	);

	const txRows = rowsOf<{ account_id: string; day: string; amount: string }>(
		await db.execute(sql`
			SELECT account_id, canonical_date::text AS day, amount::text AS amount
			FROM canonical_bank_transactions
			WHERE user_id = ${locals.userId}
				AND is_active = TRUE
				AND canonical_date >= CURRENT_DATE - (${days}::int)
		`)
	);

	const anchorsByAccount = new Map<string, BalanceAnchor[]>();
	for (const row of anchorRows) {
		const list = anchorsByAccount.get(row.account_id) ?? [];
		list.push({ date: row.day.slice(0, 10), balance: Number(row.balance) || 0 });
		anchorsByAccount.set(row.account_id, list);
	}

	const txByAccount = new Map<string, ReconTx[]>();
	for (const row of txRows) {
		const list = txByAccount.get(row.account_id) ?? [];
		list.push({ date: row.day.slice(0, 10), amount: Number(row.amount) || 0 });
		txByAccount.set(row.account_id, list);
	}

	const accounts = [...anchorsByAccount.entries()]
		.map(([accountId, anchors]) => {
			if (anchors.length < MIN_ANCHORS) {
				// **Rapporteres framfor å utelates.** En konto som stille faller ut av avstemmingen
				// ser ut som en konto der alt stemmer.
				return { accountId, anchors: anchors.length, reconcilable: false as const };
			}
			const intervals = reconcileBalances(anchors, txByAccount.get(accountId) ?? []);
			const significant = intervals.filter((i) => i.significant);
			return {
				accountId,
				anchors: anchors.length,
				reconcilable: true as const,
				intervals: intervals.length,
				significantIntervals: significant.length,
				/** Positivt = vi bokfører MER enn kontoen faktisk beveget seg. */
				significantDiffNok: significantDiffTotal(intervals),
				worst: [...significant]
					.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
					.slice(0, 10)
			};
		})
		.sort((a, b) => {
			const av = a.reconcilable ? Math.abs(a.significantDiffNok) : -1;
			const bv = b.reconcilable ? Math.abs(b.significantDiffNok) : -1;
			return bv - av;
		});

	const reconcilable = accounts.filter((a) => a.reconcilable);

	return json({
		window: { days },
		accountsTotal: accounts.length,
		accountsReconcilable: reconcilable.length,
		/**
		 * Summen av reelle avvik over alle kontoer.
		 *
		 * **Ikke det samme som «overtelt forbruk»** — inn og ut nuller delvis hverandre ut, og
		 * en konto kan telle for mye inn mens en annen teller for mye ut. Tallet er et mål på
		 * hvor mye vi IKKE kan forklare, ikke en korreksjon som kan trekkes fra noe.
		 */
		totalSignificantDiffNok:
			Math.round(reconcilable.reduce((sum, a) => sum + (a.significantDiffNok ?? 0), 0) * 100) /
			100,
		accounts
	});
};
