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

	// **Ett anker per konto per MÅNED, ikke per dag.** Dette er hele forskjellen mellom en
	// måling som virker og en som ikke gjør det.
	//
	// Første utgave tok siste anker per DAG. Da blir hvert intervall én dag, og alle
	// transaksjonene i intervallet ligger på sluttdagen — altså er hele volumet grenseusikkert,
	// `significant` blir aldri sann, og svaret «ingen avvik» er en egenskap ved MÅLINGEN framfor
	// ved dataene. Målt i prod ga 29 daglige intervaller «0 avvik» mens to aktive lønnsrader på
	// 54 685 kr sto på samme dato.
	//
	// Ankerne må være grovere enn transaksjonenes oppløsning. `canonical_date` har dagsoppløsning,
	// så månedlig gir grenseusikkerhet på én dag av tretti. `granularity=day` finnes for å kunne
	// se fella igjen.
	const granularityParam = url.searchParams.get('granularity') ?? 'month';
	if (granularityParam !== 'month' && granularityParam !== 'day') {
		error(400, 'granularity må være «month» eller «day».');
	}
	const bucket = granularityParam === 'day' ? sql`'day'` : sql`'month'`;
	const anchorRows = rowsOf<{ account_id: string; day: string; balance: string }>(
		await db.execute(sql`
			SELECT DISTINCT ON (
				data->>'accountId',
				DATE_TRUNC(${bucket}, timestamp AT TIME ZONE 'Europe/Oslo')
			)
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
				DATE_TRUNC(${bucket}, timestamp AT TIME ZONE 'Europe/Oslo'),
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
			// Intervaller der grenseusikkerheten spiser signalet. **Rapporteres**, ellers ser en
			// umålbar periode ut som en periode der alt stemmer.
			const unmeasurable = intervals.filter((i) => !i.significant && i.boundaryShare > 0.5);
			return {
				accountId,
				anchors: anchors.length,
				reconcilable: true as const,
				intervals: intervals.length,
				significantIntervals: significant.length,
				/** Positivt = vi bokfører MER enn kontoen faktisk beveget seg. */
				significantDiffNok: significantDiffTotal(intervals),
				/** Summen av ABSOLUTTavvik. Signert sum skjuler at +54 685 og −53 000 er to feil. */
				absDiffNok:
					Math.round(significant.reduce((sum, i) => sum + Math.abs(i.diff), 0) * 100) / 100,
				unmeasurableIntervals: unmeasurable.length,
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
		granularity: granularityParam,
		/**
		 * Intervaller som ikke kan avstemmes fordi hele volumet ligger på sluttdagen.
		 *
		 * Er dette tallet høyt, er «ingen avvik» meningsløst — se tetthetsfella i
		 * `balance-reconciliation.ts`.
		 */
		totalUnmeasurableIntervals: reconcilable.reduce(
			(sum, a) => sum + (a.unmeasurableIntervals ?? 0),
			0
		),
		/**
		 * Sum av ABSOLUTTavvik — det tallet som sier hvor mye vi ikke kan forklare.
		 *
		 * Det signerte tallet under skjuler at +54 685 og −53 000 er TO feil, ikke nesten null.
		 * Signert sum var min egen felle i første runde av denne målingen.
		 */
		totalAbsDiffNok:
			Math.round(reconcilable.reduce((sum, a) => sum + (a.absDiffNok ?? 0), 0) * 100) / 100,
		/**
		 * Signert sum av avvikene.
		 *
		 * **Ikke det samme som «overtelt forbruk»** — inn og ut nuller delvis hverandre ut, og en
		 * konto kan telle for mye inn mens en annen teller for mye ut. Les `totalAbsDiffNok` for
		 * omfanget; dette tallet sier bare hvilken retning nettoen peker.
		 */
		totalSignificantDiffNok:
			Math.round(reconcilable.reduce((sum, a) => sum + (a.significantDiffNok ?? 0), 0) * 100) /
			100,
		accounts
	});
};
