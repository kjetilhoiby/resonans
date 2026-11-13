/**
 * Rema 1000 (Æ) — rene regler for kvitteringssynken.
 *
 * API-et er Æ-appens eget, uoffisielt og dokumentert av tredjepart (se
 * `docs/changelog/2026-11-13-rema-kvitteringer.md`). Derfor er alt som leses
 * fra det validert felt for felt her, aldri spredd: et felt Rema legger til
 * eller døper om skal falle ut stille, ikke snike seg inn i basen.
 *
 * Ingen db, ingen nettverk — serverlaget i `$lib/server/integrations/rema*.ts`
 * henter og skriver.
 */

import { guessCategory, type GroceryCategory } from '$lib/domains/food/grocery';
import { osloDayKey } from '$lib/domain/oslo-time';

// ─── OAuth ────────────────────────────────────────────────────

/**
 * Æ-appens egen klient og redirect. Vi kan ikke registrere en egen klient hos
 * Rema, og redirecten er en side de eier (`ae-appen.appspot.com`) som sender
 * koden videre til `bella://authorize?code=…&state=…`. Koden må derfor limes
 * inn av brukeren — det finnes ingen callback vi kan ta imot.
 */
export const REMA_CLIENT_ID = 'android-251010';
export const REMA_REDIRECT_URI = 'https://ae-appen.appspot.com/redirect/redirect.html';
export const REMA_AUTHORIZE_URL = 'https://id.rema.no/authorization';
export const REMA_TOKEN_URL = 'https://id.rema.no/token';
export const REMA_SCOPE = 'all';

/**
 * Redirect-siden avviser en `state` som ikke er ren alfanumerisk
 * (`/^[a-zA-Z0-9]+$/`) og sender da `error=WrongState` til appen i stedet for
 * koden. En state med bindestrek (en UUID) ville altså aldri gitt en kode.
 */
export const REMA_STATE_PATTERN = /^[a-zA-Z0-9]+$/;

export function buildRemaAuthorizeUrl(params: { codeChallenge: string; state: string }): string {
	if (!REMA_STATE_PATTERN.test(params.state)) {
		throw new Error('state må være alfanumerisk — Remas redirect-side avviser alt annet');
	}
	const url = new URL(REMA_AUTHORIZE_URL);
	url.searchParams.set('client_id', REMA_CLIENT_ID);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('scope', REMA_SCOPE);
	url.searchParams.set('redirect_uri', REMA_REDIRECT_URI);
	url.searchParams.set('code_challenge', params.codeChallenge);
	url.searchParams.set('code_challenge_method', 'S256');
	url.searchParams.set('state', params.state);
	return url.toString();
}

export type ParsedRemaCallback =
	| { ok: true; code: string; state: string | null }
	| { ok: false; reason: string };

/**
 * Tolk det brukeren limer inn etter innloggingen.
 *
 * Tre former er gyldige, fordi det som står i adressefeltet avhenger av
 * nettleseren: hele appspot-adressen (`https://ae-appen.appspot.com/…?code=…`),
 * deep-linken den sendte videre til (`bella://authorize?code=…`), eller bare
 * koden. En `error` i adressen sies med Remas egne ord framfor «ugyldig kode».
 */
export function parseRemaCallbackInput(input: string): ParsedRemaCallback {
	const raw = input.trim();
	if (!raw) return { ok: false, reason: 'Lim inn adressen du havnet på etter innloggingen.' };

	if (raw.includes('?') || raw.includes('://')) {
		const query = raw.slice(raw.indexOf('?') + 1).split('#')[0];
		const params = new URLSearchParams(query);
		const error = params.get('error');
		if (error) {
			const description = params.get('error_description');
			return {
				ok: false,
				reason: `Rema avviste innloggingen: ${error}${description && description !== 'null' ? ` (${description})` : ''}`
			};
		}
		const code = params.get('code')?.trim();
		if (!code) return { ok: false, reason: 'Fant ingen kode i adressen.' };
		return { ok: true, code, state: params.get('state')?.trim() || null };
	}

	if (/\s/.test(raw)) return { ok: false, reason: 'Koden kan ikke inneholde mellomrom.' };
	return { ok: true, code: raw, state: null };
}

// ─── Kvitteringer ─────────────────────────────────────────────

