/**
 * Samme kjøp bokført TO ganger — en annen mekanisme enn reservasjon→bokføring.
 *
 * ## Målingen som avslørte den
 *
 * Ryddingen i `reservation-matching.ts` krever at én side er PENDING: den er bygget for livsløpet
 * reservasjon → bokføring. Etter at 242 slike par var ryddet, sto 54 duplikater igjen i prod, og
 * `GET /api/admin/economics/duplikater` viste hvorfor:
 *
 * | Statuspar | Par | Kroner |
 * |---|---:|---:|
 * | `booked+booked` | 52 | 20 087 |
 * | `booked+pending` | 1 | 1 703 |
 * | `pending+pending` | 1 | 62 |
 *
 * **Livsløpet ryddingen er bygget for sto for ETT av 54 par.** Restposten er noe annet: SB1 skriver
 * samme bokførte kjøp to ganger, med ulik beskrivelse. Prefiksene i vinduet, utrunkert:
 *
 * ```
 * 11x dkk    4x eur              1x 02.07   1x håvard wormdal høiby
 * 11x usd    4x 'betaling av'    1x 07.06   1x lars terje husbyn
 *  7x sek                                   1x per inge øye hansen
 *                                           1x marie helene nygaard
 * ```
 *
 * ## Hvorfor en valutaliste er riktig HER, men gal i matchingen
 *
 * Changeloggen sier «ikke bygg en `normalizeTxDescription` som stripper valutakoder» — den ville
 * dekket tre av fire tilfeller og sett ut som en løsning. **Det gjelder fortsatt, og det er et
 * annet spørsmål.** Der handlet lista om å FINNE par; her om hvor sikker man er nok til å SKRIVE.
 * Å finne skal være bredt (`hasPrefixDrift` er blind for hva prefikset er), å skrive skal være
 * smalt. Lista brukes derfor bare til å gradere tillit, aldri til å oppdage.
 *
 * ## Hva som skiller et duplikat fra et gjentatt kjøp
 *
 * Dette er hele risikoen, og den er ikke teoretisk. De samme radene inneholder:
 *
 * - `Ruter` 41 kr to ganger, 2 og 3 dager fra hverandre → to trikkebilletter
 * - `KIWI BØLERL` 335 kr, 3 dager fra hverandre → to butikkturer
 * - `Småsparing stk avrunding` 41 kr ×2 → en avrundingsfunksjon som fyrer gjentatte ganger
 *
 * Alle har **identisk** beskrivelse. Et gjentatt kjøp produserer nøyaktig den signaturen, og
 * ingenting i radene kan skille det fra et duplikat. Derfor krever denne modulen at
 * beskrivelsene er ULIKE — at én er den andre med et prefiks foran — og at datoen er den
 * **samme**. To rader med samme beløp, samme dag, der bare én bærer «USD», er banken som skriver
 * samme hendelse to ganger; det er ikke to kjøp.
 *
 * Datoen er beviset som gjør prefiksfamilien trygg: abonnementene i vinduet (`OPENAI`,
 * `CLAUDE SUB`, `NEON.TECH`, `The New York Times`, `Google Workspace`) ligger på elleve
 * forskjellige datoer med nøyaktig to rader hver. Et månedsabonnement kan ikke belastes to ganger
 * samme dag til samme øre.
 *
 * Se `docs/changelog/2026-08-12-livslop-forsvinning.md`.
 */

/**
 * Valutakoder som er sett som prefiks, pluss de nærliggende.
 *
 * **Ikke en fasit, og ikke brukt til å finne par** — bare til å gradere tillit. En kode som mangler
 * gir `other`, altså et par som rapporteres men ikke skrives. Retningen er konservativ.
 */
export const CURRENCY_PREFIXES = new Set([
	'usd',
	'eur',
	'sek',
	'dkk',
	'gbp',
	'chf',
	'pln',
	'czk',
	'isk',
	'jpy',
	'cad',
	'aud',
	'thb',
	'try',
	'huf',
	'hrk',
	'bgn',
	'ron'
]);

