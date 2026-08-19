/**
 * Avstemming mot saldo — det eneste tallet som ikke kan diskuteres.
 *
 * ## Hvorfor dette er siste utvei, og den riktige
 *
 * Åtte runder i dette domenet har handlet om å avgjøre om to rader er samme transaksjon ut fra
 * **teksten**. Hver gang har svaret vært en heuristikk med en terskel, og fire ganger har
 * terskelen tatt feil. Siden juni 2026 skriver SB1 dessuten samme overføring med helt ulike ord:
 *
 * ```
 * 2026-07-23   27 000,00   Avtale
 * 2026-07-23   27 000,00   Regninger
 * 2026-07-23   27 000,00   Regninger Betalt:
 * ```
 *
 * `Avtale` og `Regninger` deler ingenting. Ingen prefiksregel, ingen valutaliste og ingen
 * beløpstoleranse kan slå dem sammen — og bankens `externalTransactionId` kan heller ikke:
 * **målt i prod har 222 av 222 slike grupper ULIKE id-er**, fordi SB1 roterer id ved hver synk
 * (11 rå-rader, 11 id-er, 3 beskrivelser).
 *
 * Men **saldoen vet.** Beveget kontoen seg 27 000 og vi har bokført 81 000, teller vi for mye —
 * og det er en observasjon, ikke en tolkning. Avviket sier ikke *hvilke* rader som er duplikater,
 * men det sier **om** vi teller for mye og **hvor mye**, og det er nok til å slutte å gjette.
 *
 * ## Hva funksjonen ikke later som
 *
 * **Transaksjoner på ankerdagen er tvetydige.** En saldo observert 31. juli kl. 03 kommer før et
 * kjøp senere samme dag, men `canonical_date` har bare dagsoppløsning. De telles derfor for seg
 * i `boundaryAmount` framfor å legges inn i summen og se presise ut. Et avvik mindre enn
 * grensebeløpet er ikke et funn.
 *
 * Se `docs/changelog/2026-08-18-avstemming-mot-saldo.md`.
 */

export type BalanceAnchor = {
	/** YYYY-MM-DD */
	date: string;
	balance: number;
};

export type ReconTx = {
	/** YYYY-MM-DD */
	date: string;
	/** Negativ = ut av kontoen. */
	amount: number;
};

export type ReconciliationInterval = {
	fromDate: string;
	toDate: string;
	fromBalance: number;
	toBalance: number;
	/** Faktisk saldoendring — sannheten. */
	balanceChange: number;
	/** Summen av transaksjoner vi har bokført i intervallet, ankerdagen unntatt. */
	transactionSum: number;
	/** `transactionSum − balanceChange`. Positivt = vi teller MER inn enn kontoen fikk. */
	diff: number;
	/**
	 * Beløpet på ankerdagene, som kan ligge på hver sin side av observasjonen.
	 *
	 * **Usikkerheten, tallfestet.** Er `|diff|` mindre enn dette, forklarer grensetilfellene
	 * avviket og det er ikke et funn.
	 *
	 * Behandlingen er bevisst ASYMMETRISK: en transaksjon på STARTdagen er allerede med i
	 * `fromBalance` og holdes utenfor summen — den er ikke usikker, den er forrige intervalls
	 * ansvar. Bare SLUTTdagen telles her.
	 *
	 * **TETTHETSFELLA, og den gjorde første måling ubrukelig.** Er ankerne daglige, er hvert
	 * intervall én dag — og da ligger ALLE transaksjonene på sluttdagen. `boundaryAmount` blir
	 * hele volumet, `significant` blir aldri sann, og svaret «ingen avvik» er en egenskap ved
	 * målingen framfor ved dataene. Målt i prod: 29 intervaller over 30 dager ga 0 avvik mens
	 * to aktive lønnsrader på 54 685 kr sto på samme dato.
	 *
	 * Kalleren må derfor velge ankere som er GROVERE enn transaksjonenes oppløsning — månedlig
	 * er riktig når datoen har dagsoppløsning. Da er grenseusikkerheten én dag av tretti.
	 */
	boundaryAmount: number;
	/** Sann når avviket er større enn grenseusikkerheten — altså et reelt avvik. */
	significant: boolean;
	txCount: number;
	/**
	 * Andel av volumet som ligger på sluttdagen, 0–1.
	 *
	 * **Nær 1 betyr at intervallet ikke kan avstemmes** — hele volumet er grenseusikkert, og
	 * «ingen avvik» sier da ingenting. Rapporteres fordi en umålbar periode ellers ser ut som
	 * en periode der alt stemmer, som er den feilen dette dokumentet er full av.
	 */
	boundaryShare: number;
};

