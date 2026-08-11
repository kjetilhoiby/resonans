import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-auth';
import { pgClient } from '$lib/db';
import type { RequestHandler } from './$types';

/**
 * GET /api/admin/debug-sparebank1/dedup?days=365
 *
 * Svarer på de fire spørsmålene fase 2 i
 * `docs/changelog/2026-08-11-okonomi-tillitsgjennomgang.md` ikke kan svare på ved å
 * lese kode. Alt leses av `raw_bank_transaction_versions` — ingen API-kall, ingen
 * skriving.
 *
 * Bakgrunn: SB1 gir ny `transactionId` hver gang, og samme transaksjon kommer flere
 * ganger etter hverandre med ny status. Bøttenøkkelen
 * (konto, dato, beløp, merchant_key) kollapser derfor observasjoner til én canonical-rad.
 * Det er riktig for statusoverganger og galt for sju like kjøp samme kveld — og fra
 * attributtene alene er de to tilfellene identiske.
 *
 * Skillet ligger i HVOR observasjonene ligger: sju like kjøp er sju rader i ETT
 * API-svar, en statusovergang er én rad per svar over flere svar.
 *
 * `first_seen_at` er en presis svar-identifikator, ikke en tilnærming: alle rader fra
 * én synk settes inn i én UNNEST-INSERT, og `NOW()` i Postgres er
 * transaksjonstidspunktet — altså bytelikt for hele batchen. Rader som fantes fra før
 * beholder sin opprinnelige `first_seen_at` og får bare `last_seen_at` oppdatert, så
 * gruppering på `first_seen_at` gir «svaret der denne versjonen dukket opp først».
 */

const DEFAULT_DAYS = 365;
const MAX_PAIR_SAMPLES = 60;
const DRIFT_WINDOW_DAYS = 7;

