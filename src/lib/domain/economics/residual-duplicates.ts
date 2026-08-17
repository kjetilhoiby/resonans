/**
 * Duplikater som ryddingen IKKE fanget — og hvorfor.
 *
 * Brukeren trykket «Deaktiver», 242 par ble ryddet, og likevel sto disse igjen i
 * transaksjonslista:
 *
 * | Rad A | Rad B | Vist beløp | Dato |
 * |---|---|---:|---|
 * | `DKK OERESUNDSLINJEN HOER` | `OERESUNDSLINJEN HOER` | 729 kr | 2.8. |
 * | `USD OPENAI CHATGPT SUBSCR` | `OPENAI CHATGPT SUBSCR` | 244 kr | 2.8. |
 * | `SEK TYCHO BRAHE` | `TYCHO BRAHE` | 236 kr | 2.8. |
 * | `Lars Terje Husbyn FPL-fee Tollgaarden` | `FPL-fee Tollgaarden` | 250 kr | 13.8. |
 *
 * **Denne modulen gjetter ikke på årsaken, den leser den av radene.** Det er hele poenget:
 * gjennom dette arbeidet har jeg seks ganger forklart en observasjon med en mekanisme jeg ikke
 * hadde målt, og hver gang tok jeg feil. Se
 * `docs/changelog/2026-08-12-livslop-forsvinning.md`.
 *
 * To hypoteser den skiller mellom:
 *
 * 1. **Begge radene er bokført.** `matchReservationsToBooked` krever at én side er PENDING. Er
 *    begge BOOKED, dannes det ikke noe par uansett hvor like de er.
 * 2. **Beløpene er ikke eksakt like.** Lista viser avrundede kroner. Et utenlandskjøp kan
 *    reserveres til 728,63 og bokføres til 729,14 fordi valutakursen endret seg. Matchingen
 *    krever eksakt likhet.
 *
 * Hypotese 2 er ikke tatt ut av lufta: drift-målingen konkluderte at «beløpet er identisk, bare
 * datoen flytter seg», men den joinet på samme `merchant_key` og kunne derfor **per
 * konstruksjon ikke se valutatilfellene** — nettopp dem der beløpet ville driftet. Konklusjonen
 * var trukket fra en populasjon som utelukket motbeviset.
 */

/** Beløpsavvik i prosent som fortsatt regnes som «samme kjøp». Bare til DIAGNOSE. */
export const SUSPECT_AMOUNT_TOLERANCE_PCT = 3;

/** Dagers avstand som fortsatt regnes som samme kjøp. Bare til diagnose. */
export const SUSPECT_MAX_DELTA_DAYS = 3;

export type ResidualRow = {
	id: string;
	accountId: string;
	/** YYYY-MM-DD */
	date: string;
	/** Negativ = ut av kontoen. Eksakt beløp, ikke avrundet. */
	amount: number;
	description: string;
	status: 'pending' | 'booked' | 'unknown';
	isInternalTransfer?: boolean;
};

/**
 * Hvorfor ryddingen hoppet over paret. **Rekkefølgen er prioritert etter hva som er verdt å
 * handle på**, ikke etter hvor sannsynlig det er.
 */
export type SkipReason =
	/** Begge sider bokført — matchingen krever en PENDING-side. */
	| 'begge-bokfort'
	/** Beløpene er ulike. Sannsynligvis valutakurs. */
	| 'ulikt-belop'
	/** Én side har ukjent status og deltar ikke. */
	| 'ukjent-status'
	/** Én side er merket intern overføring og holdes utenfor. */
	| 'overforing'
	/** Paret ER matchbart — hvis det står igjen, har ryddingen ikke kjørt på det. */
	| 'skulle-blitt-fanget';

export type ResidualSuspect = {
	a: ResidualRow;
	b: ResidualRow;
	/** Kroner som telles to ganger hvis paret er ekte. Minste av de to, konservativt. */
	amountNok: number;
	/** Avvik i prosent mellom de to beløpene. 0 = eksakt likt. */
	amountDeltaPct: number;
	deltaDays: number;
	/** Sann når én beskrivelse er den andre med noe foran — valutakode eller navn. */
	prefixDrift: boolean;
	reason: SkipReason;
};