export interface RemaTransactionHead {
	/** Transaksjons-id — nøkkelen for varelinjene, og vår `orderRef`. */
	id: string;
	purchasedAt: Date;
	/** Oslo-datoen kjøpet skjedde. */
	purchaseDay: string;
	storeId: string | null;
	storeName: string | null;
	amount: number | null;
	receiptNbr: string | null;
}

function finiteNumber(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim() !== '') {
		const n = Number(value.replace(',', '.'));
		return Number.isFinite(n) ? n : null;
	}
	return null;
}

function text(value: unknown): string | null {
	if (typeof value === 'number' && Number.isFinite(value)) return String(value);
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

/**
 * Transaksjons-id-en er et heltall på elleve sifre. Over 2^53 ville JSON.parse
 * allerede ha rundet den av, og to kvitteringer kunne fått samme nøkkel — da
 * avvises den heller enn å lagres med feil id.
 */
function transactionId(value: unknown): string | null {
	if (typeof value === 'number') {
		return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
	}
	if (typeof value === 'string' && /^\d+$/.test(value.trim())) return value.trim();
	return null;
}

/**
 * `GET /v1/bella/transaction/v2/heads` → kvitteringshoder.
 *
 * `purchaseDate` er epoch-MILLISEKUNDER. En verdi som leses som sekunder ville
 * lagt hele historikken i januar 1970, så verdier under år 2000 i ms avvises.
 */
export function parseTransactionHeads(payload: unknown): {
	heads: RemaTransactionHead[];
	rejected: number;
} {
	const list =
		payload && typeof payload === 'object' && Array.isArray((payload as { transactions?: unknown }).transactions)
			? ((payload as { transactions: unknown[] }).transactions)
			: Array.isArray(payload)
				? payload
				: null;
	if (!list) throw new Error('Uventet svar fra Rema: mangler transactions-lista');

	const MIN_MS = Date.UTC(2000, 0, 1);
	const heads: RemaTransactionHead[] = [];
	let rejected = 0;
	for (const item of list) {
		if (!item || typeof item !== 'object') {
			rejected++;
			continue;
		}
		const row = item as Record<string, unknown>;
		const id = transactionId(row.id);
		const ms = finiteNumber(row.purchaseDate);
		if (!id || ms == null || ms < MIN_MS) {
			rejected++;
			continue;
		}
		const purchasedAt = new Date(ms);
		heads.push({
			id,
			purchasedAt,
			purchaseDay: osloDayKey(purchasedAt),
			storeId: text(row.storeId),
			storeName: text(row.storeName),
			amount: finiteNumber(row.amount),
			receiptNbr: text(row.receiptNbr)
		});
	}
	return { heads, rejected };
}

/**
 * Hvilke kvitteringer skal hentes denne runden?
 *
 * Nyeste først, så en førstegangssynk av flere års historikk viser de ferske
 * kjøpene med en gang og fyller bakover over de neste kjøringene. Taket finnes
 * fordi hver kvittering er ett kall til (`rows`), og et ukjent API skal ikke få
 * hundrevis av kall i ett jafs.
 */
export function selectTransactionsToFetch(
	heads: RemaTransactionHead[],
	alreadyImported: ReadonlySet<string>,
	maxPerRun: number
): { toFetch: RemaTransactionHead[]; remaining: number } {
	const pending = heads
		.filter((h) => !alreadyImported.has(h.id))
		.sort((a, b) => b.purchasedAt.getTime() - a.purchasedAt.getTime());
	const toFetch = pending.slice(0, Math.max(0, maxPerRun));
	return { toFetch, remaining: pending.length - toFetch.length };
}

export interface RemaReceiptLine {
	name: string;
	/** EAN-13 — den stabile produktidentiteten på tvers av kvitteringer. */
	ean: string | null;
	productGroup: string | null;
	quantity: number | null;
	unitPrice: number | null;
	/** Linjebeløpet slik Rema oppgir det (`amount`), FØR rabatten trekkes. */
	totalPrice: number | null;
	/** Rabatt i kroner, positiv. null når linja ikke har noen. */
	discount: number | null;
	category: GroceryCategory;
}

const EAN_PATTERN = /^\d{8,14}$/;

/**
 * Antall regnes bare når det er ARITMETIKK, ikke en gjetning: et oppgitt
 * `quantity`, eller beløp delt på enhetspris når forholdet er et helt tall.
 * For vektvarer (1,234 kg) er forholdet ikke helt, og enheten er ukjent — da
 * står antallet tomt framfor å påstå «1,234 stk».
 */
function lineQuantity(row: Record<string, unknown>, unitPrice: number | null, amount: number | null) {
	const explicit = finiteNumber(row.quantity);
	if (explicit != null && explicit > 0) return explicit;
	if (unitPrice == null || amount == null || unitPrice <= 0 || amount <= 0) return null;
	const ratio = amount / unitPrice;
	const rounded = Math.round(ratio);
	return rounded >= 1 && Math.abs(ratio - rounded) < 0.005 ? rounded : null;
}

/**
 * Kategori fra Remas varegruppe først («Ost» → meieri), så fra varenavnet.
 * Varegruppa er det mest presise vi har; navnet på kvitteringen er forkortet
 * («NORVEGIA 1KG») og treffer nøkkelordene dårligere.
 */
function lineCategory(productGroup: string | null, name: string): GroceryCategory {
	if (productGroup) {
		const fromGroup = guessCategory(productGroup);
		if (fromGroup !== 'annet') return fromGroup;
	}
	return guessCategory(name);
}

function rowsList(payload: unknown): unknown[] | null {
	if (Array.isArray(payload)) return payload;
	if (payload && typeof payload === 'object' && Array.isArray((payload as { rows?: unknown }).rows)) {
		return (payload as { rows: unknown[] }).rows;
	}
	return null;
}

function sortedKeys(value: unknown): string[] {
	return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).sort() : [];
}

