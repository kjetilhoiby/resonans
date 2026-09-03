import { error, json } from '@sveltejs/kit';
import { db, rowsOf } from '$lib/db';
import { sql } from 'drizzle-orm';
import { requireAdmin } from '$lib/server/admin-auth';
import type { RequestHandler } from './$types';

/**
 * GET /api/admin/economics/samme-transaksjon?days=90
 *
 * **Deler SB1s beskrivelsesvarianter samme `externalTransactionId`?** Ren lesing.
 *
 * ## Spørsmålet
 *
 * Siden juni 2026 skriver SB1 samme transaksjon opptil tre ganger med ulike beskrivelser:
 *
 * ```
 * 2026-07-27   23 000,00   Overførsel
 * 2026-07-27   23 000,00   Fra: Anita Grønningsæter Digernes Betalt:
 * 2026-07-27   23 000,00   Avtale
 * ```
 *
 * Bøttenøkkelen kan ikke slå dem sammen: «Avtale» og «Overførsel» er generiske kategoriord som
 * ikke deler noe prefiks med navnet, så det finnes ingenting å strippe. `booked-duplicates`
 * krever prefiks-forhold og ser dem heller ikke.
 *
 * Men `raw_bank_transaction_versions` bærer `external_transaction_id` per variant. **Deler de
 * tre variantene én id, er de beviselig samme transaksjon** — og da er dedupen et faktum framfor
 * en heuristikk, altså sikrere enn alt annet i dette arbeidet.
 *
 * ## Hvorfor spørsmålet må stilles før fixen skrives
 *
 * De to utfallene krever helt ulike løsninger:
 *
 * - **Delt id** → dedup på id. Ingen terskler, ingen gjetning, ingen falske positive.
 * - **Ulike id-er** → SB1 mener det er tre transaksjoner, eller ID-ene roterer. Da må signalet
 *   være noe annet, og en dedup på (konto, dato, beløp) alene ville slått sammen tre ekte
 *   Ruter-billetter.
 *
 * Å bygge for det ene når det andre er sant er nøyaktig feilen som har kostet åtte runder her.
 *
 * ## Hva svaret betyr
 *
 * `sharedIdGroups` > 0 er beviset. `distinctIdGroups` er motsatsen. Begge rapporteres med
 * eksempler, siden et sammendrag uten rader ikke kan etterprøves.
 */

const DEFAULT_DAYS = 90;
const MAX_DAYS = 400;
const MAX_SAMPLES = 40;

type GroupRow = {
	account_id: string;
	transaction_date: string;
	amount: string;
	variant_count: number;
	distinct_descriptions: number;
	distinct_external_ids: number;
	null_external_ids: number;
	descriptions: string[];
	external_ids: string[];
};

export const GET: RequestHandler = async ({ locals, url }) => {
	await requireAdmin(locals.userId);

	const daysParam = Number(url.searchParams.get('days') ?? DEFAULT_DAYS);
	if (!Number.isFinite(daysParam) || daysParam < 1 || daysParam > MAX_DAYS) {
		error(400, `days må være mellom 1 og ${MAX_DAYS}.`);
	}
	const days = Math.floor(daysParam);

	// Grupper RÅ-versjoner på (konto, dato, beløp) og se på beskrivelsene og ID-ene i hver
	// gruppe. Rå-strømmen og ikke canonical, fordi det er der `external_transaction_id` per
	// variant finnes — canonical har bare én rad per bøtte.
	//
	// `rowsOf` er påkrevd: `db.execute()` typer resultatet løst, og det blinde
	// castet kallstedene brukte før kastet «is not iterable» i prod. Se
	// `$lib/db/result-shape.ts`.
	const groups = rowsOf<GroupRow>(
		await db.execute(sql`
			SELECT
				account_id,
				transaction_date::text AS transaction_date,
				amount::text AS amount,
				COUNT(*)::int AS variant_count,
				COUNT(DISTINCT description_normalized)::int AS distinct_descriptions,
				COUNT(DISTINCT external_transaction_id)::int AS distinct_external_ids,
				COUNT(*) FILTER (WHERE external_transaction_id IS NULL)::int AS null_external_ids,
				ARRAY_AGG(DISTINCT COALESCE(description_raw, description_normalized)) AS descriptions,
				ARRAY_AGG(DISTINCT COALESCE(external_transaction_id, '(null)')) AS external_ids
			FROM raw_bank_transaction_versions
			WHERE user_id = ${locals.userId}
				AND transaction_date >= CURRENT_DATE - ${days}::int
			GROUP BY account_id, transaction_date, amount
			-- Bare grupper der beskrivelsen faktisk varierer. Flere rader med SAMME beskrivelse
			-- er gjentatte kjøp eller en reservasjon som ble bokført, ikke dette fenomenet.
			HAVING COUNT(DISTINCT description_normalized) > 1
			ORDER BY ABS(amount::numeric) DESC
		`)
	);

	const shared = groups.filter((g) => g.distinct_external_ids === 1 && g.null_external_ids === 0);
	const distinct = groups.filter((g) => g.distinct_external_ids > 1);
	const missing = groups.filter((g) => g.null_external_ids > 0);

	return json({
		window: { days },
		groups: groups.length,
		/** **Beviset.** Variantene deler én bank-ID → samme transaksjon, uten tvil. */
		sharedIdGroups: shared.length,
		/** Motsatsen: hver variant har sin egen ID. Da må signalet være noe annet. */
		distinctIdGroups: distinct.length,
		/** Grupper der minst én variant mangler ID — da kan ID-en ikke være beviset. */
		missingIdGroups: missing.length,
		samples: {
			shared: groups.filter((g) => g.distinct_external_ids === 1).slice(0, MAX_SAMPLES).map(toSample),
			distinct: distinct.slice(0, MAX_SAMPLES).map(toSample)
		}
	});
};

function toSample(g: GroupRow) {
	return {
		date: g.transaction_date.slice(0, 10),
		amount: Number(g.amount),
		variants: g.variant_count,
		distinctDescriptions: g.distinct_descriptions,
		distinctExternalIds: g.distinct_external_ids,
		nullExternalIds: g.null_external_ids,
		descriptions: g.descriptions,
		externalIds: g.external_ids
	};
}
