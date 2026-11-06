/**
 * Deichman-e-post → strukturerte lån. Ren parsing; lagringen bor i
 * `$lib/server/email-processors/library.ts`.
 *
 * Fire typer (format fra biblioteksystemet Deichman tok i bruk i mars 2026):
 *
 * - «Påminnelse om forfall»: «Husk å levere tilbake dette senest DD.MM.YYYY:»
 *   og én eller flere blokker med Tittel/Forfatter/Strekkode.
 * - «Purring på forfalte lån»: «skulle ha levert for 5 dager siden» + blokker.
 * - «2. purring»: som over, pluss purregebyr og sperring.
 * - «Hentemelding fra biblioteket»: blokker + hentebibliotek, hentenummer og
 *   «Du må hente senest DD.MM.YYYY».
 *
 * Det eldre formatet (til 2025) hadde «innen 2 dager» og linjer som
 * «Tittel, Forfatter 30119116868912». Det leses også, fordi en videresendt
 * gammel e-post ellers ville blitt et punkt uten tittel.
 *
 * Strekkoden er nøkkelen: samme bok fornyes og får en ny påminnelse med ny
 * dato, og da skal det eksisterende punktet flyttes, ikke dupliseres.
 */

export type LibraryEmailKind = 'reminder' | 'overdue' | 'overdue_final' | 'pickup';

export interface LibraryLoan {
	title: string;
	author: string | null;
	barcode: string | null;
}

export interface ParsedLibraryEmail {
	kind: LibraryEmailKind;
	loans: LibraryLoan[];
	/** Innleveringsfrist (påminnelse) eller hentefrist (hentemelding), ISO-dato. */
	deadline: string | null;
	daysOverdue: number | null;
	feeNok: number | null;
	blocked: boolean;
	pickupBranch: string | null;
	pickupNumber: string | null;
}

export function classifyLibraryEmail(subject: string): LibraryEmailKind | null {
	const s = subject.toLowerCase();
	if (s.includes('hentemelding')) return 'pickup';
	if (/2\.\s*purring/.test(s)) return 'overdue_final';
	if (s.includes('purring')) return 'overdue';
	if (s.includes('forfall')) return 'reminder';
	return null;
}

function isoFromNorwegian(day: string, month: string, year: string): string | null {
	const d = Number(day);
	const m = Number(month);
	let y = Number(year);
	if (y < 100) y += 2000;
	if (!(d >= 1 && d <= 31 && m >= 1 && m <= 12)) return null;
	return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function addDays(isoDate: string, days: number): string {
	const [y, m, d] = isoDate.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Blokkene «Tittel: … / Forfatter: … / Strekkode: …», i rekkefølge. */
function parseLoanBlocks(body: string): LibraryLoan[] {
	const loans: LibraryLoan[] = [];
	let current: LibraryLoan | null = null;
	for (const rawLine of body.split(/\r?\n/)) {
		const line = rawLine.trim();
		const field = line.match(/^(Tittel|Forfatter|Strekkode)\s*:\s*(.*)$/i);
		if (!field) continue;
		const key = field[1].toLowerCase();
		const value = field[2].trim();
		if (key === 'tittel') {
			if (current) loans.push(current);
			current = { title: value, author: null, barcode: null };
		} else if (current && key === 'forfatter') {
			current.author = value || null;
		} else if (current && key === 'strekkode') {
			current.barcode = value.replace(/\s+/g, '') || null;
		}
	}
	if (current) loans.push(current);
	return loans.filter((l) => l.title.length > 0);
}

/** Det gamle formatet: «Tittel, Forfatter 30119116868912» (strekkode på 14 siffer). */
function parseLegacyLoans(body: string): LibraryLoan[] {
	const loans: LibraryLoan[] = [];
	const re = /([^\n:]+?)\s+(\d{14})\b/g;
	for (const m of body.matchAll(re)) {
		const text = m[1].trim();
		// Purringene skrev «Tittel, 3011…» (komma rett før strekkoden, ingen
		// forfatter); påminnelsene «Tittel, Forfatter 3011…».
		if (text.endsWith(',')) {
			loans.push({ title: text.slice(0, -1).trim(), author: null, barcode: m[2] });
			continue;
		}
		const comma = text.indexOf(', ');
		const title = comma > 0 ? text.slice(0, comma).trim() : text;
		const author = comma > 0 ? text.slice(comma + 2).trim() : null;
		if (title) loans.push({ title, author: author || null, barcode: m[2] });
	}
	return loans;
}

/**
 * @param receivedIso Datoen e-posten kom (Oslo), brukt for relative frister
 *   («innen 2 dager»).
 */
export function parseLibraryEmail(subject: string, body: string, receivedIso: string): ParsedLibraryEmail | null {
	const kind = classifyLibraryEmail(subject);
	if (!kind) return null;

	let loans = parseLoanBlocks(body);
	if (loans.length === 0) loans = parseLegacyLoans(body);

	let deadline: string | null = null;
	const absolute =
		kind === 'pickup'
			? body.match(/hente\s+senest\s+(\d{1,2})\.(\d{1,2})\.(\d{2,4})/i)
			: body.match(/(?:senest|innen)\s+(\d{1,2})\.(\d{1,2})\.(\d{2,4})/i);
	if (absolute) deadline = isoFromNorwegian(absolute[1], absolute[2], absolute[3]);
	if (!deadline && kind === 'reminder') {
		const relative = body.match(/innen\s+(\d{1,2})\s+dag/i);
		if (relative) deadline = addDays(receivedIso, Number(relative[1]));
	}

	const overdue = body.match(/for\s+(\d{1,3})\s+dager\s+siden/i);
	const fee = body.match(/purregebyr\s+på\s+(\d+)\s*kr/i);

	return {
		kind,
		loans,
		deadline,
		daysOverdue: overdue ? Number(overdue[1]) : null,
		feeNok: fee ? Number(fee[1]) : null,
		blocked: /sperret/i.test(body),
		pickupBranch: body.match(/Hentebibliotek\s*:\s*([^\n.]+)/i)?.[1].trim() ?? null,
		pickupNumber: body.match(/Hentenummer\s+er\s+(\w+)/i)?.[1] ?? null
	};
}

/** Nøkkelen et lån gjenkjennes på mellom e-poster: strekkoden, ellers tittelen. */
export function loanKey(loan: LibraryLoan): string {
	return loan.barcode ?? `tittel:${loan.title.toLowerCase().replace(/\s+/g, ' ').trim()}`;
}

/** Punktteksten. Står i bibliotekslista og på dagslista. */
export function loanItemText(loan: LibraryLoan, parsed: ParsedLibraryEmail): string {
	switch (parsed.kind) {
		case 'pickup': {
			const where = parsed.pickupBranch ? ` på ${parsed.pickupBranch}` : '';
			const number = parsed.pickupNumber ? ` (nr. ${parsed.pickupNumber})` : '';
			return `Hent: ${loan.title}${where}${number}`;
		}
		case 'overdue':
			return `Lever (forfalt): ${loan.title}`;
		case 'overdue_final': {
			const fee = parsed.feeNok ? `, purregebyr ${parsed.feeNok} kr` : '';
			return `Lever (forfalt${fee}): ${loan.title}`;
		}
		case 'reminder':
		default:
			return `Lever: ${loan.title}`;
	}
}