/**
 * Formen på varelinje-svaret, som FELTNAVN — aldri verdier. Kontrakten er lest
 * ut av en app og kan endre seg; det er navnene som avslører det. Første utgave
 * logget bare når svaret var en ren liste, og Rema pakker lista inn i et objekt,
 * så diagnosen var død fra første kjøring.
 */
export function describeRowsShape(payload: unknown): {
	/** Nøklene på toppnivå når lista er pakket inn, ellers null. */
	wrapperKeys: string[] | null;
	/** Nøklene på første varelinje. */
	rowKeys: string[];
} {
	const list = rowsList(payload);
	return {
		wrapperKeys: Array.isArray(payload) ? null : sortedKeys(payload),
		rowKeys: list ? sortedKeys(list[0]) : []
	};
}

/** `GET /v1/bella/transaction/v2/rows/{tid}` → varelinjer. */
export function parseTransactionRows(payload: unknown): {
	lines: RemaReceiptLine[];
	rejected: number;
	/**
	 * Feltnavnene (union) på linjene som ble avvist — så en avvist pantelinje
	 * eller rabattlinje med andre navn kan kjennes igjen uten å logge innholdet.
	 */
	rejectedFields: string[];
} {
	const list = rowsList(payload);
	if (!list) throw new Error('Uventet svar fra Rema: varelinjene er ikke en liste');
	const rejectedFields = new Set<string>();

	const lines: RemaReceiptLine[] = [];
	let rejected = 0;
	for (const item of list) {
		if (!item || typeof item !== 'object') {
			rejected++;
			continue;
		}
		const row = item as Record<string, unknown>;
		const name = text(row.productDescription) ?? text(row.prodtxt1);
		if (!name) {
			rejected++;
			for (const key of Object.keys(row)) rejectedFields.add(key);
			continue;
		}
		const unitPrice = finiteNumber(row.unitPrice);
		const amount = finiteNumber(row.amount);
		const discountRaw = finiteNumber(row.discount);
		const eanRaw = text(row.prodtxt3);
		const productGroup = text(row.productGroupDescription);
		lines.push({
			name,
			ean: eanRaw && EAN_PATTERN.test(eanRaw) ? eanRaw : null,
			productGroup,
			quantity: lineQuantity(row, unitPrice, amount),
			unitPrice,
			totalPrice: amount,
			discount: discountRaw != null && discountRaw !== 0 ? Math.abs(discountRaw) : null,
			category: lineCategory(productGroup, name)
		});
	}
	return { lines, rejected, rejectedFields: [...rejectedFields].sort() };
}