function normalize(text: string): string {
	return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Er den ene beskrivelsen den andre med et prefiks foran?
 *
 * Dekker både `DKK OERESUNDSLINJEN` mot `OERESUNDSLINJEN` og
 * `Lars Terje Husbyn FPL-fee Tollgaarden` mot `FPL-fee Tollgaarden`. **Prefikset kan være hva
 * som helst** — en valutakode eller et personnavn — så vi sjekker suffiks-forhold framfor å
 * lete etter kjente koder. En liste over valutakoder ville dekket tre av fire tilfeller og sett
 * ut som en løsning.
 */
export function hasPrefixDrift(a: string, b: string): boolean {
	const x = normalize(a);
	const y = normalize(b);
	if (!x || !y || x === y) return false;
	const [shorter, longer] = x.length <= y.length ? [x, y] : [y, x];
	return longer.endsWith(shorter) && longer.length > shorter.length;
}

function dayDiff(fromKey: string, toKey: string): number {
	const from = new Date(`${fromKey}T12:00:00Z`).getTime();
	const to = new Date(`${toKey}T12:00:00Z`).getTime();
	return Math.round((to - from) / 86400000);
}

function classify(a: ResidualRow, b: ResidualRow, amountDeltaPct: number): SkipReason {
	if (a.isInternalTransfer || b.isInternalTransfer) return 'overforing';
	if (a.status === 'unknown' || b.status === 'unknown') return 'ukjent-status';
	if (a.status === 'booked' && b.status === 'booked') return 'begge-bokfort';
	if (amountDeltaPct !== 0) return 'ulikt-belop';
	return 'skulle-blitt-fanget';
}

/**
 * Finner par som SER ut som duplikater men ikke ble ryddet, med årsaken lest av radene.
 *
 * Toleransene er løsere enn ryddingens med vilje: dette er et diagnoseverktøy som skal vise
 * hva ryddingen gikk glipp av, og en diagnose som bruker samme terskler som fixen kan per
 * konstruksjon ikke finne noe fixen ikke fant. Det var feilen i drift-målingen.
 *
 * **Én-til-én**, av samme grunn som ellers: uten det ville tre like rader gitt tre par.
 */
export function findResidualDuplicateSuspects(
	rows: readonly ResidualRow[],
	options: { maxDeltaDays?: number; amountTolerancePct?: number } = {}
): ResidualSuspect[] {
	const maxDeltaDays = options.maxDeltaDays ?? SUSPECT_MAX_DELTA_DAYS;
	const tolerance = options.amountTolerancePct ?? SUSPECT_AMOUNT_TOLERANCE_PCT;

	const sorted = [...rows].sort((x, y) =>
		x.date === y.date ? x.id.localeCompare(y.id) : x.date.localeCompare(y.date)
	);

	const used = new Set<string>();
	const suspects: ResidualSuspect[] = [];

	for (let i = 0; i < sorted.length; i += 1) {
		const a = sorted[i];
		if (used.has(a.id)) continue;

		for (let j = i + 1; j < sorted.length; j += 1) {
			const b = sorted[j];
			if (used.has(b.id)) continue;
			if (b.accountId !== a.accountId) continue;
			// Samme fortegn: en utbetaling og et innskudd er ikke to versjoner av samme ting.
			if (Math.sign(a.amount) !== Math.sign(b.amount)) continue;

			const delta = dayDiff(a.date, b.date);
			if (Math.abs(delta) > maxDeltaDays) continue;

			const base = Math.max(Math.abs(a.amount), Math.abs(b.amount));
			if (base === 0) continue;
			const deltaPct = (Math.abs(Math.abs(a.amount) - Math.abs(b.amount)) / base) * 100;
			if (deltaPct > tolerance) continue;

			// Beskrivelsen må peke på at det er samme kjøp. Uten dette kravet ville to ekte
			// Kiwi-kjøp på nesten samme beløp blitt rapportert som mistenkelige.
			const prefixDrift = hasPrefixDrift(a.description, b.description);
			const sameDescription = normalize(a.description) === normalize(b.description);
			if (!prefixDrift && !sameDescription) continue;

			used.add(a.id);
			used.add(b.id);
			suspects.push({
				a,
				b,
				amountNok: Math.min(Math.abs(a.amount), Math.abs(b.amount)),
				amountDeltaPct: Math.round(deltaPct * 100) / 100,
				deltaDays: delta,
				prefixDrift,
				reason: classify(a, b, Math.round(deltaPct * 100) / 100)
			});
			break;
		}
	}

	return suspects.sort((x, y) => y.amountNok - x.amountNok);
}

/** Antall og kroner per årsak — svaret på «hva står det egentlig igjen på». */
export function summarizeSkipReasons(
	suspects: readonly ResidualSuspect[]
): Array<{ reason: SkipReason; pairs: number; nok: number }> {
	const byReason = new Map<SkipReason, { pairs: number; nok: number }>();
	for (const suspect of suspects) {
		const entry = byReason.get(suspect.reason) ?? { pairs: 0, nok: 0 };
		entry.pairs += 1;
		entry.nok += suspect.amountNok;
		byReason.set(suspect.reason, entry);
	}
	return [...byReason.entries()]
		.map(([reason, v]) => ({ reason, pairs: v.pairs, nok: Math.round(v.nok) }))
		.sort((x, y) => y.nok - x.nok);
}
