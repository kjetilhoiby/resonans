/**
 * Interne overføringer — penger som flyttes mellom brukerens egne kontoer.
 *
 * Målt mot prod 2026-08-11: **68 % av «forbruket» var interne overføringer** (1 084 033 kr
 * av 1 583 723). Ingen lesesti ekskluderte dem, så en overføring til egen sparekonto ble
 * telt som en utgift — og siden den er negativ på én konto og positiv på en annen, blåste
 * den opp forbruk og inntekt samtidig. Se
 * `docs/changelog/2026-08-11-okonomi-tillitsgjennomgang.md`.
 *
 * **De merkes, de fjernes ikke.** De er gale som *forbruk* og helt riktige som
 * *sparebevegelse*: et uttak fra sparekontoen til brukskontoen er nettopp en intern
 * overføring, og det er signalet man trenger for å se om bufferen eroderes. Samme rader,
 * to spørsmål. En ren filtrering ville tatt fra sparefunksjonen datagrunnlaget sitt.
 */

/** Det matchingen trenger å vite om en transaksjon. */
export type TransferCandidate = {
	/** Stabil id, brukes bare til å peke tilbake på raden. */
	id: string;
	accountId: string;
	/** YYYY-MM-DD. Interne overføringer bokføres samme dag på begge sider. */
	date: string;
	/** Negativ = ut av kontoen. */
	amount: number;
};

export type InternalTransferLink = {
	/** Raden som ga penger fra seg (negativt beløp). */
	outId: string;
	/** Raden som mottok dem (positivt beløp). */
	inId: string;
	outAccountId: string;
	inAccountId: string;
	date: string;
	/** Alltid positivt — beløpet som ble flyttet. */
	amount: number;
};

export type InternalTransferResult = {
	links: InternalTransferLink[];
	/** id → motkontoen, for begge sidene. Slår opp uten å gå gjennom `links`. */
	counterAccountById: Map<string, string>;
	/** Alle id-er som er del av en intern overføring. */
	internalIds: Set<string>;
};

/** Øre, for å unngå at 0.1 + 0.2 gjør to like beløp ulike. */
function toCents(amount: number): number {
	return Math.round(amount * 100);
}

/**
 * Finner par der samme beløp forlater én konto og ankommer en annen samme dag.
 *
 * **Én-til-én.** Hver rad kan inngå i høyst ett par. Uten det ville tre overføringer på
 * 500 kr fra samme konto samme dag alle pekt på det samme innskuddet, og summen av
 * «interne overføringer» blitt tre ganger for stor — nøyaktig feilen diagnose-joinen gjorde
 * før den ble rettet. Måling uten dette overdriver, så tallet ville sett verre ut enn det er.
 *
 * **Samme dag, ikke et vindu.** Begge sidene av en intern overføring bokføres på samme
 * dato; et vindu ville begynt å matche ekte betalinger til andre mennesker som tilfeldigvis
 * har samme beløp noen dager unna.
 *
 * **Samme konto matcher ikke seg selv** (`outAccountId !== inAccountId`). En konto som får
 * og gir samme beløp samme dag er to reelle transaksjoner, ikke en flytting.
 */
export function findInternalTransfers(
	candidates: readonly TransferCandidate[]
): InternalTransferResult {
	const links: InternalTransferLink[] = [];
	const counterAccountById = new Map<string, string>();
	const internalIds = new Set<string>();

	// Innskudd gruppert på (dato, beløp i øre) → køen av kandidater som kan motta.
	const inboundByKey = new Map<string, TransferCandidate[]>();
	for (const candidate of candidates) {
		if (candidate.amount <= 0) continue;
		const key = `${candidate.date}:${toCents(candidate.amount)}`;
		const bucket = inboundByKey.get(key);
		if (bucket) bucket.push(candidate);
		else inboundByKey.set(key, [candidate]);
	}

	// Deterministisk rekkefølge: uten den kan to kjøringer på samme data parre ulikt,
	// og da er ikke totalen reproduserbar.
	const outbound = candidates
		.filter((c) => c.amount < 0)
		.slice()
		.sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date)));

	for (const out of outbound) {
		const key = `${out.date}:${toCents(-out.amount)}`;
		const bucket = inboundByKey.get(key);
		if (!bucket) continue;

		const matchIndex = bucket.findIndex((inbound) => inbound.accountId !== out.accountId);
		if (matchIndex === -1) continue;

		const [match] = bucket.splice(matchIndex, 1);

		links.push({
			outId: out.id,
			inId: match.id,
			outAccountId: out.accountId,
			inAccountId: match.accountId,
			date: out.date,
			amount: Math.abs(out.amount)
		});

		counterAccountById.set(out.id, match.accountId);
		counterAccountById.set(match.id, out.accountId);
		internalIds.add(out.id);
		internalIds.add(match.id);
	}

	return { links, counterAccountById, internalIds };
}

/**
 * Netto bevegelse inn og ut av én konto gjennom interne overføringer.
 *
 * Dette er inngangen sparefunksjonen trenger: `out` er uttakene fra bufferen — antall og
 * størrelse — og `in` er påfyllingen. Frekvensen er `out.length`, ikke summen: ett uttak
 * til en bilreparasjon og tolv små uttak sent i måneden gir samme sum og betyr helt ulike
 * ting.
 */
export function internalTransfersForAccount(
	result: InternalTransferResult,
	accountId: string
): { withdrawals: InternalTransferLink[]; deposits: InternalTransferLink[]; net: number } {
	const withdrawals = result.links.filter((link) => link.outAccountId === accountId);
	const deposits = result.links.filter((link) => link.inAccountId === accountId);
	const net =
		deposits.reduce((sum, link) => sum + link.amount, 0) -
		withdrawals.reduce((sum, link) => sum + link.amount, 0);
	return { withdrawals, deposits, net };
}
