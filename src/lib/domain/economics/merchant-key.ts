/**
 * Bøttenøkkelen for banktransaksjoner — den mest bærende funksjonen i hele importen.
 *
 * ## Hva den avgjør
 *
 * `canonical_bank_transactions` har unik nøkkel
 * `(sensor_id, account_id, canonical_date, amount, merchant_key)`, og `merchant_key` ER denne
 * funksjonens returverdi. Derfor: **to beskrivelser som normaliseres likt blir én rad; to som
 * ikke gjør det blir to.** Alt som teller kroner hviler på det.
 *
 * Fram til 18. august 2026 lå funksjonen privat og **utestet** inni `sparebank1-sync.ts`. Den
 * er flyttet hit fordi den er en beslutning, ikke plumbing, og fordi konsekvensen av å ta feil
 * er et beløp som telles to ganger — den feilen kostet en full tillitsgjennomgang av
 * økonomidomenet. Se `docs/changelog/2026-08-12-livslop-forsvinning.md`.
 *
 * ## Den strukturelle svakheten, sagt rett ut
 *
 * Nøkkelen er utledet av en **visningsstreng banken formaterer som den vil**. Endrer SB1
 * formatet, splittes ett kjøp i to rader, og ingenting varsler om det. Det skjedde 23. juni
 * 2026: banken begynte å skrive «DKK DANSK CAMPING UNION» ved siden av «DANSK CAMPING UNION»,
 * og 33 kjøp per 90 dager ble telt dobbelt.
 *
 * Beskrivelsen kan ikke bare fjernes fra nøkkelen: uten den kollapser to ekte Ruter-billetter
 * på 41 kr samme dag til én rad. Den er der for å skille gjentatte kjøp, og det er en reell
 * jobb. **Forsvaret er derfor å strippe det som er FORMAT, og beholde det som er identitet** —
 * pluss ryddejobben som sikkerhetsnett for format vi ennå ikke har sett.
 *
 * ## Reglene er ikke kosmetiske
 *
 * Butikkjedene trunkeres til kjede + sted («KIWI BØLERL BØLERLIA OSLO» → «KIWI BØLERL») fordi
 * SB1 skriver samme butikk med og uten gateadresse. `FRA:`/`TIL:`/`NETTGIRO`-prefiksene er
 * SB1s egne flertekst-varianter av samme betaling.
 *
 * **`TIL:` var glemt mens `FRA:` fantes**, og det er ikke en detalj: `Til: Påmelding for Kjetil
 * Høiby` og `Påmelding for Kjetil Høiby` lå som to rader på 2 000 kr, og jeg klassifiserte det
 * først som et personnavn-prefiks vi ikke kunne gjøre noe med. Det var et manglende motstykke
 * til en regel som alt fantes. En asymmetrisk regel ser komplett ut.
 */

/**
 * Valutakoder SB1 skriver foran beskrivelsen på utenlandskjøp.
 *
 * **Dette er stripping for å FOREBYGGE en dublett, ikke for å finne den.** Skillet er viktig
 * fordi changeloggen advarer mot en valutaliste — den advarselen gjaldt å *matche* duplikater,
 * der lista dekker tre av fire tilfeller og ser ut som en løsning. Her er den motsatt vei: en
 * kode som mangler i lista gir bare den gamle oppførselen (to rader), og ryddejobben tar den.
 * Lista kan altså aldri gjøre noe verre enn før den fantes.
 *
 * Sett, målt i prod: DKK, USD, SEK, EUR. Resten er nærliggende valutaer.
 */
const CURRENCY_CODES = new Set([
	'USD',
	'EUR',
	'SEK',
	'DKK',
	'GBP',
	'CHF',
	'PLN',
	'CZK',
	'ISK',
	'JPY',
	'CAD',
	'AUD',
	'THB',
	'TRY',
	'HUF',
	'RON',
	'BGN'
]);

/**
 * `02.07 ` foran beskrivelsen — SB1 skriver kjøpsdatoen på noen kortkjøp.
 *
 * Ankeret i begge ender er med vilje: uten `$` ville «02.07.2026 NOE» matchet delvis, og uten
 * `^` ville et beløp inni teksten kunne treffe.
 */
const DATE_TOKEN = /^\d{1,2}\.\d{1,2}\.?$/;

/**
 * Fjerner et ledende format-token som ikke er en del av butikkens identitet.
 *
 * Gjentas ikke i løkke: ett token er alt som er observert, og en løkke ville kunne spise et
 * ekte førsteord i en beskrivelse som tilfeldigvis ser ut som en dato.
 */
