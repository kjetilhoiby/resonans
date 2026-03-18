/**
 * Parser for SpareBank 1 kontoutskrift PDF files.
 *
 * Uses pdfjs-dist directly to get x,y coordinates for every text item,
 * allowing us to detect which column (Ut fra konto / Inn på konto / Saldo)
 * each number belongs to — no sign inference from balance changes needed.
 *
 * Column layout:
 *   Dato  │ Beskrivelse │ Rentedato │ Ut fra konto │ Inn på konto │ Saldo
 *
 * Column boundaries are auto-detected from the header row on each PDF.
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

export function normaliseAccountNumber(raw: string): string {
	return raw.replace(/[\s.]/g, '');
}

function parseNorwNum(s: string): number {
	return parseFloat(s.replace(/\s/g, '').replace(',', '.'));
}

function parseNorwDate(s: string): Date | null {
	const m = s.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
	if (!m) return null;
	return new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00.000Z`);
}

function isNorwNum(s: string): boolean {
	return /^\d[\d\s]*,\d{2}$/.test(s.trim());
}

function isDate(s: string): boolean {
	return /^\d{2}\.\d{2}\.\d{4}$/.test(s.trim());
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface PdfTransaction {
	date: Date;
	description: string;
	/** Positive = inn på konto, negative = ut fra konto */
	amount: number;
	balance: number;
}

export interface ParsedStatement {
	rawAccountNumber: string;
	accountNumber: string;
	openingBalance: number | null;
	transactions: PdfTransaction[];
	balanceSnapshots: { date: Date; balance: number }[];
}

// ── Internal types ────────────────────────────────────────────────────────────

interface TextItem { x: number; y: number; text: string }
type Row = TextItem[];
interface ColBounds { utX: number; innX: number; saldoX: number }

// ── pdfjs-dist extraction ─────────────────────────────────────────────────────

/** Extract all text items (with x,y coords) from a PDF buffer via pdfjs-dist */
async function extractItems(buf: Buffer): Promise<TextItem[]> {
	// pdfjs-dist needs DOMMatrix which doesn't exist in Node.js — polyfill it
	if (typeof (globalThis as any).DOMMatrix === 'undefined') {
		(globalThis as any).DOMMatrix = class DOMMatrix {
			a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
			m11 = 1; m12 = 0; m13 = 0; m14 = 0;
			m21 = 0; m22 = 1; m23 = 0; m24 = 0;
			m31 = 0; m32 = 0; m33 = 1; m34 = 0;
			m41 = 0; m42 = 0; m43 = 0; m44 = 1;
			constructor(init?: string | number[]) {
				if (Array.isArray(init) && init.length >= 6) {
					this.a = init[0]; this.b = init[1];
					this.c = init[2]; this.d = init[3];
					this.e = init[4]; this.f = init[5];
					this.m11 = this.a; this.m12 = this.b;
					this.m21 = this.c; this.m22 = this.d;
					this.m41 = this.e; this.m42 = this.f;
				}
			}
		};
	}

	// pdfjs-dist is an ESM package — dynamic import
	const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs' as string);

	const doc = await pdfjs.getDocument({
		data: new Uint8Array(buf),
		isEvalSupported: false,
		useSystemFonts: true,
	}).promise;

	const items: TextItem[] = [];
	for (let p = 1; p <= doc.numPages; p++) {
		const page = await doc.getPage(p);
		const content = await page.getTextContent();
		const height = page.getViewport({ scale: 1 }).height;

		for (const item of content.items) {
			if (!('str' in item)) continue;
			const str = (item as any).str as string;
			if (!str.trim()) continue;
			const tx = (item as any).transform as number[];
			// PDF origin is bottom-left — flip y so row 0 = top of page
			items.push({ x: tx[4], y: height - tx[5], text: str.trim() });
		}
	}
	return items;
}

// ── Row grouping ──────────────────────────────────────────────────────────────

/** Round y to nearest 2 pts so items on the same visual line share a key */
function rowKey(y: number): number {
	return Math.round(y / 2) * 2;
}

function groupRows(items: TextItem[]): Row[] {
	const map = new Map<number, TextItem[]>();
	for (const item of items) {
		const k = rowKey(item.y);
		if (!map.has(k)) map.set(k, []);
		map.get(k)!.push(item);
	}
	return [...map.values()]
		.map((row) => row.sort((a, b) => a.x - b.x))
		.sort((a, b) => a[0].y - b[0].y);
}

// ── Column detection ──────────────────────────────────────────────────────────