/** `02.07 ` foran beskrivelsen — SB1 skriver kjøpsdatoen på noen kortkjøp. */
const DATE_PREFIX = /^\d{1,2}\.\d{1,2}\.?$/;

export type PrefixKind = 'currency' | 'date' | 'other';

export type BookedDuplicateRow = {
	id: string;
	accountId: string;
	/** YYYY-MM-DD */
	date: string;
	/** Negativ = ut av kontoen. Sammenlignes EKSAKT. */
	amount: number;
	description: string;
	status: 'pending' | 'booked' | 'unknown';
	/** Valutaen canonical lagret. Uavhengig bekreftelse på at prefikset ER en valutakode. */
	currency?: string | null;
	isInternalTransfer?: boolean;
};

export type BookedDuplicatePair = {
	/** Raden som skal deaktiveres — den MED prefikset. Se `pickRedundant`. */
	redundantId: string;
	/** Raden som beholdes. */
	keptId: string;
	amount: number;
	date: string;
	/** Prefikset som skiller de to, normalisert og uten mellomrom rundt. */
	prefix: string;
	prefixKind: PrefixKind;
	/**
	 * `high` skrives; `medium` rapporteres bare.
	 *
	 * Valuta- og datoprefiks er **mekaniske** — banken formaterer samme hendelse på to måter.
	 * Et personnavn er ikke: `Marie Helene Nygaard is` mot `is` KAN være to betalinger for is.
	 */
	confidence: 'high' | 'medium';
	redundantDescription: string;
	keptDescription: string;
	/** Sann når canonical-raden selv bærer en utenlandsk valuta. */
	currencyConfirms: boolean;
};

