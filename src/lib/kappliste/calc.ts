// Kappliste-beregning — ren forretningslogikk (ingen DB, ingen Svelte). Alt i millimeter.
//
// En kappliste består av MATERIALER. Hvert materiale er enten:
//  - 'linear'  lengdevare (lekt/bjelke, f.eks. «48x48 impregnert furu») som selges i
//              faste lengder (stockLengthMm) til en meterpris. Kappene er lengder.
//  - 'sheet'   plate (f.eks. «15mm kryssfiner poppel» 2440x1220) som selges per plate
//              til en plate-pris. Kappene er rektangler (bredde × høyde).
//
// Vi regner ut hvor mange hele lekter/bjelker eller plater du må kjøpe (smart kapping),
// hvordan kappene fordeler seg (layout for visning), og hva det koster. Kostnad =
// antall hele enheter × enhetspris (du betaler for hele lekter/plater inkl. svinn).

export interface CutSpec {
	id: string;
	lengthMm?: number; // linear: ønsket lengde
	widthMm?: number; // sheet: ønsket bredde
	heightMm?: number; // sheet: ønsket høyde
	quantity: number;
}

export interface Material {
	id: string;
	name: string; // f.eks. "48x48 impregnert furu" eller "15mm kryssfiner poppel"
	kind: 'linear' | 'sheet';
	// linear:
	stockLengthMm?: number; // lengde per lekt/bjelke (default 3900)
	pricePerMeterNok?: number;
	// sheet:
	stockWidthMm?: number; // platebredde (default 2440)
	stockHeightMm?: number; // platehøyde (default 1220)
	pricePerSheetNok?: number;
	cuts: CutSpec[];
}

/** Én lekt/bjelke med kappene som er plassert på den (i rekkefølge). */
export interface LinearBoard {
	pieces: number[]; // lengder i mm
	wasteMm: number; // kapp til overs
}

