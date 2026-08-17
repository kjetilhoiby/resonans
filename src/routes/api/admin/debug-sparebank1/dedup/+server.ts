import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-auth';
import { pgClient } from '$lib/db';
import { readTransactions } from '$lib/server/economics/transactions';
import {
	doubleCountedTotals,
	matchReservationsToBooked,
	type ReservationCandidate
} from '$lib/domain/economics/reservation-matching';
import { findInternalTransfers } from '$lib/domain/economics/internal-transfers';
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

/** Bøttas status som tri-tilstand. Ukjent gjettes ikke til noen av sidene. */
function bucketStatus(value: string | null): 'pending' | 'booked' | 'unknown' {
	if (value === 'BOOKED') return 'booked';
	if (value === 'PENDING') return 'pending';
	return 'unknown';
}

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
		   -- Eksakt beløp FØRST, dato etterpå. Motsatt rekkefølge (som var første
		   -- utgave) mispairer systematisk: flere kjøp hos samme merchant samme dag
		   -- er vanlig — Rema ×3, Tesla ×4, Circle K ×2 i ett enkelt uttrekk — og da
		   -- får alle de nære datoene samme motpart, mens den ekte motparten med
		   -- identisk beløp ligger en dag eller to unna og aldri velges. Histogrammet
		   -- fyltes da med oppdiktede prosentavvik (+710 %, −94 %) som ser ut som
		   -- beløpsdrift og ikke er det.
		   ORDER BY (ABS(f.amount) = ABS(s.amount)) DESC,
		            ABS(f.transaction_date - s.transaction_date),
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

	// ── 5. Livsløp: forsvinner den forrige statusen når den neste kommer? ────
	//
	// Brukerens hypotese, og en bedre modell enn attributt-likhet: SB1 **erstatter**
	// reservasjonen med den bokførte raden framfor å levere begge. Synken vår er additiv,
	// så begge blir stående — én foreldreløs PENDING og én BOOKED — og telles to ganger.
	//
	// Er det sant, er forsvinning en OBSERVASJON og ikke en gjetning: da kan to rader
	// matches på beløp alene, uten å risikere at to ekte kjøp slås sammen. Ekte kjøp
	// fortsetter å bli sett; et erstattet gjør ikke.
	//
	// **RETTET 2026-08-16 etter måling i prod.** Første utgave påsto at `seen_count = 1`
	// over hele linja betyr at SB1 minter en ny ID ved hver henting. Det var galt, og
	// konklusjonen ville sendt oss til å nøkle om rå-strømmen for ingenting.
	//
	// Årsaken er vår egen synk: `since = sensor.lastSync` (`sparebank1-sync.ts`), altså et
	// INKREMENTELT kall som bare ber om det banken har endret siden sist. En uendret rad
	// kommer derfor aldri tilbake, treffer aldri `ON CONFLICT`, og `seen_count` KAN ikke
	// vokse — uansett hvor stabil ID-en er. Porten målte vår henterutine, ikke banken.
	//
	// Row-tallet avkrefter dessuten ID-churn direkte: med synk hvert 5. minutt og sju
	// dagers vindu ville en ny ID per henting gitt ~2 000 versjoner per transaksjon.
	// Målt i prod: 5 650 rå-rader mot 1 125 canonical, altså ~5. Se
	// `versionsPerCanonicalRow`.
	//
	// **Forsvinning kan bare måles med et FULLSTENDIG vindusuttrekk** — en periodisk
	// avstemming som ignorerer `lastSync` og henter siste N dager i sin helhet. Da blir
	// «fortsatt der» og «borte» to ulike observasjoner. Uten den er de identiske.
	const seenCounts = await pgClient.unsafe<{
		seen_count: number;
		rows: string;
	}[]>(
		`SELECT seen_count, COUNT(*)::text AS rows
		 FROM raw_bank_transaction_versions
		 WHERE user_id = $1 AND transaction_date >= $2::date
		 GROUP BY seen_count
		 ORDER BY seen_count
		 LIMIT 40`,
		[userId, fromDate]
	);

	// Forsvunne versjoner: `last_seen_at` henger etter det NYESTE tidspunktet noen rad på
	// samme konto+dato ble sett.
	//
	// Sammenligningen må være mot samme DATO, ikke mot nå. En transaksjon slutter å bli
	// hentet når den faller ut av synkvinduet, og da stopper `last_seen_at` av en helt
	// godartet grunn. Ligger andre rader på samme dag og fortsatt ble sett etterpå, hentet
	// vi fortsatt den dagen — og denne raden var ikke der.
	const disappeared = await pgClient.unsafe<{
		booking_status: string | null;
		rows: string;
		nok: string | null;
	}[]>(
		`WITH per_row AS (
			SELECT booking_status, amount, last_seen_at,
			       MAX(last_seen_at) OVER (PARTITION BY account_id, transaction_date) AS day_last_seen
			FROM raw_bank_transaction_versions
			WHERE user_id = $1 AND transaction_date >= $2::date
		)
		SELECT booking_status,
		       COUNT(*)::text AS rows,
		       ROUND(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0)::text AS nok
		 FROM per_row
		 WHERE last_seen_at < day_last_seen - INTERVAL '1 hour'
		 GROUP BY booking_status
		 ORDER BY COUNT(*) DESC`,
		[userId, fromDate]
	);

	// Erstatningskandidater: en forsvunnet rad, og en rad med SAMME BELØP på samme konto
	// som ble sett først ETTER at den forsvant.
	//
	// Matchingen er på beløp, som brukeren foreslo — og det er trygt nettopp fordi
	// forsvinningen alt har fastslått at raden ble erstattet. Verken datoen eller
	// beskrivelsen inngår, så både datodriften og `SEK `-prefikset blir irrelevante.
	// `delta_days` og `mk_changed` rapporteres for å VISE hvor fritt de to beveger seg.
	const superseded = await pgClient.unsafe<{
		delta_days: number | null;
		mk_changed: boolean;
		pairs: string;
		nok: string | null;
	}[]>(
		`WITH per_row AS (
			SELECT id, account_id, transaction_date, amount, booking_status, status_rank,
			       description_normalized AS mk, first_seen_at, last_seen_at,
			       MAX(last_seen_at) OVER (PARTITION BY account_id, transaction_date) AS day_last_seen
			FROM raw_bank_transaction_versions
			WHERE user_id = $1 AND transaction_date >= $2::date
		),
		gone AS (
			SELECT * FROM per_row WHERE last_seen_at < day_last_seen - INTERVAL '1 hour'
		)
		SELECT (s.transaction_date - g.transaction_date) AS delta_days,
		       (s.mk IS DISTINCT FROM g.mk)              AS mk_changed,
		       COUNT(*)::text                            AS pairs,
		       ROUND(SUM(CASE WHEN g.amount < 0 THEN ABS(g.amount) ELSE 0 END), 0)::text AS nok
		 FROM gone g
		 JOIN LATERAL (
		   SELECT p.* FROM per_row p
		   WHERE p.id <> g.id
		     AND p.account_id = g.account_id
		     AND p.amount = g.amount
		     AND p.first_seen_at >= g.last_seen_at
		     AND p.last_seen_at >= g.day_last_seen - INTERVAL '1 hour'
		   ORDER BY p.first_seen_at
		   LIMIT 1
		 ) s ON TRUE
		 GROUP BY 1, 2
		 ORDER BY COUNT(*) DESC
		 LIMIT 100`,
		[userId, fromDate]
	);

	// ── 6. Foreldreløs reservasjon mot bokført rad, UTEN merchant_key-kravet ─
	//
	// Dette er målingen drift-spørringen ikke kunne gjøre: den joiner på `f.mk = s.mk`, så et
	// par der beskrivelsen endret seg — «SEK ICA NARA HAGA» mot «ICA NARA HAGA» — var per
	// konstruksjon usynlig. Målt i prod: 110 av 271 par, 103 165 kr.
	//
	// **RETTET 2026-08-16: matchingen er flyttet ut av SQL.** Første utgave var en LATERAL
	// join som ga hver reservasjon sin nærmeste bokførte rad UTEN å reservere den, så tre
	// PENDING på 255 kr kunne alle peke på samme bokførte kjøp. Det er nøyaktig samme
	// én-til-én-feil overføringstellingen hadde, gjentatt i samme fil noen linjer unna, fordi
	// en LATERAL join med `LIMIT 1` ser uskyldig ut. Nå henter SQL bare bøttene, og
	// `matchReservationsToBooked` gjør parringen — rent og testet.
	const buckets = await pgClient.unsafe<{
		account_id: string;
		transaction_date: string;
		amount: string;
		mk: string;
		booking_status: string | null;
	}[]>(
		// Statusen hentes som TEKST, ikke som rang. `bookingStatusRank` gir 0 for manglende
		// status, og en utledning «rank < topRank ⇒ reservasjon» gjorde «vi vet ikke» til
		// «ubokført». Bøtta får den HØYESTE statusen den nådde.
		`SELECT account_id,
		        transaction_date::text AS transaction_date,
		        amount::text           AS amount,
		        description_normalized AS mk,
		        CASE WHEN MAX(status_rank) = 20 THEN 'BOOKED'
		             WHEN MAX(status_rank) = 10 THEN 'PENDING'
		             ELSE NULL END     AS booking_status
		 FROM raw_bank_transaction_versions
		 WHERE user_id = $1 AND transaction_date >= $2::date
		 GROUP BY 1, 2, 3, 4`,
		[userId, fromDate]
	);

	// Interne overføringer merkes med den delte matchingen og holdes utenfor: runde beløp som
	// gjentas ville blitt paret som reservasjon + bokført. Se `reservation-matching.ts`.
	const bucketRows = buckets.map((row, index) => ({
		// Bøtta har ingen egen id — nøkkelen ER identiteten, og indeksen holder den unik.
		id: `${row.account_id}|${row.transaction_date}|${row.amount}|${row.mk}|${index}`,
		accountId: row.account_id,
		date: row.transaction_date,
		amount: Number(row.amount) || 0,
		merchantKey: row.mk ?? '',
		status: bucketStatus(row.booking_status)
	}));
	const bucketTransfers = findInternalTransfers(bucketRows);

	const reservationCandidates: ReservationCandidate[] = bucketRows.map((row) => ({
		...row,
		internalTransfer: bucketTransfers.internalIds.has(row.id)
	}));

	const reservationResult = matchReservationsToBooked(reservationCandidates);

	// Histogram på (datoforskjell, endret beskrivelse), som før — men nå fra par som ikke
	// kan dele motpart.
	// Histogrammet viser bare FORBRUKS-par. Inntektsparene er like duplisert og skal
	// deaktiveres, men de hører ikke i en tabell som leses som «dette er forbruk».
	const orphanBuckets = new Map<string, { deltaDays: number; mkChanged: boolean; pairs: number; nok: number }>();
	for (const match of reservationResult.matches) {
		if (match.direction !== 'out') continue;
		const key = `${match.deltaDays}|${match.merchantKeyChanged}`;
		const entry = orphanBuckets.get(key) ?? {
			deltaDays: match.deltaDays,
			mkChanged: match.merchantKeyChanged,
			pairs: 0,
			nok: 0
		};
		entry.pairs += 1;
		entry.nok += match.amount;
		orphanBuckets.set(key, entry);
	}
	const doubleCounted = doubleCountedTotals(reservationResult.matches);
	const orphanRows = [...orphanBuckets.values()].sort((a, b) => b.pairs - a.pairs);

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

	// Hvor mye av «forbruket» er egne overføringer?
	//
	// **RETTET 2026-08-16.** Første utgave var en SQL self-join, og den var mange-til-mange:
	// tre uttak på 500 og tre innskudd på 500 samme dag ga NI par. Prod viste 950 050 kr i
	// «overføringer» mot 936 489 kr totalt forbruk, altså mer enn alt som fantes — og
	// kortets nettotall ble **−4 581 kr/mnd**, et negativt forbruk. Et instrument som lyver
	// er verre enn ingen.
	//
	// Nå brukes `readTransactions`, altså **samme én-til-én-matching flaten bruker**
	// (`findInternalTransfers`). Diagnosen og flaten kan da ikke være uenige om dette tallet
	// — som er hele poenget med én delt leser. At diagnosen hadde sin egen variant var
	// nøyaktig feilen fase 1 gikk løs på, gjentatt i verktøyet som skulle avdekke den.
	const { internalTransfers: sharedTransfers } = await readTransactions({
		userId,
		from: fromDate
	});
	const internalTransferPairs = sharedTransfers.links.length;
	const internalTransferNok = sharedTransfers.links.reduce((sum, link) => sum + link.amount, 0);

	const driftWithCandidate = drift.filter((d) => d.final_date !== null);

	// Rå-versjoner per canonical-rad. Avkrefter ID-churn per henting: ~5, ikke ~2 000.
	const canonicalRowCount = Number(
		stores.find((s) => s.store === 'canonical_bank_transactions')?.rows ?? 0
	);
	const rawVersionCount = statuses.reduce((sum, s) => sum + Number(s.versions), 0);
	const rawVersionsPerCanonicalRow =
		canonicalRowCount > 0 ? Math.round((rawVersionCount / canonicalRowCount) * 10) / 10 : null;

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

		// Spørsmål 5: forsvinner den forrige statusen når den neste kommer?
		//
		// `fingerprintStableAcrossFetches` er PORTEN. Er den falsk, betyr ikke `disappeared`
		// at noe forsvant — det betyr bare at SB1 minter en ny id per henting, så hver
		// henting lager en ny rad og ingen rad blir sett to ganger. Da er hele
		// forsvinningsmålingen meningsløs, og tallene under skal ikke leses.
		lifecycle: {
			seenCountHistogram: seenCounts.map((s) => ({
				seenCount: Number(s.seen_count),
				rows: Number(s.rows)
			})),
			/**
			 * Rå-versjoner per canonical-rad. Dette er tallet som AVKREFTER at SB1 minter en ny
			 * ID ved hver henting: med synk hvert 5. minutt ville det vært i tusenklassen.
			 * Målt i prod 2026-08-16: ~5.
			 */
			versionsPerCanonicalRow: rawVersionsPerCanonicalRow,
			/**
			 * Sann fordi `since = sensor.lastSync` i `sparebank1-sync.ts`: synken er
			 * inkrementell, så en uendret rad kommer aldri tilbake og `seen_count` KAN ikke
			 * vokse. `seen_count = 1` er derfor forventet uansett, og sier ingenting om ID-ene.
			 * Feltet er hardkodet fordi det er en egenskap ved koden, ikke ved dataene — og det
			 * står her så ingen leser histogrammet som et funn igjen.
			 */
			singleSeenExplainedByIncrementalFetch: true,
			/** Forsvinning krever et fullstendig vindusuttrekk. Se doc-kommentaren i fila. */
			disappearanceMeasurable: false,
			multiSeenRows: seenCounts
				.filter((s) => Number(s.seen_count) > 1)
				.reduce((sum, s) => sum + Number(s.rows), 0),
			singleSeenRows: seenCounts
				.filter((s) => Number(s.seen_count) === 1)
				.reduce((sum, s) => sum + Number(s.rows), 0),
			disappeared: disappeared.map((d) => ({
				bookingStatus: d.booking_status,
				rows: Number(d.rows),
				nok: d.nok === null ? 0 : Number(d.nok)
			})),
			superseded: superseded.map((s) => ({
				deltaDays: s.delta_days === null ? null : Number(s.delta_days),
				merchantKeyChanged: s.mk_changed,
				pairs: Number(s.pairs),
				nok: s.nok === null ? 0 : Number(s.nok)
			})),
			/**
			 * Forsvunne rader UTEN en beløpslik etterfølger. Restposten, og den skal sies.
			 *
			 * To grunner den kan være stor, og de krever motsatt handling: beløpet endret seg
			 * mellom versjonene (valutakurs på et utenlandskjøp, eller tips), eller raden var en
			 * kansellert reservasjon som aldri ble noe. Er den nær null, dekker
			 * beløpsmatchingen hele fenomenet.
			 */
			disappearedWithoutMatch:
				disappeared.reduce((sum, d) => sum + Number(d.rows), 0) -
				superseded.reduce((sum, s) => sum + Number(s.pairs), 0)
		},

		// Spørsmål 6: foreldreløs reservasjon mot bokført rad UTEN merchant_key-kravet.
		// Dette er kroner drift-målingen aldri kunne se, og etter multiplisitetsmålingen
		// (2 av 1 125 bøtter med ekte gjentak) er beløpsmatching forsvarlig her.
		orphanMatches: orphanRows.map((m) => ({
			deltaDays: m.deltaDays,
			merchantKeyChanged: m.mkChanged,
			pairs: m.pairs,
			nok: Math.round(m.nok)
		})),
		/**
		 * Reservasjoner UTEN en ledig bokført motpart. Restposten, og den skal rapporteres:
		 * de er enten ekte ubokførte, eller beløpet endret seg mellom versjonene.
		 */
		orphansUnmatched: reservationResult.unmatched.length,
		/** Forbruk som telles to ganger i dag — det fixen fjerner fra forbrukstallet. */
		doubleCountedNok: Math.round(doubleCounted.spend),
		/**
		 * Inntekt som telles to ganger. Like duplisert, og skal deaktiveres på samme måte, men
		 * det er ikke forbruk — og en sammenblanding var nettopp feilen som tok tallet fra
		 * 154 703 til 258 117 kr.
		 */
		doubleCountedIncomeNok: Math.round(doubleCounted.income),
		/** Par delt på retning, så ingen kaller trenger å utlede det. */
		orphanPairs: {
			out: reservationResult.matches.filter((m) => m.direction === 'out').length,
			in: reservationResult.matches.filter((m) => m.direction === 'in').length
		},

		// «Ulike tall på ulike steder», tallfestet.
		stores: stores.map((s) => ({
			store: s.store,
			rows: Number(s.rows),
			spendNok: s.spend_nok === null ? 0 : Number(s.spend_nok)
		})),

		// «Summen var åpenbart for høy», tallfestet — med samme matching som flaten.
		internalTransfers: {
			pairs: internalTransferPairs,
			nok: internalTransferNok
		},

		notes: [
			'Kun lesing. Ingen SB1-kall, ingen skriving.',
			'first_seen_at identifiserer ett API-svar presist: hele synk-batchen settes inn i én INSERT, og NOW() er transaksjonstidspunktet.',
			'multiplicity er maks distinkte ID-er per (svar, status), ikke summen — begge statuser kan komme i samme batch.',
			'statuses[].unmapped = true betyr status_rank 0: statusen deltar ikke i GREATEST-løftet, og batch-kollapsens === BOOKED treffer den ikke.',
			'drift.samples er kandidatpar, ikke bekreftede sammenhenger. Tersklene skal leses av histogrammene, ikke velges.',
			'Er drift.stalledWithCandidate 0 fordi alle bøtter har samme toppstatus, gjelder ikke driftshypotesen for lagrede data — det er også et svar.',
			'drift-joinen prioriterer eksakt beløp foran nær dato. Første utgave gjorde det motsatt og mispairet flere kjøp hos samme merchant samme dag; les gamle uttrekk med det i mente.',
			'multiplicity er meningsløs for data synket før 2026-08-11: rå-tabellen ble til da skrevet POST batch-kollaps, så den kunne per konstruksjon aldri vise mer enn 1. Måling krever data synket etter at rå-strømmen ble gjort rå.',
			'lifecycle.fingerprintStableAcrossFetches er porten for hele livsløpsmålingen. raw_fingerprint inneholder externalTransactionId; minter SB1 en ny id per henting, får hver henting en ny rad, seen_count blir alltid 1, og «forsvunnet» betyr da ingenting.',
			'lifecycle.disappeared sammenligner last_seen_at mot det nyeste tidspunktet noen rad på SAMME konto+dato ble sett — ikke mot nå. En transaksjon slutter å bli hentet når den faller ut av synkvinduet, og det er en godartet grunn til at last_seen_at stopper.',
			'lifecycle.superseded matcher på BELØP alene, uten dato og uten beskrivelse. Det er trygt bare fordi forsvinningen alt har fastslått at raden ble erstattet — samme matching uten forsvinningskravet ville slått sammen to ekte kjøp på samme beløp.',
			'superseded[].merchantKeyChanged = true betyr at beskrivelsen endret seg mellom de to versjonene (f.eks. «SEK ICA NARA HAGA» → «ICA NARA HAGA»). Slike par er per konstruksjon usynlige for drift-målingen over, som krever samme merchant_key.'
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
