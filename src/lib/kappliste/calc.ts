// Kappliste-beregning — ren forretningslogikk (ingen DB, ingen Svelte). Alt i millimeter.
//
// En kappliste består av MATERIALER. Hvert materiale er enten:
//  - 'linear'  lengdevare (lekt/bjelke, f.eks. «48x48 impregnert furu») som selges i
//              faste lengder (stockLengthMm) til en meterpris. Kappene er lengder.
//  - 'sheet'   plate (f.eks. «15mm kryssfiner poppel» 2440x1220) som selges per m²
//              (pris/m²). Kappene er rektangler (bredde × høyde).
//
// Vi regner ut hvor mange hele lekter/bjelker eller plater du må kjøpe (smart kapping),
// hvordan kappene fordeler seg (layout for visning), og hva det koster. Du betaler for
// hele enheter inkl. svinn: lekt/bjelke = antall × (lengde × meterpris), plate =
// antall × (plateareal × pris/m²).

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
	woodType?: string; // tresort/platetype, f.eks. "furu", "kryssfiner poppel"
	treatment?: string; // behandling, f.eks. "Trykkimpregnert", "Ubehandlet"
	thicknessMm?: number; // godstykkelse (plate-z / lekt-tykkelse) — metadata, ikke i beregning
	crossWidthMm?: number; // tverrsnittsbredde for lengdevare — metadata, ikke i beregning
	// linear:
	stockLengthMm?: number; // lengde per lekt/bjelke (default 3900)
	pricePerMeterNok?: number;
	// sheet:
	stockWidthMm?: number; // platebredde (default 2440)
	stockHeightMm?: number; // platehøyde (default 1220)
	pricePerSquareMeterNok?: number; // pris per m² plate
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

/* ── 2D: plater (MaxRects fri-rektangel, rotasjon tillatt) ──────────── */
// Estimat for scoping. Bedre enn en ren hylle-heuristikk: pakkeren kan fylle
// restsoner BÅDE ved siden av og under et plassert kapp, så høye og lave kapp
// kombineres tett. Fordi 2D-pakking er NP-hardt kjører vi flere heuristikker
// (ulik plasseringsregel + sortering) og velger resultatet med færrest plater
// (deretter minst svinn). Kan fortsatt overestimere i sjeldne tilfeller, men
// finner langt oftere den optimale platebruken enn hylle-varianten.

interface FreeRect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Er a helt innenfor b? */
function isContained(a: FreeRect, b: FreeRect): boolean {
	return a.x >= b.x - EPS && a.y >= b.y - EPS && a.x + a.w <= b.x + b.w + EPS && a.y + a.h <= b.y + b.h + EPS;
}

/** Fjern fri-rektangler som er dekket av et annet (behold ett ved likhet). */
function pruneFree(free: FreeRect[]): FreeRect[] {
	return free.filter(
		(a, i) => !free.some((b, j) => j !== i && isContained(a, b) && (!isContained(b, a) || j < i))
	);
}

/** Del opp fri-rektangler rundt et opptatt rektangel (MaxRects-splitt). */
function splitFree(free: FreeRect[], used: FreeRect): FreeRect[] {
	const out: FreeRect[] = [];
	for (const f of free) {
		const noOverlap =
			used.x >= f.x + f.w - EPS ||
			used.x + used.w <= f.x + EPS ||
			used.y >= f.y + f.h - EPS ||
			used.y + used.h <= f.y + EPS;
		if (noOverlap) {
			out.push(f);
			continue;
		}
		if (used.x > f.x + EPS) out.push({ x: f.x, y: f.y, w: used.x - f.x, h: f.h }); // venstre
		if (used.x + used.w < f.x + f.w - EPS)
			out.push({ x: used.x + used.w, y: f.y, w: f.x + f.w - (used.x + used.w), h: f.h }); // høyre
		if (used.y > f.y + EPS) out.push({ x: f.x, y: f.y, w: f.w, h: used.y - f.y }); // topp
		if (used.y + used.h < f.y + f.h - EPS)
			out.push({ x: f.x, y: used.y + used.h, w: f.w, h: f.y + f.h - (used.y + used.h) }); // bunn
	}
	return pruneFree(out);
}

// Plasseringsregler:
//  bssf/blsf/baf — vurder begge orienteringer, posisjoner etter best short/long/area fit.
//  portrait/landscape — tving foretrukket orientering (stående/liggende) der den
//    passer, fall tilbake til den andre kun ved behov. Disse to løser tilfeller der
//    én konsekvent orientering pakker tettere enn grådig fit per kapp.
type FitRule = 'bssf' | 'blsf' | 'baf' | 'portrait' | 'landscape';

interface Placement {
	x: number;
	y: number;
	w: number;
	h: number;
	score1: number;
	score2: number;
}

/** Orienteringer å prøve, i prioritert rekkefølge for regelen. */
function orientations(w: number, h: number, rule: FitRule): Array<[number, number]> {
	if (w === h) return [[w, h]];
	const tall: [number, number] = h >= w ? [w, h] : [h, w];
	const wide: [number, number] = w >= h ? [w, h] : [h, w];
	if (rule === 'portrait') return [tall, wide];
	if (rule === 'landscape') return [wide, tall];
	return [
		[w, h],
		[h, w]
	];
}

