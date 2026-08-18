/**
 * Duplikatdiagnosen — **lesing, aldri skriving.**
 *
 * ## Hvorfor den finnes
 *
 * Fram til 18. august 2026 var eneste vei til dette tallet en POST mot
 * `/api/admin/economics/deaktiver-reservasjoner?dryRun=true` — altså mot en SKRIVEjobb. I praksis
 * betydde det at brukeren måtte trykke en knapp i nettleseren, kopiere JSON og lime det inn, én
 * runde per hypotese, i et par døgn. Sju målinger av dette domenet har rettet sju feil, og hver
 * runde kostet håndarbeid som ikke ga innsikt i seg selv.
 *
 * Dette endepunktet er GET, rører ingen rader, og tar tersklene som parametere. Det gjør
 * **hypotesetesting til et kall framfor en deploy**: «hvor mange par finner vi hvis
 * beløpstoleransen er 5 % i stedet for 3?» er nå et spørsmål man kan stille, ikke et man må
 * bygge om koden for å svare på.
 *
 * ## Hvorfor tersklene er løsere enn ryddingens
 *
 * En diagnose som bruker samme grenser som fixen kan **per konstruksjon ikke finne noe fixen gikk
 * glipp av**. Det var nøyaktig feilen i drift-målingen: den joinet på samme `merchant_key` og
 * kunne derfor ikke se valutatilfellene — altså nettopp dem der beskrivelsen driftet.
 * Konklusjonen «bare datoen flytter seg» var trukket fra en populasjon som utelukket motbeviset.
 *
 * ## Hva svaret er delt inn etter, og hvorfor
 *
 * `byReason` sier hva som **stopper** paret; `byStatusPair` sier hvilken **mekanisme** det er.
 * De er ikke samme spørsmål: `pending+booked` er livsløpet ryddingen er bygget for, mens
 * `booked+booked` er noe annet — samme kjøp bokført to ganger med ulik beskrivelse. Uten den
 * andre inndelingen ville det dominerende tilfellet i prod sett ut som en terskel som var feil
 * satt.
 *
 * Se `docs/changelog/2026-08-12-livslop-forsvinning.md`.
 */

import {
	findResidualDuplicateSuspects,
	summarizeSkipReasons,
	type ResidualRow,
	type ResidualSuspect,
	type SkipReason
} from '$lib/domain/economics/residual-duplicates';
import { loadDuplicateCandidates } from './duplicate-candidates';

export type DuplicateDiagnosis = {
	window: { days: number; fromDate: string };
	thresholds: {
		maxDeltaDays: number;
		amountTolerancePct: number;
		requireDescriptionMatch: boolean;
	};
	rowsConsidered: number;
	/** Radene som er holdt utenfor, og på hvilket grunnlag. */
	excluded: { unknownStatus: number; pairedTransfers: number; textOnlyTransfers: number };
	pairs: number;
	/** Kroner som telles to ganger hvis alle parene er ekte. Konservativt: minste av hvert par. */
	nok: number;
	/** Hva som STOPPER paret. */
	byReason: Array<{ reason: SkipReason; pairs: number; nok: number }>;
	/** Hvilken MEKANISME paret er. Nøkkelen til om ryddingen i det hele tatt kan fange det. */
	byStatusPair: Array<{ statusPair: string; pairs: number; nok: number }>;
	suspects: Array<{
		amount: number;
		amountDeltaPct: number;
		deltaDays: number;
		prefixDrift: boolean;
		sameDescription: boolean;
		statusPair: string;
		reason: SkipReason;
		a: { id: string; date: string; description: string; status: string; amount: number };
		b: { id: string; date: string; description: string; status: string; amount: number };
	}>;
	/** Sann når lista er kappet av `limit`. En stille kapping ser ut som full dekning. */
	truncated: boolean;
};

/** Tak på returnerte par, så et bredt vindu ikke gir en payload ingen leser. */
export const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

export async function diagnoseDuplicates(
	userId: string,
	options: {
		days: number;
		maxDeltaDays?: number;
		amountTolerancePct?: number;
		requireDescriptionMatch?: boolean;
		limit?: number;
		/**
		 * Rader som skal holdes utenfor — brukes av ryddingen for å trekke fra parene den selv
		 * skal deaktivere. Ellers ville hvert ryddet par dukket opp som `skulle-blitt-fanget`, og
		 * tallet hadde svart på et annet spørsmål enn «hva står igjen?».
		 */
		excludeIds?: ReadonlySet<string>;
	}
): Promise<DuplicateDiagnosis> {
	const candidates = await loadDuplicateCandidates(userId, { days: options.days });
	const exclude = options.excludeIds ?? new Set<string>();

	const rows: ResidualRow[] = candidates.rows
		.filter((row) => !exclude.has(row.id))
		.map((row) => ({
			id: row.id,
			accountId: row.accountId,
			date: row.date,
			amount: row.amount,
			description: row.description,
			status: row.status,
			isInternalTransfer: row.internalTransfer
		}));

	const suspects = findResidualDuplicateSuspects(rows, {
		maxDeltaDays: options.maxDeltaDays,
		amountTolerancePct: options.amountTolerancePct,
		requireDescriptionMatch: options.requireDescriptionMatch
	});

	const limit = Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

	return {
		window: { days: options.days, fromDate: candidates.fromDate },
		thresholds: {
			// De faktiske verdiene, ikke de forespurte. Et ekko av inputen kan ikke skille «brukte
			// standarden» fra «leste parameteren», og da er svaret ikke etterprøvbart.
			maxDeltaDays: options.maxDeltaDays ?? 3,
			amountTolerancePct: options.amountTolerancePct ?? 3,
			requireDescriptionMatch: options.requireDescriptionMatch !== false
		},
		rowsConsidered: rows.length,
		excluded: {
			unknownStatus: candidates.counts.unknownStatus,
			pairedTransfers: candidates.counts.pairedTransfers,
			textOnlyTransfers: candidates.counts.textOnlyTransfers
		},
		pairs: suspects.length,
		nok: Math.round(suspects.reduce((sum, s) => sum + s.amountNok, 0)),
		byReason: summarizeSkipReasons(suspects),
		byStatusPair: summarizeByStatusPair(suspects),
		suspects: suspects.slice(0, limit).map((s) => ({
			amount: Math.round(s.amountNok),
			amountDeltaPct: s.amountDeltaPct,
			deltaDays: s.deltaDays,
			prefixDrift: s.prefixDrift,
			sameDescription: s.sameDescription,
			statusPair: s.statusPair,
			reason: s.reason,
			a: {
				id: s.a.id,
				date: s.a.date,
				description: s.a.description,
				status: s.a.status,
				amount: s.a.amount
			},
			b: {
				id: s.b.id,
				date: s.b.date,
				description: s.b.description,
				status: s.b.status,
				amount: s.b.amount
			}
		})),
		truncated: suspects.length > limit
	};
}

function summarizeByStatusPair(
	suspects: readonly ResidualSuspect[]
): DuplicateDiagnosis['byStatusPair'] {
	const map = new Map<string, { pairs: number; nok: number }>();
	for (const suspect of suspects) {
		const entry = map.get(suspect.statusPair) ?? { pairs: 0, nok: 0 };
		entry.pairs += 1;
		entry.nok += suspect.amountNok;
		map.set(suspect.statusPair, entry);
	}
	return [...map.entries()]
		.map(([statusPair, v]) => ({ statusPair, pairs: v.pairs, nok: Math.round(v.nok) }))
		.sort((x, y) => y.nok - x.nok);
}