function stripFormatPrefix(compact: string): string {
	const spaceAt = compact.indexOf(' ');
	if (spaceAt <= 0) return compact;
	const head = compact.slice(0, spaceAt);
	const rest = compact.slice(spaceAt + 1).trim();
	// **En tom rest betyr at «prefikset» var hele teksten.** Da er det ikke et prefiks, det er
	// navnet, og å returnere '' ville slått alle slike rader sammen i én bøtte.
	if (!rest) return compact;
	if (CURRENCY_CODES.has(head) || DATE_TOKEN.test(head)) return rest;
	return compact;
}

/** Kjeder der SB1 skriver samme butikk med og uten gateadresse. */
const CHAIN_TRUNCATIONS: Array<{ prefix: string; words: number }> = [
	{ prefix: 'COOP MEGA ', words: 3 },
	{ prefix: 'COOP EXTRA ', words: 3 },
	{ prefix: 'COOP PRIX ', words: 3 },
	{ prefix: 'COOP OBS ', words: 3 },
	{ prefix: 'KIWI ', words: 2 },
	{ prefix: 'REMA ', words: 2 },
	{ prefix: 'MENY ', words: 2 },
	{ prefix: 'SPAR ', words: 2 },
	{ prefix: 'BUNNPRIS ', words: 2 },
	{ prefix: 'EXTRA ', words: 2 },
	{ prefix: 'JOKER ', words: 2 },
	{ prefix: 'NARVESEN ', words: 2 }
];

/**
 * Normaliser en transaksjonsbeskrivelse til bøttenøkkel.
 *
 * Rekkefølgen er betydningsfull: **format strippes FØR kjedereglene**, ellers ville
 * «DKK KIWI BØLERL BØLERLIA» ikke truffet `KIWI `-regelen og havnet i en egen bøtte.
 */
export function merchantKeyFromDescription(value: unknown): string {
	const raw = typeof value === 'string' ? value : '';
	const normalized = raw.normalize('NFKC').replace(/\s+/g, ' ').trim().toUpperCase();

	if (!normalized) return '';

	// Ordre-referanser til slutt («ODA.COM - A6UAFE») er unike per kjøp og må bort, ellers får
	// hvert kjøp sin egen bøtte.
	const withoutRef = normalized.replace(/\s+-\s+[A-Z0-9]{4,}$/g, '').trim();
	const compact = stripFormatPrefix(withoutRef);

	const words = compact.split(' ').filter(Boolean);
	const first = (count: number) => words.slice(0, Math.min(count, words.length)).join(' ');

	for (const { prefix, words: count } of CHAIN_TRUNCATIONS) {
		if (compact.startsWith(prefix)) return first(count);
	}

	if (compact.startsWith('ODA.COM')) return 'ODA.COM';
	if (compact.startsWith('ODA ')) return 'ODA';

	// **De navnløse formene FØRST.** Rekkefølgen er ikke stilistisk: `TIL: BETALT:` starter med
	// `TIL: `, så prefiksregelen under ville strippet den til «BETALT:» — en bøtte oppkalt etter
	// et formatord. Den feilen oppsto idet `TIL: ` ble lagt til, og testen fanget den.
	if (compact === 'TIL: BETALT:' || compact === 'FRA: BETALT:') return 'OVERØRSEL';
	if (compact.includes('MELLOM EGNE KONTI')) return 'OVERØRSEL';

	// SB1s flertekst-varianter av samme betaling: «Fra: X Betalt:» → «X».
	// **`TIL:` er med her fordi fraværet var en bug**, ikke et bevisst valg — se filhodet.
	for (const prefix of ['FRA: ', 'TIL: ']) {
		if (compact.startsWith(prefix)) {
			return stripPaidSuffix(compact.slice(prefix.length).trim()) || 'BETALING';
		}
	}

	if (compact.startsWith('NETTGIRO TIL: ') || compact.startsWith('NETTGIRO FRA: ')) {
		return stripPaidSuffix(compact.slice(14).trim()) || 'NETTGIRO';
	}

	return compact;
}

function stripPaidSuffix(text: string): string {
	return text.endsWith(' BETALT:') ? text.slice(0, -8).trim() : text;
}

/**
 * Bærer beskrivelsen et format-prefiks som bøttenøkkelen stripper bort?
 *
 * Brukes til å velge **visningstekst**: kollapser «USD OPENAI» og «OPENAI» til samme bøtte, skal
 * den rene teksten vises. Upserten foretrakk den LENGSTE ved lik status, og da ville
 * valutakoden vunnet — dårligere å lese, og dårligere for kategoriseringen, som leser
 * beskrivelsen.
 */
export function hasFormatPrefix(value: unknown): boolean {
	const raw = typeof value === 'string' ? value : '';
	const normalized = raw.normalize('NFKC').replace(/\s+/g, ' ').trim().toUpperCase();
	if (!normalized) return false;
	return stripFormatPrefix(normalized) !== normalized;
}