/**
 * Find the x-positions of the Ut, Inn, and Saldo columns from the header row.
 * The header is the first row that contains the word "saldo".
 */
function detectColBounds(rows: Row[]): ColBounds | null {
	for (const row of rows) {
		const lower = row.map((i) => i.text.toLowerCase());
		if (!lower.includes('saldo')) continue;

		const utIdx    = lower.findIndex((t) => t === 'ut' || t.startsWith('ut fra'));
		const innIdx   = lower.findIndex((t) => t === 'inn' || t.startsWith('inn på') || t.startsWith('inn pa'));
		const saldoIdx = lower.indexOf('saldo');

		if (utIdx === -1 || innIdx === -1 || saldoIdx === -1) continue;

		return { utX: row[utIdx].x, innX: row[innIdx].x, saldoX: row[saldoIdx].x };
	}
	return null;
}

function classifyX(x: number, b: ColBounds): 'ut' | 'inn' | 'saldo' | 'other' {
	if (x < b.utX - 5) return 'other';
	const utMid   = (b.utX + b.innX) / 2;
	const innMid  = (b.innX + b.saldoX) / 2;
	if (x < utMid)  return 'ut';
	if (x < innMid) return 'inn';
	return 'saldo';
}

// ── Row parsing ───────────────────────────────────────────────────────────────

function parseRows(rows: Row[], bounds: ColBounds) {
	const transactions: PdfTransaction[] = [];
	const balanceSnapshots: { date: Date; balance: number }[] = [];
	let openingBalance: number | null = null;
	let rawAccountNumber = '';

	for (const row of rows) {
		// Account number detection (any row)
		if (!rawAccountNumber) {
			const joined = row.map((i) => i.text).join(' ');
			const m = joined.match(/(\d{4}[\s.]\d{2}[\s.]\d{5})|(?<!\d)(\d{11})(?!\d)/);
			if (m) rawAccountNumber = (m[1] || m[2]).trim();
		}

		const bookingDate = parseNorwDate(row[0]?.text ?? '');
		if (!bookingDate) continue;

		// Classify each number in the row by column
		const ut: number[] = [], inn: number[] = [], saldo: number[] = [];
		for (const item of row) {
			if (!isNorwNum(item.text)) continue;
			const val = parseNorwNum(item.text);
			const col = classifyX(item.x, bounds);
			if      (col === 'ut')    ut.push(val);
			else if (col === 'inn')   inn.push(val);
			else if (col === 'saldo') saldo.push(val);
		}

		if (saldo.length === 0) continue;
		const balance = saldo[saldo.length - 1];

		// Description: non-date, non-number items left of the Ut column
		const description = row
			.filter((item, idx) =>
				idx > 0 &&
				!isNorwNum(item.text) &&
				!isDate(item.text) &&
				item.x < bounds.utX)
			.map((i) => i.text)
			.join(' ')
			.trim();

		const descLower = description.toLowerCase();
		const isAnchor = ut.length === 0 && inn.length === 0;

		if (isAnchor) {
			if (descLower.includes('inngående') || descLower.includes('inngaende')) {
				openingBalance = balance;
			}
			balanceSnapshots.push({ date: bookingDate, balance });
			continue;
		}

		// Sign is authoritative from column — no guessing needed
		let amount: number;
		if (inn.length > 0) {
			amount = inn[inn.length - 1];      // positive
		} else {
			amount = -(ut[ut.length - 1]);     // negative
		}

		transactions.push({ date: bookingDate, description, amount, balance });
		balanceSnapshots.push({ date: bookingDate, balance });
	}

	return { transactions, balanceSnapshots, openingBalance, rawAccountNumber };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Parse a SpareBank 1 PDF buffer into structured transactions + balance anchors.
 * Returns an empty statement (with a warning hint) if the header row can't be
 * found — the caller should log a warning for that file.
 */
export async function parseSparebank1Pdf(buf: Buffer): Promise<ParsedStatement> {
	const items = await extractItems(buf);
	const rows  = groupRows(items);
	const bounds = detectColBounds(rows);

	if (!bounds) {
		return { rawAccountNumber: '', accountNumber: '', openingBalance: null,
		         transactions: [], balanceSnapshots: [] };
	}

	const { transactions, balanceSnapshots, openingBalance, rawAccountNumber } =
		parseRows(rows, bounds);

	return {
		rawAccountNumber,
		accountNumber: normaliseAccountNumber(rawAccountNumber),
		openingBalance,
		transactions,
		balanceSnapshots,
	};
}
