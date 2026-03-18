/**
 * Parser for SpareBank 1 kontoutskrift PDF files.
 *
 * SpareBank 1 statements have a tabular format:
 *   Dato       Beskrivelse           Rentedato    Ut fra konto  Inn på konto   Saldo
 *   15.01.2025 LØNN FIRMA AS         15.01.2025                  52 000,00     64 345,00
 *   20.01.2025 REMA*1000 OSLO        20.01.2025    1 234,00                    63 111,00
 *
 * After pdf-parse text extraction the layout is flattened to plain text.
 * We detect lines that start with DD.MM.YYYY and extract numbers from them.
 * Transaction sign is inferred from the running balance change.
 */

// Norwegian number format: "1 234,56" → 1234.56
function parseNorwNum(s: string): number {
	return parseFloat(s.replace(/\s/g, '').replace(',', '.'));
}

// "15.01.2025" → Date (midnight UTC)
function parseNorwDate(s: string): Date {
	const [d, m, y] = s.split('.');
	return new Date(`${y}-${m}-${d}T00:00:00.000Z`);
}

// Normalise account number to 11 digits (strip spaces, dots, spaces)
export function normaliseAccountNumber(raw: string): string {
	return raw.replace(/[\s.]/g, '');
}

export interface PdfTransaction {
	date: Date;
	description: string;
	/** Positive = inn på konto, negative = ut fra konto */
	amount: number;
	balance: number;
}

export interface ParsedStatement {
	/** Raw account number from the PDF (may include dots/spaces) */
	rawAccountNumber: string;
	/** Normalised 11-digit number */
	accountNumber: string;
	/** "Inngående saldo" value if found */
	openingBalance: number | null;
	transactions: PdfTransaction[];
	/** All balance snapshots: one per transaction + opening/closing anchors */
	balanceSnapshots: { date: Date; balance: number }[];
}

// Regex pieces
const DATE_PAT = '\\d{2}\\.\\d{2}\\.\\d{4}';
const NORW_NUM = '\\d{1,3}(?:\\s\\d{3})*,\\d{2}';
const DATE_RE = new RegExp(DATE_PAT, 'g');
const NUM_RE = new RegExp(NORW_NUM, 'g');

/**
 * Parse the plain text output of pdf-parse into structured transactions.
 */
export function parseSparebank1Text(text: string): ParsedStatement {
	const lines = text.split(/\r?\n/);

	// ── Find account number ──────────────────────────────────────────────────
	let rawAccountNumber = '';
	for (const line of lines) {
		// Patterns: "1234.56.78901", "1234 56 78901", "12345678901"
		const m = line.match(/(\d{4}[\s.]\d{2}[\s.]\d{5})|(?<!\d)(\d{11})(?!\d)/);
		if (m) {
			rawAccountNumber = (m[1] || m[2] || '').trim();
			break;
		}
	}
	const accountNumber = normaliseAccountNumber(rawAccountNumber);

	// ── Parse transaction lines ──────────────────────────────────────────────
	const transactions: PdfTransaction[] = [];
	const balanceSnapshots: { date: Date; balance: number }[] = [];
	let openingBalance: number | null = null;
	let prevBalance: number | null = null;

	for (const rawLine of lines) {
		const line = rawLine.trimEnd();
		if (!line.match(/^\s*\d{2}\.\d{2}\.\d{4}/)) continue;

		// Find all dates in this line
		const dateMatches = [...line.matchAll(new RegExp(DATE_PAT, 'g'))];
		if (dateMatches.length === 0) continue;

		const bookingDate = parseNorwDate(dateMatches[0][0]);
		const bookingDateEnd = (dateMatches[0].index ?? 0) + 10;

		// Find all Norwegian-format numbers in the line
		const numMatches = [...line.matchAll(new RegExp(NORW_NUM, 'g'))];
		if (numMatches.length === 0) continue;

		const balance = parseNorwNum(numMatches[numMatches.length - 1][0]);

		// Description: text between booking date and the first number
		// Skip an optional value date (rentedato) that appears before the numbers
		const firstNumIdx = numMatches[0].index ?? line.length;
		let descEnd = firstNumIdx;
		if (dateMatches.length >= 2) {
			const valDateIdx = dateMatches[1].index ?? line.length;
			if (valDateIdx < firstNumIdx) descEnd = valDateIdx;
		}
		const description = line.substring(bookingDateEnd, descEnd).trim();

		// Opening / closing balance lines (no actual transaction)
		const descLower = description.toLowerCase();
		const isAnchorOnly =
			descLower.includes('inngående saldo') ||
			descLower.includes('inngaende saldo') ||
			descLower.includes('utgående saldo') ||
			descLower.includes('utgaende saldo') ||
			numMatches.length < 2;

		if (isAnchorOnly) {
			if (descLower.includes('inngående') || descLower.includes('inngaende')) {
				openingBalance = balance;
			}
			balanceSnapshots.push({ date: bookingDate, balance });
			prevBalance = balance;
			continue;
		}

		// Amount: second-to-last number
		const amount = parseNorwNum(numMatches[numMatches.length - 2][0]);

		// Sign: infer from balance change vs previous balance
		let signedAmount: number;
		if (prevBalance !== null) {
			const delta = balance - prevBalance;
			// Allow ±1 cent rounding tolerance
			const roundedDelta = Math.round(Math.abs(delta) * 100);
			const roundedAmount = Math.round(amount * 100);
			if (Math.abs(roundedDelta - roundedAmount) <= 1) {
				signedAmount = delta >= 0 ? amount : -amount;
			} else {
				// Delta doesn't match — fall back to sign of delta
				signedAmount = delta >= 0 ? amount : -amount;
			}
		} else {
			// No previous balance yet — can't determine sign reliably.
			// Store as positive; caller can re-evaluate after full parse.
			signedAmount = amount;
		}

		transactions.push({ date: bookingDate, description, amount: signedAmount, balance });
		balanceSnapshots.push({ date: bookingDate, balance });
		prevBalance = balance;
	}

	return { rawAccountNumber, accountNumber, openingBalance, transactions, balanceSnapshots };
}