/** Et plassert rektangel på en plate (mm, origo øverst til venstre). */
export interface SheetPlacement {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface SheetUnit {
	placements: SheetPlacement[];
}

export type MaterialLayout =
	| { kind: 'linear'; stockLengthMm: number; boards: LinearBoard[] }
	| { kind: 'sheet'; stockWidthMm: number; stockHeightMm: number; sheets: SheetUnit[] };

export interface MaterialResult {
	id: string;
	name: string;
	kind: 'linear' | 'sheet';
	stockNeeded: number; // antall hele lekter/bjelker eller plater
	totalPieces: number; // antall kapp etterspurt
	costNok: number;
	unitLabel: string; // 'lekt/bjelke' | 'plate'
	stockLabel: string; // f.eks. "3,90 m" eller "2440×1220 mm"
	piecesPerStock: number; // kun meningsfullt ved én kapp-lengde (linear), ellers 0
	wasteText: string; // kort svinn-/kapp-beskrivelse
	tooBig: string[]; // kapp som er for store for stock-enheten (visningstekst)
	layout: MaterialLayout;
}

export interface CutListResult {
	materials: MaterialResult[];
	totalCostNok: number;
	hasErrors: boolean;
}

export const DEFAULT_STOCK_LENGTH_MM = 3900;
export const DEFAULT_SHEET_WIDTH_MM = 2440;
export const DEFAULT_SHEET_HEIGHT_MM = 1220;

const EPS = 1e-6;

/* ── 1D: lengdevarer (First-Fit-Decreasing) ─────────────────────────── */

export function layoutLinear(
	lengths: number[],
	stockLengthMm: number,
	kerfMm = 0
): { boards: LinearBoard[]; tooLong: number[] } {
	const tooLong = lengths.filter((l) => l > stockLengthMm);
	const fit = lengths.filter((l) => l > 0 && l <= stockLengthMm).sort((a, b) => b - a);

	const bins: Array<{ remaining: number; pieces: number[] }> = [];
	for (const len of fit) {
		let placed = false;
		for (const bin of bins) {
			const cost = len + (bin.pieces.length > 0 ? kerfMm : 0);
			if (bin.remaining + EPS >= cost) {
				bin.remaining -= cost;
				bin.pieces.push(len);
				placed = true;
				break;
			}
		}
		if (!placed) bins.push({ remaining: stockLengthMm - len, pieces: [len] });
	}

	return { boards: bins.map((b) => ({ pieces: b.pieces, wasteMm: b.remaining })), tooLong };
}

export function packLinear(
	lengths: number[],
	stockLengthMm: number,
	kerfMm = 0
): { stock: number; wasteMm: number; tooLong: number[] } {
	const { boards, tooLong } = layoutLinear(lengths, stockLengthMm, kerfMm);
	return { stock: boards.length, wasteMm: boards.reduce((s, b) => s + b.wasteMm, 0), tooLong };
}

/* ── 2D: plater (hylle-basert heuristikk, rotasjon tillatt) ──────────── */
// Estimat for scoping — kan overestimere litt, men aldri underestimere grovt.

interface Shelf {
	y: number;
	height: number;
	used: number;
}
interface SheetState {
	shelves: Shelf[];
	usedHeight: number;
	placements: SheetPlacement[];
}

function placeOnSheet(sheet: SheetState, w: number, h: number, stockW: number, stockH: number, kerf: number): boolean {
	const orients = [
		{ w, h },
		{ w: h, h: w }
	];
	// Forsøk eksisterende hyller først (begge orienteringer).
	for (const shelf of sheet.shelves) {
		for (const o of orients) {
			const x = shelf.used + (shelf.used > 0 ? kerf : 0);
			if (o.h <= shelf.height + EPS && x + o.w <= stockW + EPS) {
				sheet.placements.push({ x, y: shelf.y, w: o.w, h: o.h });
				shelf.used = x + o.w;
				return true;
			}
		}
	}
	// Åpne ny hylle — velg orientering som passer bredden og gir lavest høyde.
	let best: { o: { w: number; h: number }; y: number } | null = null;
	for (const o of orients) {
		if (o.w > stockW + EPS) continue;
		const y = sheet.usedHeight + (sheet.usedHeight > 0 ? kerf : 0);
		if (y + o.h <= stockH + EPS) {
			if (!best || o.h < best.o.h) best = { o, y };
		}
	}
	if (best) {
		sheet.shelves.push({ y: best.y, height: best.o.h, used: best.o.w });
		sheet.placements.push({ x: 0, y: best.y, w: best.o.w, h: best.o.h });
		sheet.usedHeight = best.y + best.o.h;
		return true;
	}
	return false;
}

export function layoutSheets(
	rects: Array<{ w: number; h: number }>,
	stockW: number,
	stockH: number,
	kerfMm = 0
): { sheets: SheetUnit[]; tooLarge: Array<{ w: number; h: number }> } {
	const tooLarge: Array<{ w: number; h: number }> = [];
	const items: Array<{ w: number; h: number }> = [];
	for (const r of rects) {
		if (r.w <= 0 || r.h <= 0) continue;
		const fits = (r.w <= stockW && r.h <= stockH) || (r.h <= stockW && r.w <= stockH);
		if (!fits) {
			tooLarge.push(r);
			continue;
		}
		items.push({ w: Math.min(r.w, r.h), h: Math.max(r.w, r.h) });
	}
	items.sort((a, b) => b.h - a.h || b.w - a.w);

	const sheets: SheetState[] = [];
	for (const it of items) {
		let placed = false;
		for (const sheet of sheets) {
			if (placeOnSheet(sheet, it.w, it.h, stockW, stockH, kerfMm)) {
				placed = true;
				break;
			}
		}
		if (!placed) {
			const sheet: SheetState = { shelves: [], usedHeight: 0, placements: [] };
			if (placeOnSheet(sheet, it.w, it.h, stockW, stockH, kerfMm)) sheets.push(sheet);
			else tooLarge.push({ w: it.w, h: it.h });
		}
	}
	return { sheets: sheets.map((s) => ({ placements: s.placements })), tooLarge };
}

export function packSheets(
	rects: Array<{ w: number; h: number }>,
	stockW: number,
	stockH: number,
	kerfMm = 0
): { sheets: number; tooLarge: Array<{ w: number; h: number }> } {
	const { sheets, tooLarge } = layoutSheets(rects, stockW, stockH, kerfMm);
	return { sheets: sheets.length, tooLarge };
}

/* ── Materiale → resultat ─────────────────────────────────────────── */

function expandQuantity<T>(items: Array<{ value: T; quantity: number }>): T[] {
	const out: T[] = [];
	for (const { value, quantity } of items) {
		const q = Math.max(0, Math.floor(quantity || 0));
		for (let i = 0; i < q; i++) out.push(value);
	}
	return out;
}

export function computeMaterial(material: Material, kerfMm = 0): MaterialResult {
	if (material.kind === 'sheet') {
		const stockW = material.stockWidthMm && material.stockWidthMm > 0 ? material.stockWidthMm : DEFAULT_SHEET_WIDTH_MM;
		const stockH = material.stockHeightMm && material.stockHeightMm > 0 ? material.stockHeightMm : DEFAULT_SHEET_HEIGHT_MM;
		const price = material.pricePerSheetNok ?? 0;

		const rects = expandQuantity(
			material.cuts
				.filter((c) => (c.widthMm ?? 0) > 0 && (c.heightMm ?? 0) > 0)
				.map((c) => ({ value: { w: c.widthMm!, h: c.heightMm! }, quantity: c.quantity }))
		);
		const { sheets, tooLarge } = layoutSheets(rects, stockW, stockH, kerfMm);

		return {
			id: material.id,
			name: material.name,
			kind: 'sheet',
			stockNeeded: sheets.length,
			totalPieces: rects.length,
			costNok: sheets.length * price,
			unitLabel: 'plate',
			stockLabel: `${stockW}×${stockH} mm`,
			piecesPerStock: 0,
			wasteText: '',
			tooBig: tooLarge.map((r) => `${Math.round(r.w)}×${Math.round(r.h)} mm`),
			layout: { kind: 'sheet', stockWidthMm: stockW, stockHeightMm: stockH, sheets }
		};
	}

	// linear
	const stockLen = material.stockLengthMm && material.stockLengthMm > 0 ? material.stockLengthMm : DEFAULT_STOCK_LENGTH_MM;
	const price = material.pricePerMeterNok ?? 0;
	const lengths = expandQuantity(
		material.cuts.filter((c) => (c.lengthMm ?? 0) > 0).map((c) => ({ value: c.lengthMm!, quantity: c.quantity }))
	);
	const { boards, tooLong } = layoutLinear(lengths, stockLen, kerfMm);
	const wasteMm = boards.reduce((s, b) => s + b.wasteMm, 0);

	const uniqueLengths = [...new Set(lengths)];
	const piecesPerStock = uniqueLengths.length === 1 ? Math.floor(stockLen / uniqueLengths[0]) : 0;
	const costNok = boards.length * (stockLen / 1000) * price;
	const wasteText =
		boards.length > 0 && wasteMm > 0
			? `${piecesPerStock > 0 ? `${piecesPerStock} per lengde · ` : ''}${Math.round(wasteMm / 10)} cm kapp`
			: '';

	return {
		id: material.id,
		name: material.name,
		kind: 'linear',
		stockNeeded: boards.length,
		totalPieces: lengths.length,
		costNok,
		unitLabel: 'lekt/bjelke',
		stockLabel: formatMeters(stockLen),
		piecesPerStock,
		wasteText,
		tooBig: tooLong.map((l) => `${Math.round(l)} mm`),
		layout: { kind: 'linear', stockLengthMm: stockLen, boards }
	};
}

export function computeCutList(materials: Material[], kerfMm = 0): CutListResult {
	const results = materials.map((m) => computeMaterial(m, kerfMm)).filter((r) => r.totalPieces > 0 || r.tooBig.length > 0);
	const totalCostNok = results.reduce((sum, r) => sum + r.costNok, 0);
	const hasErrors = results.some((r) => r.tooBig.length > 0);
	return { materials: results, totalCostNok, hasErrors };
}

/* ── Formatering ──────────────────────────────────────────────────── */

export function formatNok(nok: number): string {
	return `${Math.round(nok).toLocaleString('nb-NO')} kr`;
}

/** mm → meter med komma: 3900 → «3,90 m». */
export function formatMeters(mm: number): string {
	return `${(mm / 1000).toLocaleString('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`;
}
