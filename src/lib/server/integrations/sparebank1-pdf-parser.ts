/**
 * Parser for SpareBank 1 kontoutskrift PDF files.
 *
 * Uses pdf-parse@2 getText() — no worker, no coordinate magic needed.
 *
 * The primary goal is to extract balance ANCHORS:
 *   "Saldo frå kontoutskrift DD.MM.YYYY  XX.XXX,XX"   ← opening balance
 *   "Overført til neste side  XX.XXX,XX"               ← page-end running balance
 *   "Utgående saldo / saldo pr. DD.MM.YYYY  XX.XXX,XX" ← closing balance
 *
 * These give buildDailyBalances() concrete anchor points rather than
 * having to reconstruct everything from current-balance minus transactions.
 *
 * Transactions are also imported (mostly useful for description/category),
 * with sign inferred from sequential balance-change logic.
 *
 * Text format (flat, columns lost):
 *   Forklaring      Rentedato   Ut av konto   Inn på konto   Bokført
 *   Lønn Fra: X     2501        46.603,75                    2501
 *   *9951 …         0201        276,30                       0201
 */

export function normaliseAccountNumber(raw: string): string {
	return raw.replace(/[\s.]/g, '');
}

export interface PdfTransaction {
	date: Date;
	description: string;
	/** Positive = inn på konto, negative = ut fra konto */
	amount: number;
	/** Running balance AFTER this transaction (if known) */
	balance?: number;
}