/** Finn beste plassering av w×h blant fri-rektangler etter gitt regel. */
function findPlacement(free: FreeRect[], w: number, h: number, rule: FitRule): Placement | null {
	const biased = rule === 'portrait' || rule === 'landscape';
	let best: Placement | null = null;
	for (const f of free) {
		for (const [rw, rh] of orientations(w, h, rule)) {
			if (rw > f.w + EPS || rh > f.h + EPS) continue;
			const leftH = f.w - rw;
			const leftV = f.h - rh;
			const short = Math.min(leftH, leftV);
			const long = Math.max(leftH, leftV);
			let score1: number;
			let score2: number;
			if (rule === 'blsf') {
				score1 = long;
				score2 = short;
			} else if (rule === 'baf') {
				score1 = f.w * f.h - rw * rh; // best area fit
				score2 = short;
			} else {
				score1 = short; // bssf + orienteringsstyrte regler posisjonerer etter short fit
				score2 = long;
			}
			if (!best || score1 < best.score1 - EPS || (Math.abs(score1 - best.score1) <= EPS && score2 < best.score2 - EPS)) {
				best = { x: f.x, y: f.y, w: rw, h: rh, score1, score2 };
			}
			if (biased) break; // bruk kun foretrukket orientering som passer dette fri-rektangelet
		}
	}
	return best;
}

interface PackedSheet {
	placements: SheetPlacement[];
	free: FreeRect[];
}

/** Én komplett pakking med gitt sortering + plasseringsregel. */
function packWithStrategy(
	items: Array<{ w: number; h: number }>,
	stockW: number,
	stockH: number,
	kerfMm: number,
	rule: FitRule
): PackedSheet[] {
	const sheets: PackedSheet[] = [];
	for (const it of items) {
		let bestSheet = -1;
		let bestPlace: Placement | null = null;
		for (let s = 0; s < sheets.length; s++) {
			const cand = findPlacement(sheets[s].free, it.w, it.h, rule);
			if (
				cand &&
				(!bestPlace ||
					cand.score1 < bestPlace.score1 - EPS ||
					(Math.abs(cand.score1 - bestPlace.score1) <= EPS && cand.score2 < bestPlace.score2 - EPS))
			) {
				bestPlace = cand;
				bestSheet = s;
			}
		}
		if (!bestPlace) {
			const free: FreeRect[] = [{ x: 0, y: 0, w: stockW, h: stockH }];
			// Garantert plass: kappet er allerede sjekket mot platemålene.
			bestPlace = findPlacement(free, it.w, it.h, rule);
			if (!bestPlace) continue; // skal ikke skje (feasibility sjekket på forhånd)
			sheets.push({ placements: [], free });
			bestSheet = sheets.length - 1;
		}
		const sheet = sheets[bestSheet];
		sheet.placements.push({ x: bestPlace.x, y: bestPlace.y, w: bestPlace.w, h: bestPlace.h });
		// Reserver sagsnitt til høyre og under hvert kapp.
		const footprint: FreeRect = { x: bestPlace.x, y: bestPlace.y, w: bestPlace.w + kerfMm, h: bestPlace.h + kerfMm };
		sheet.free = splitFree(sheet.free, footprint);
	}
	return sheets;
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
		items.push({ w: r.w, h: r.h });
	}

	// Flere sorteringer × plasseringsregler — velg pakkingen med færrest plater,
	// deretter minst total-svinn (mest brukt areal).
	const sorters: Array<(a: { w: number; h: number }, b: { w: number; h: number }) => number> = [
		(a, b) => b.w * b.h - a.w * a.h, // areal synkende
		(a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h), // lengste side synkende
		(a, b) => b.h - a.h || b.w - a.w // høyde synkende
	];
	const rules: FitRule[] = ['bssf', 'blsf', 'baf', 'portrait', 'landscape'];

	const usedArea = items.reduce((s, it) => s + it.w * it.h, 0);
	let best: PackedSheet[] | null = null;
	let bestWaste = Infinity;
	for (const sorter of sorters) {
		const sorted = [...items].sort(sorter);
		for (const rule of rules) {
			const packed = packWithStrategy(sorted, stockW, stockH, kerfMm, rule);
			const waste = packed.length * stockW * stockH - usedArea;
			if (best === null || packed.length < best.length || (packed.length === best.length && waste < bestWaste - EPS)) {
				best = packed;
				bestWaste = waste;
			}
		}
	}

	const sheets: SheetUnit[] = (best ?? []).map((s) => ({ placements: s.placements }));
	return { sheets, tooLarge };
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
		const pricePerM2 = material.pricePerSquareMeterNok ?? 0;
		const sheetAreaM2 = (stockW / 1000) * (stockH / 1000);

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
			costNok: sheets.length * sheetAreaM2 * pricePerM2,
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