export const GET: RequestHandler = async ({ locals, url }) => {
	await requireAdmin(locals.userId);
	const userId = locals.userId;

	const daysParam = Number(url.searchParams.get('days') ?? DEFAULT_DAYS);
	const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.floor(daysParam) : DEFAULT_DAYS;
	const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

	// ── 1. Hvilke bookingStatus-verdier finnes egentlig? ─────────────────────
	// Koden kjenner 'BOOKED' (rank 20) og 'PENDING' (rank 10) og gir alt annet rank 0.
	// En status med rank 0 og mange rader er en status som faller igjennom: den deltar
	// ikke i GREATEST-løftet, og batch-kollapsen sammenligner === 'BOOKED' som ren
	// streng. `unmapped` peker derfor rett på et hull i `bookingStatusRank`.
	const statuses = await pgClient.unsafe<{
		booking_status: string | null;
		status_rank: number;
		versions: string;
		distinct_ids: string;
		first_date: string;
		last_date: string;
	}[]>(
		`SELECT booking_status,
		        MAX(status_rank)                             AS status_rank,
		        COUNT(*)                                     AS versions,
		        COUNT(DISTINCT external_transaction_id)      AS distinct_ids,
		        MIN(transaction_date)::text                  AS first_date,
		        MAX(transaction_date)::text                  AS last_date
		 FROM raw_bank_transaction_versions
		 WHERE user_id = $1 AND transaction_date >= $2::date
		 GROUP BY booking_status
		 ORDER BY COUNT(*) DESC`,
		[userId, fromDate]
	);

	// ── 2 + 3. Multiplisitet per bøtte ───────────────────────────────────────
	// `multiplicity` = maks antall distinkte ID-er innenfor ett svar OG én status.
	// Maks og ikke sum, fordi både PENDING og BOOKED kan komme i samme batch
	// (jf. kommentaren i sparebank1-sync.ts:649) — summen ville tolket den ene
	// transaksjonens to statuser som to kjøp.
	//
	// multiplicity = 1, fetches > 1  → statusovergang eller gjentatt synk. Korrekt i dag.
	// multiplicity > 1               → ekte gjentatte kjøp. Tapt i dag: bøtta har én rad.
	const multiplicity = await pgClient.unsafe<{
		multiplicity: number;
		buckets: string;
		observations: string;
		avg_fetches: string;
		avg_statuses: string;
		lost_nok: string | null;
	}[]>(
		`WITH per_fetch_status AS (
			SELECT account_id, transaction_date, amount, description_normalized AS mk,
			       first_seen_at, booking_status,
			       COUNT(DISTINCT external_transaction_id) AS n
			FROM raw_bank_transaction_versions
			WHERE user_id = $1 AND transaction_date >= $2::date
			  AND external_transaction_id IS NOT NULL AND external_transaction_id <> ''
			GROUP BY 1, 2, 3, 4, 5, 6
		),
		buckets AS (
			SELECT account_id, transaction_date, amount, mk,
			       MAX(n)                          AS multiplicity,
			       SUM(n)                          AS total_observations,
			       COUNT(DISTINCT first_seen_at)   AS fetches,
			       COUNT(DISTINCT booking_status)  AS statuses
			FROM per_fetch_status
			GROUP BY 1, 2, 3, 4
		)
		SELECT multiplicity,
		       COUNT(*)                                  AS buckets,
		       SUM(total_observations)                    AS observations,
		       ROUND(AVG(fetches), 2)::text               AS avg_fetches,
		       ROUND(AVG(statuses), 2)::text              AS avg_statuses,
		       ROUND(SUM(
		         CASE WHEN amount < 0 THEN (multiplicity - 1) * ABS(amount) ELSE 0 END
		       ), 0)::text                                AS lost_nok
		 FROM buckets
		 GROUP BY multiplicity
		 ORDER BY multiplicity`,
		[userId, fromDate]
	);

	// ── 4. Beløps- og datodrift mellom statuser ──────────────────────────────
	// Hypotesen: en reservasjon får tips lagt på og bokføres senere, så reservert og
	// ferdig havner i ULIKE bøtter. Upserten finner ingen konflikt, reservasjonen blir
	// stående ved siden av den ferdige, og beløpet telles to ganger.
	//
	// Målingen er bevisst ikke en påstand om at parene hører sammen — den viser
	// FORDELINGEN av avvik mellom en bøtte som stanset under toppstatus og nærmeste
	// bøtte som nådde den. Er det en tett klynge på få dager og små positive
	// prosentavvik, er hypotesen god og klyngen gir tersklene. Er fordelingen diffus,
	// er hypotesen feil — og da skal ingen terskel velges.
	const drift = await pgClient.unsafe<{
		account_id: string;
		mk: string;
		stalled_date: string;
		stalled_amount: string;
		stalled_status: string | null;
		final_date: string | null;
		final_amount: string | null;
		delta_days: number | null;
		delta_pct: string | null;
	}[]>(
		`WITH bucket AS (
			SELECT account_id, transaction_date, amount, description_normalized AS mk,
			       MAX(status_rank)                        AS max_rank,
			       MIN(booking_status)                     AS status_sample
			FROM raw_bank_transaction_versions
			WHERE user_id = $1 AND transaction_date >= $2::date
			GROUP BY 1, 2, 3, 4
		),
		top AS (SELECT MAX(max_rank) AS top_rank FROM bucket),
		stalled AS (SELECT b.* FROM bucket b, top t WHERE b.max_rank < t.top_rank),
		final AS (SELECT b.* FROM bucket b, top t WHERE b.max_rank = t.top_rank)
		SELECT s.account_id,
		       s.mk,
		       s.transaction_date::text AS stalled_date,
		       s.amount::text           AS stalled_amount,
		       s.status_sample          AS stalled_status,
		       f.transaction_date::text AS final_date,
		       f.amount::text           AS final_amount,
		       (f.transaction_date - s.transaction_date) AS delta_days,
		       ROUND(
		         ((ABS(f.amount) - ABS(s.amount)) / NULLIF(ABS(s.amount), 0) * 100)::numeric, 1
		       )::text AS delta_pct
		 FROM stalled s
		 LEFT JOIN LATERAL (
		   SELECT f.* FROM final f
		   WHERE f.account_id = s.account_id
		     AND f.mk = s.mk
		     AND f.transaction_date BETWEEN s.transaction_date - $3::int
		                                AND s.transaction_date + $3::int
		   ORDER BY ABS(f.transaction_date - s.transaction_date),
		            ABS(ABS(f.amount) - ABS(s.amount))
		   LIMIT 1
		 ) f ON TRUE
		 ORDER BY s.transaction_date DESC
		 LIMIT $4::int`,
		[userId, fromDate, DRIFT_WINDOW_DAYS, MAX_PAIR_SAMPLES]
	);

	// Foreldreløse: bøtter som stanset under toppstatus UTEN noen kandidat i vinduet.
	// Enten kansellerte reservasjoner (skal bli isActive = false) eller reelle
	// transaksjoner som aldri fikk sluttstatus. Antallet avgjør om livsløpsregelen
	// i fase 2 punkt 4 er verdt å bygge.
	const orphans = await pgClient.unsafe<{ orphans: string; orphan_nok: string | null }[]>(
		`WITH bucket AS (
			SELECT account_id, transaction_date, amount, description_normalized AS mk,
			       MAX(status_rank) AS max_rank
			FROM raw_bank_transaction_versions
			WHERE user_id = $1 AND transaction_date >= $2::date
			GROUP BY 1, 2, 3, 4
		),
		top AS (SELECT MAX(max_rank) AS top_rank FROM bucket),
		stalled AS (SELECT b.* FROM bucket b, top t WHERE b.max_rank < t.top_rank),
		final AS (SELECT b.* FROM bucket b, top t WHERE b.max_rank = t.top_rank)
		SELECT COUNT(*)::text AS orphans,
		       ROUND(SUM(CASE WHEN s.amount < 0 THEN ABS(s.amount) ELSE 0 END), 0)::text AS orphan_nok
		 FROM stalled s
		 WHERE NOT EXISTS (
		   SELECT 1 FROM final f
		   WHERE f.account_id = s.account_id AND f.mk = s.mk
		     AND f.transaction_date BETWEEN s.transaction_date - $3::int
		                                AND s.transaction_date + $3::int
		 )`,
		[userId, fromDate, DRIFT_WINDOW_DAYS]
	);

	// ── Sprik mellom lagrene ─────────────────────────────────────────────────
	// «Ulike tall på ulike steder», tallfestet. De tre radene skal være enige om
	// samme periode og er det ikke i dag.
	const stores = await pgClient.unsafe<{
		store: string;
		rows: string;
		spend_nok: string | null;
	}[]>(
		`SELECT 'sensor_events'  AS store,
		        COUNT(*)::text   AS rows,
		        ROUND(SUM(CASE WHEN (data->>'amount')::numeric < 0
		                       THEN ABS((data->>'amount')::numeric) ELSE 0 END), 0)::text AS spend_nok
		 FROM sensor_events
		 WHERE user_id = $1 AND data_type = 'bank_transaction' AND timestamp >= $2::date
		 UNION ALL
		 SELECT 'canonical_bank_transactions',
		        COUNT(*)::text,
		        ROUND(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0)::text
		 FROM canonical_bank_transactions
		 WHERE user_id = $1 AND is_active = TRUE AND canonical_date >= $2::date
		 UNION ALL
		 SELECT 'categorized_events',
		        COUNT(*)::text,
		        ROUND(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0)::text
		 FROM categorized_events
		 WHERE user_id = $1 AND timestamp >= $2::date`,
		[userId, fromDate]
	);

	// Hvor mye av «forbruket» er egne overføringer? Parvis: negativ på én konto og
	// positiv på en annen, samme dag, samme beløp. Ingen av lesestiene ekskluderer dem
	// i dag, så de blåser opp forbruk og inntekt samtidig.
	const internalTransfers = await pgClient.unsafe<{
		pairs: string;
		transfer_nok: string | null;
	}[]>(
		`WITH t AS (
			SELECT account_id, canonical_date, amount
			FROM canonical_bank_transactions
			WHERE user_id = $1 AND is_active = TRUE AND canonical_date >= $2::date
		)
		SELECT COUNT(*)::text AS pairs,
		       ROUND(SUM(ABS(a.amount)), 0)::text AS transfer_nok
		 FROM t a
		 JOIN t b ON b.canonical_date = a.canonical_date
		         AND b.amount = -a.amount
		         AND b.account_id <> a.account_id
		 WHERE a.amount < 0`,
		[userId, fromDate]
	);

	const driftWithCandidate = drift.filter((d) => d.final_date !== null);

	return json({
		window: { days, fromDate },

		// Spørsmål 1: hvilke statuser finnes, og hvilke faller igjennom rank-mappingen.
		statuses: statuses.map((s) => ({
			bookingStatus: s.booking_status,
			statusRank: Number(s.status_rank),
			unmapped: Number(s.status_rank) === 0,
			versions: Number(s.versions),
			distinctIds: Number(s.distinct_ids),
			firstDate: s.first_date,
			lastDate: s.last_date
		})),

		// Spørsmål 2 + 3: multiplisitetshistogram. Rader med multiplicity > 1 er kroner
		// vi underrapporterer i dag — det er «summen var åpenbart for lav», tallfestet.
		multiplicity: multiplicity.map((m) => ({
			multiplicity: Number(m.multiplicity),
			buckets: Number(m.buckets),
			observations: Number(m.observations),
			avgFetches: Number(m.avg_fetches),
			avgStatuses: Number(m.avg_statuses),
			underreportedNok: m.lost_nok === null ? 0 : Number(m.lost_nok)
		})),

		// Spørsmål 4: driver beløpet og datoen mellom statuser? Se etter en TETT klynge.
		// Diffus fordeling = hypotesen er feil, og da skal ingen terskel velges.
		drift: {
			windowDays: DRIFT_WINDOW_DAYS,
			stalledWithCandidate: driftWithCandidate.length,
			deltaDaysHistogram: histogram(driftWithCandidate.map((d) => Number(d.delta_days))),
			deltaPctHistogram: histogram(
				driftWithCandidate
					.map((d) => (d.delta_pct === null ? null : Math.round(Number(d.delta_pct))))
					.filter((v): v is number => v !== null)
			),
			samples: drift.map((d) => ({
				accountId: d.account_id,
				merchantKey: d.mk,
				stalledDate: d.stalled_date,
				stalledAmount: Number(d.stalled_amount),
				stalledStatus: d.stalled_status,
				finalDate: d.final_date,
				finalAmount: d.final_amount === null ? null : Number(d.final_amount),
				deltaDays: d.delta_days === null ? null : Number(d.delta_days),
				deltaPct: d.delta_pct === null ? null : Number(d.delta_pct)
			})),
			orphans: Number(orphans[0]?.orphans ?? 0),
			orphanNok: orphans[0]?.orphan_nok === null ? 0 : Number(orphans[0]?.orphan_nok ?? 0)
		},

		// «Ulike tall på ulike steder», tallfestet.
		stores: stores.map((s) => ({
			store: s.store,
			rows: Number(s.rows),
			spendNok: s.spend_nok === null ? 0 : Number(s.spend_nok)
		})),

		// «Summen var åpenbart for høy», tallfestet.
		internalTransfers: {
			pairs: Number(internalTransfers[0]?.pairs ?? 0),
			nok:
				internalTransfers[0]?.transfer_nok === null
					? 0
					: Number(internalTransfers[0]?.transfer_nok ?? 0)
		},

		notes: [
			'Kun lesing. Ingen SB1-kall, ingen skriving.',
			'first_seen_at identifiserer ett API-svar presist: hele synk-batchen settes inn i én INSERT, og NOW() er transaksjonstidspunktet.',
			'multiplicity er maks distinkte ID-er per (svar, status), ikke summen — begge statuser kan komme i samme batch.',
			'statuses[].unmapped = true betyr status_rank 0: statusen deltar ikke i GREATEST-løftet, og batch-kollapsens === BOOKED treffer den ikke.',
			'drift.samples er kandidatpar, ikke bekreftede sammenhenger. Tersklene skal leses av histogrammene, ikke velges.',
			'Er drift.stalledWithCandidate 0 fordi alle bøtter har samme toppstatus, gjelder ikke driftshypotesen for lagrede data — det er også et svar.'
		]
	});
};

/** Tellinger per verdi, sortert på verdi. Små datasett — ingen bøtting. */
function histogram(values: number[]): Array<{ value: number; count: number }> {
	const counts = new Map<number, number>();
	for (const v of values) {
		if (!Number.isFinite(v)) continue;
		counts.set(v, (counts.get(v) ?? 0) + 1);
	}
	return [...counts.entries()]
		.map(([value, count]) => ({ value, count }))
		.sort((a, b) => a.value - b.value);
}