export interface ParsedStatement {
	rawAccountNumber: string;
	accountNumber: string;
	/** Period start/end from statement header */
	periodStart: Date | null;
	periodEnd: Date | null;
	openingBalance: number | null;
	openingBalanceDate: Date | null;
	closingBalance: number | null;
	closingBalanceDate: Date | null;
	transactions: PdfTransaction[];
	/** All reliable balance snapshots — these are the anchors */
	balanceSnapshots: { date: Date; balance: number }[];
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function parseNorwNum(s: string): number {
	return parseFloat(s.trim().replace(/\s/g, '').replace(',', '.'));
}

function norw(s: string): boolean {
	return /^\d[\d\s]*,\d{2}$/.test(s.trim());
}

function parseFullDate(s: string): Date | null {
	const m = s.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
	if (!m) return null;
	return new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00.000Z`);
}

/** "DDMM" + year → Date */
function parseDDMM(ddmm: string, year: number): Date | null {
	const m = ddmm.match(/^(\d{2})(\d{2})$/);
	if (!m) return null;
	const d = m[1].padStart(2, '0');
	const mo = m[2].padStart(2, '0');
	return new Date(`${year}-${mo}-${d}T00:00:00.000Z`);
}

// ── Main parser ───────────────────────────────────────────────────────────────

export function parseSparebank1Text(text: string): ParsedStatement {
	const lines = text.split(/\r?\n/).map(l => l.trimEnd());

	let rawAccountNumber = '';
	let periodStart: Date | null = null;
	let periodEnd: Date | null = null;
	let openingBalance: number | null = null;
	let openingBalanceDate: Date | null = null;
	let closingBalance: number | null = null;
	let closingBalanceDate: Date | null = null;
	const balanceSnapshots: { date: Date; balance: number }[] = [];
	const transactions: PdfTransaction[] = [];

	// ── First pass: header / anchor lines ─────────────────────────────────────
	for (const line of lines) {
		// Account number: "konto 3991.09.84652" or 11-digit sequence
		if (!rawAccountNumber) {
			const m = line.match(/konto\s+(\d{4}[.\s]\d{2}[.\s]\d{5})/i)
				?? line.match(/(?<!\d)(\d{4}[.\s]\d{2}[.\s]\d{5})(?!\d)/);
			if (m) rawAccountNumber = m[1].trim();
		}

		// Period: "i perioden DD.MM.YYYY - DD.MM.YYYY"
		if (!periodStart) {
			const m = line.match(/perioden\s+(\d{2}\.\d{2}\.\d{4})\s*[-–]\s*(\d{2}\.\d{2}\.\d{4})/i);
			if (m) {
				periodStart = parseFullDate(m[1]);
				periodEnd   = parseFullDate(m[2]);
			}
		}

		// Opening balance: "Saldo frå kontoutskrift DD.MM.YYYY  X.XXX,XX"
		// or "Inngående saldo DD.MM.YYYY  X.XXX,XX"
		{
			const m = line.match(/(?:saldo fr[åa] kontoutskrift|inng[åa]ende saldo)\s+(\d{2}\.\d{2}\.\d{4})\s+([\d\s]+,\d{2})/i);
			if (m) {
				openingBalance     = parseNorwNum(m[2]);
				openingBalanceDate = parseFullDate(m[1]);
				if (openingBalanceDate) {
					balanceSnapshots.push({ date: openingBalanceDate, balance: openingBalance });
				}
			}
		}

		// Page-transition balance: "Overført til neste side  X.XXX,XX"
		{
			const m = line.match(/overf[øo]rt til neste side\s+([\d\s]+,\d{2})/i);
			if (m && periodEnd) {
				const bal = parseNorwNum(m[1]);
				// Approximate the snapshot date — use periodEnd since we don't have exact date here
				balanceSnapshots.push({ date: periodEnd, balance: bal });
				// Don't override closingBalance yet; a proper closing line may follow
			}
		}

		// Closing balance: "Utgående saldo" or "saldo pr. DD.MM.YYYY"
		{
			const m = line.match(/(?:utg[åa]ende saldo|saldo pr\.?)\s+(\d{2}\.\d{2}\.\d{4})\s+([\d\s]+,\d{2})/i)
				?? line.match(/(?:utg[åa]ende saldo)\s+([\d\s]+,\d{2})/i);
			if (m) {
				if (m.length >= 3 && m[1].includes('.')) {
					closingBalanceDate = parseFullDate(m[1]);
					closingBalance     = parseNorwNum(m[2]);
				} else {
					closingBalance     = parseNorwNum(m[1]);
					closingBalanceDate = periodEnd;
				}
				if (closingBalanceDate) {
					balanceSnapshots.push({ date: closingBalanceDate, balance: closingBalance! });
				}
			}
		}
	}

	// ── Second pass: transaction lines ────────────────────────────────────────
	// Format after getText():
	//   [description]  DDMM  amount  DDMM
	//   e.g. "Lønn Fra: Amedia Utvikling AS   2501    46.603,75       2501"
	//
	// The "DDMM" at position 2 from the end is the booked date.
	// The amount is second-to-last token.
	// Sign is inferred from sequential balance tracking starting from openingBalance.

	const stmtYear = periodEnd?.getUTCFullYear() ?? new Date().getUTCFullYear();
	const stmtMonth = (periodEnd?.getUTCMonth() ?? 0) + 1; // 1-12

	// Regex: line ending with  DDMM  amount  DDMM  (amount = norw number)
	// We allow optional whitespace and accept lines with 2+ tokens after description
	const txLineRe = /^(.+?)\s{2,}(\d{4})\s+([\d\s]+,\d{2})\s+\d{4}\s*$/;

	let runningBalance = openingBalance;

	for (const line of lines) {
		// Skip anchor lines we already processed
		if (/saldo fr[åa] kontoutskrift|inng[åa]ende saldo|utg[åa]ende saldo|overf[øo]rt/i.test(line)) continue;

		const m = line.match(txLineRe);
		if (!m) continue;

		const description = m[1].trim();
		const ddmm        = m[2];
		const amount      = parseNorwNum(m[3]);

		// Derive year: if DDMM month > stmtMonth, it wrapped from previous year
		const txMonth = parseInt(ddmm.slice(2), 10);
		const txYear  = txMonth > stmtMonth + 1 ? stmtYear - 1 : stmtYear;
		const date    = parseDDMM(ddmm, txYear);
		if (!date) continue;

		// Infer sign from running balance if we have it
		let signedAmount: number;
		if (runningBalance !== null) {
			// Try +amount first (inn), else -amount (ut)
			// We can't verify without per-row balance, so we use keyword heuristics
			const desc = description.toLowerCase();
			const looksLikeCredit =
				desc.includes('lønn') || desc.includes('lonn') ||
				desc.includes('nettbank fra') || desc.includes('overf') ||
				desc.includes('renter') || desc.includes('utbetaling') ||
				desc.includes('matpæng') || desc.includes('matpeng') ||
				desc.includes('refusjon');
			signedAmount = looksLikeCredit ? amount : -amount;
		} else {
			signedAmount = -amount; // default: assume debit
		}

		if (runningBalance !== null) {
			runningBalance += signedAmount;
		}

		transactions.push({ date, description, amount: signedAmount });
	}

	const accountNumber = normaliseAccountNumber(rawAccountNumber);
	return {
		rawAccountNumber,
		accountNumber,
		periodStart,
		periodEnd,
		openingBalance,
		openingBalanceDate,
		closingBalance,
		closingBalanceDate,
		transactions,
		balanceSnapshots,
	};
}

// Async wrapper so the endpoint can call this the same way regardless of approach
export async function parseSparebank1Pdf(buf: Buffer): Promise<ParsedStatement> {
	const { PDFParse } = await import('pdf-parse');
	const parser = new PDFParse({ data: buf });
	const result = await parser.getText();
	return parseSparebank1Text(result.text);
}
