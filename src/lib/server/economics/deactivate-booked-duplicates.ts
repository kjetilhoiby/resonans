/**
 * Deaktiver den ene av to bokføringer av samme kjøp.
 *
 * Beslutningene bor rent og testet i `$lib/domain/economics/booked-duplicates.ts` — her er bare
 * lesing, skriving og rapportering.
 *
 * **Egen motor, ikke en utvidelse av reservasjonsryddingen.** De to har ulike vakter: den andre
 * krever en PENDING-side og tåler datodrift på ±3 dager fordi livsløpet flytter datoen; denne
 * krever at BEGGE er bokført og at datoen er den **samme**, fordi det er det eneste som skiller et
 * duplikat fra et gjentatt kjøp. Slått sammen ville den løseste vakten gjeldt for begge, og to
 * Ruter-billetter blitt ett kjøp.
 *
 * **`confidence: 'high'` er standard.** Valuta- og datoprefiks er mekaniske. Et personnavn er det
 * ikke — `Marie Helene Nygaard is` mot `is` kan være to betalinger for is — så de rapporteres og
 * skrives ikke uten at kalleren ber om det.
 *
 * Se `docs/changelog/2026-08-12-livslop-forsvinning.md`.
 */

import { db } from '$lib/db';
import { canonicalBankTransactions } from '$lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import {
	findBookedDuplicates,
	summarizeBookedDuplicates,
	type BookedDuplicatePair,
	type BookedDuplicateRow
} from '$lib/domain/economics/booked-duplicates';
import { loadDuplicateCandidates } from './duplicate-candidates';

const UPDATE_CHUNK = 200;
const MAX_SAMPLES = 50;

export type BookedDuplicateResult = {
	dryRun: boolean;
	/** Tillitsnivået som ville blitt skrevet. */
	confidence: 'high' | 'all';
	window: { days: number; fromDate: string };
	rowsConsidered: number;
	/** Alle par som ble FUNNET, uansett tillit. */
	pairsFound: number;
	/** Par innenfor valgt tillit — de som ville blitt skrevet. */
	selectedPairs: number;
	/** Kroner som forsvinner fra forbruket ved valgt tillit. */
	selectedNok: number;
	byPrefix: ReturnType<typeof summarizeBookedDuplicates>;
	/**
	 * Par der canonical-raden selv bærer en utenlandsk valuta.
	 *
	 * Uavhengig bekreftelse på at prefikset ER en valutakode og ikke en del av butikknavnet.
	 * Står tallet på 0 mens `byPrefix` viser valutaprefikser, er `currency`-kolonnen ikke fylt —
	 * og da hviler graderingen på ordlista alene.
	 */
	currencyConfirmed: number;
	/** Rader som faktisk fikk `is_active = false`. 0 ved dry-run. */
	deactivated: number;
	samples: Array<{
		amount: number;
		date: string;
		prefix: string;
		prefixKind: string;
		confidence: string;
		currencyConfirms: boolean;
		removes: string;
		keeps: string;
	}>;
};

export async function deactivateBookedDuplicates(
	userId: string,
	options: { days: number; dryRun?: boolean; confidence?: 'high' | 'all' }
): Promise<BookedDuplicateResult> {
	const dryRun = options.dryRun !== false;
	const confidence = options.confidence ?? 'high';

	// Samme laster som ryddingen og diagnosen. Statusnormaliseringen og overføringsvakten er
	// kalibrering, ikke plumbing — tre kopier ville svart på tre litt ulike spørsmål.
	const loaded = await loadDuplicateCandidates(userId, { days: options.days });

	const rows: BookedDuplicateRow[] = loaded.rows.map((row) => ({
		id: row.id,
		accountId: row.accountId,
		date: row.date,
		amount: row.amount,
		description: row.description,
		status: row.status,
		currency: row.currency,
		isInternalTransfer: row.internalTransfer
	}));

	const pairs = findBookedDuplicates(rows);
	const selected =
		confidence === 'all' ? pairs : pairs.filter((pair) => pair.confidence === 'high');

	let deactivated = 0;
	if (!dryRun && selected.length > 0) {
		const ids = selected.map((pair) => pair.redundantId);
		for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
			const chunk = ids.slice(i, i + UPDATE_CHUNK);
			const updated = await db
				.update(canonicalBankTransactions)
				.set({ isActive: false, updatedAt: new Date() })
				.where(
					and(
						eq(canonicalBankTransactions.userId, userId),
						inArray(canonicalBankTransactions.id, chunk),
						// Fortsatt aktiv. Uten dette kunne to samtidige kjøringer tellt samme rad to
						// ganger i `deactivated`.
						eq(canonicalBankTransactions.isActive, true)
					)
				)
				.returning({ id: canonicalBankTransactions.id });
			deactivated += updated.length;
		}
		console.log(
			`[deactivate-booked-duplicates] user=${userId} days=${options.days} confidence=${confidence} selected=${selected.length} deactivated=${deactivated} nok=${Math.round(sumNok(selected))}`
		);
	}

	return {
		dryRun,
		confidence,
		window: { days: options.days, fromDate: loaded.fromDate },
		rowsConsidered: loaded.counts.rowsConsidered,
		pairsFound: pairs.length,
		selectedPairs: selected.length,
		selectedNok: Math.round(sumNok(selected)),
		byPrefix: summarizeBookedDuplicates(pairs),
		currencyConfirmed: pairs.filter((pair) => pair.currencyConfirms).length,
		deactivated,
		samples: pairs.slice(0, MAX_SAMPLES).map((pair) => ({
			amount: Math.round(pair.amount),
			date: pair.date,
			prefix: pair.prefix,
			prefixKind: pair.prefixKind,
			confidence: pair.confidence,
			currencyConfirms: pair.currencyConfirms,
			removes: pair.redundantDescription,
			keeps: pair.keptDescription
		}))
	};
}

function sumNok(pairs: readonly BookedDuplicatePair[]): number {
	return pairs.reduce((sum, pair) => sum + pair.amount, 0);
}