/**
 * Terskel for «reelt avvik», i tillegg til grensebeløpet.
 *
 * Renter og gebyrer bokføres ikke alltid som transaksjoner vi ser, så små avvik er normale.
 * 50 kr er lavt nok til å fange et dobbelttalt kjøp og høyt nok til å slippe gjennom en
 * renteberegning.
 */
export const RECON_TOLERANCE_NOK = 50;

/**
 * Stemmer transaksjonene med saldoendringen mellom hvert par av ankere?
 *
 * `anchors` er saldoobservasjoner; funksjonen sorterer selv og bruker **påfølgende par**.
 * Overlappende intervaller ville tellt samme transaksjon flere ganger, som er samme
 * mange-til-mange-feil som har truffet dette domenet to ganger før.
 */
export function reconcileBalances(
	anchors: readonly BalanceAnchor[],
	txs: readonly ReconTx[],
	options: { toleranceNok?: number } = {}
): ReconciliationInterval[] {
	const tolerance = options.toleranceNok ?? RECON_TOLERANCE_NOK;

	// Ett anker per dag — den siste observasjonen vinner. To observasjoner samme dag ville gitt
	// et intervall på 0 dager og et meningsløst avvik.
	const byDate = new Map<string, number>();
	for (const anchor of anchors) {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor.date)) continue;
		if (!Number.isFinite(anchor.balance)) continue;
		byDate.set(anchor.date, anchor.balance);
	}
	const sorted = [...byDate.entries()]
		.map(([date, balance]) => ({ date, balance }))
		.sort((a, b) => a.date.localeCompare(b.date));

	const intervals: ReconciliationInterval[] = [];
	for (let i = 1; i < sorted.length; i += 1) {
		const from = sorted[i - 1];
		const to = sorted[i];

		let transactionSum = 0;
		let boundaryAmount = 0;
		let txCount = 0;
		// Totalt volum i intervallet inkludert sluttdagen — nevneren i `boundaryShare`.
		let volume = 0;
		for (const tx of txs) {
			// `> from.date` og `<= to.date`. Asymmetrien er tilsiktet: startdagen ligger alt i
			// `fromBalance`, sluttdagen gjør det som regel også når saldoen leses. Begge
			// ankerdagene telles i `boundaryAmount` slik at usikkerheten er synlig uansett.
			// **Bare SLUTTdagen er tvetydig.** Transaksjoner på startdagen er ekskludert fra
			// summen og hører til forrige intervall — de er ikke usikre, de er et annet
			// intervalls ansvar. Første utgave tok med begge, og da ble usikkerheten dobbelt så
			// stor som den er.
			if (tx.date === to.date) {
				boundaryAmount += Math.abs(tx.amount);
			}
			if (tx.date <= from.date || tx.date > to.date) continue;
			transactionSum += tx.amount;
			volume += Math.abs(tx.amount);
			txCount += 1;
		}

		const balanceChange = to.balance - from.balance;
		const diff = transactionSum - balanceChange;

		intervals.push({
			fromDate: from.date,
			toDate: to.date,
			fromBalance: from.balance,
			toBalance: to.balance,
			balanceChange: round2(balanceChange),
			transactionSum: round2(transactionSum),
			diff: round2(diff),
			boundaryAmount: round2(boundaryAmount),
			// **Begge vilkårene må til.** Grensebeløpet forklarer avvik på ankerdagene, og
			// toleransen dekker renter og gebyrer vi ikke ser som transaksjoner.
			significant: Math.abs(diff) > boundaryAmount + tolerance,
			txCount,
			boundaryShare: volume === 0 ? 0 : Math.round((boundaryAmount / volume) * 1000) / 1000
		});
	}

	return intervals;
}

/** Sum av avvikene som er reelle. Det er dette tallet som sier «vi teller X for mye». */
export function significantDiffTotal(intervals: readonly ReconciliationInterval[]): number {
	return round2(
		intervals.filter((i) => i.significant).reduce((sum, i) => sum + i.diff, 0)
	);
}

function round2(value: number): number {
	return Math.round(value * 100) / 100;
}