function normalize(text: string): string {
	return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Prefikset som skiller to beskrivelser, eller null når den ene ikke er den andre med noe foran.
 *
 * Krever et **ordskille**: uten det ville «NORDEA» og «EA» gitt prefikset «NORD», altså to
 * urelaterte betalinger paret på en tilfeldig delstreng.
 */
export function extractPrefix(a: string, b: string): { prefix: string; longer: string } | null {
	const x = normalize(a);
	const y = normalize(b);
	if (!x || !y || x === y) return null;
	const [shorter, longer] = x.length <= y.length ? [x, y] : [y, x];
	if (!longer.endsWith(shorter) || longer.length <= shorter.length) return null;
	const prefix = longer.slice(0, longer.length - shorter.length);
	// Prefikset må slutte på mellomrom — ellers er «shorter» bare en ordslutt inni «longer».
	if (!/\s$/.test(prefix)) return null;
	const trimmed = prefix.trim();
	if (!trimmed) return null;
	return { prefix: trimmed, longer };
}

export function classifyPrefix(prefix: string): PrefixKind {
	const value = prefix.trim().toLowerCase();
	if (CURRENCY_PREFIXES.has(value)) return 'currency';
	if (DATE_PREFIX.test(value)) return 'date';
	return 'other';
}

function dayDiff(fromKey: string, toKey: string): number {
	const from = new Date(`${fromKey}T12:00:00Z`).getTime();
	const to = new Date(`${toKey}T12:00:00Z`).getTime();
	return Math.round((to - from) / 86400000);
}

/**
 * Finner bokførte duplikatpar. **Én-til-én**: en beholdt rad kan bare absorbere ett duplikat.
 *
 * Uten det ville tre `USD OPENAI`-rader på samme beløp og dag alle pekt på den samme plain-raden,
 * og to ekte kjøp blitt slettet. Det er samme feil som LATERAL-joinen og
 * overføringstellingen gjorde, to ganger hver, i dette arbeidet.
 */
export function findBookedDuplicates(
	rows: readonly BookedDuplicateRow[]
): BookedDuplicatePair[] {
	// Sorteringen er deterministisk, ellers avhenger hvilken rad som beholdes av radrekkefølgen
	// fra basen — og da kan to kjøringer gi ulikt resultat på samme data.
	const sorted = [...rows].sort((x, y) =>
		x.date === y.date ? x.id.localeCompare(y.id) : x.date.localeCompare(y.date)
	);

	const used = new Set<string>();
	const pairs: BookedDuplicatePair[] = [];

	for (let i = 0; i < sorted.length; i += 1) {
		const a = sorted[i];
		if (used.has(a.id)) continue;
		// Begge sider MÅ være bokført. En PENDING-side hører til reservasjonsryddingen, og to
		// motorer som begge kan deaktivere samme rad ville konkurrert om den.
		if (a.status !== 'booked' || a.isInternalTransfer) continue;

		for (let j = i + 1; j < sorted.length; j += 1) {
			const b = sorted[j];
			if (used.has(b.id)) continue;
			if (b.status !== 'booked' || b.isInternalTransfer) continue;
			if (b.accountId !== a.accountId) continue;
			// **Samme dag.** Dette er vakten mot gjentatte kjøp, og den er ikke justerbar med
			// vilje: en dags slakk slipper inn to Ruter-billetter.
			if (dayDiff(a.date, b.date) !== 0) continue;
			// **Eksakt beløp.** Et avvik er valutakurs, altså reservasjon→bokføring — som er den
			// andre motorens jobb.
			if (a.amount !== b.amount) continue;

			const extracted = extractPrefix(a.description, b.description);
			if (!extracted) continue;

			const prefixKind = classifyPrefix(extracted.prefix);
			const redundantIsA = normalize(a.description) === extracted.longer;
			const redundant = redundantIsA ? a : b;
			const kept = redundantIsA ? b : a;

			used.add(a.id);
			used.add(b.id);
			pairs.push({
				redundantId: redundant.id,
				keptId: kept.id,
				amount: Math.abs(a.amount),
				date: a.date,
				prefix: extracted.prefix,
				prefixKind,
				confidence: prefixKind === 'other' ? 'medium' : 'high',
				redundantDescription: redundant.description,
				keptDescription: kept.description,
				currencyConfirms: isForeignCurrency(redundant) || isForeignCurrency(kept)
			});
			break;
		}
	}

	return pairs.sort((x, y) => y.amount - x.amount);
}

function isForeignCurrency(row: BookedDuplicateRow): boolean {
	const currency = (row.currency ?? '').trim().toUpperCase();
	return currency !== '' && currency !== 'NOK';
}

/**
 * Hvilken rad som fjernes: **den med prefikset.**
 *
 * Ikke arbitrært. `merchant_key` er utledet av beskrivelsen, så `USD OPENAI` kategoriserer
 * dårligere enn `OPENAI` — koden er ikke en del av butikknavnet. Å beholde den rene raden
 * rydder altså i kategoriseringen som en bieffekt.
 */
export function pickRedundant(pair: BookedDuplicatePair): string {
	return pair.redundantId;
}

export function summarizeBookedDuplicates(pairs: readonly BookedDuplicatePair[]): Array<{
	prefixKind: PrefixKind;
	confidence: 'high' | 'medium';
	pairs: number;
	nok: number;
}> {
	const map = new Map<string, { prefixKind: PrefixKind; confidence: 'high' | 'medium'; pairs: number; nok: number }>();
	for (const pair of pairs) {
		const key = `${pair.prefixKind}|${pair.confidence}`;
		const entry =
			map.get(key) ?? { prefixKind: pair.prefixKind, confidence: pair.confidence, pairs: 0, nok: 0 };
		entry.pairs += 1;
		entry.nok += pair.amount;
		map.set(key, entry);
	}
	return [...map.values()]
		.map((v) => ({ ...v, nok: Math.round(v.nok) }))
		.sort((x, y) => y.nok - x.nok);
}
