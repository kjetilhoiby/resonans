// Transport-optimalisering: «kapp i butikk» så bitene passer i bilen.
//
// En hel plate (2440×1220) eller en lang lekt (3,90 m) får ikke plass i et
// bil-lasterom. Mange byggevarebutikker kapper gratis. Vi foreslår derfor rette
// (giljotin) snitt som deler plata/lekta i transport-biter som hver passer en
// transport-grense — og vi legger snittene i mellomrommene i kappeplanen, så
// ingen FERDIG bit blir kappet av transport-snittet (layout-bevisst).
//
// Ren forretningslogikk (ingen DB/Svelte). Alt i millimeter.

import type { MaterialResult, SheetPlacement } from './calc';

const EPS = 1e-6;

/** Maks bit som passer i lasterommet. maxLengthMm = lengste side, maxWidthMm = korteste. */
export interface TransportLimit {
	maxLengthMm: number;
	maxWidthMm: number;
}

// Tesla Model Y, baksete nedfelt: ~1900 mm lengde (flatt), ~1000 mm mellom hjulkassene.
export const MODEL_Y_TRANSPORT: TransportLimit = { maxLengthMm: 1900, maxWidthMm: 1000 };

/** Passer en w×h-bit i lasterommet (rotasjon tillatt)? */
export function fitsTransport(w: number, h: number, limit: TransportLimit): boolean {
	const lo = Math.min(w, h);
	const hi = Math.max(w, h);
	return lo <= limit.maxWidthMm + EPS && hi <= limit.maxLengthMm + EPS;
}

interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Hvor mye et rektangel overskrider transport-grensen (0 = passer). */
function violation(r: Rect, limit: TransportLimit): number {
	const lo = Math.min(r.w, r.h);
	const hi = Math.max(r.w, r.h);
	return Math.max(0, hi - limit.maxLengthMm) + Math.max(0, lo - limit.maxWidthMm);
}

function overlaps(p: Rect, r: Rect): boolean {
	return p.x < r.x + r.w - EPS && p.x + p.w > r.x + EPS && p.y < r.y + r.h - EPS && p.y + p.h > r.y + EPS;
}

interface Cut {
	axis: 'v' | 'h';
	pos: number;
}

/** Et vertikalt snitt ved x er gyldig hvis det er inne i regionen og ikke deler en bit. */
function validVertical(r: Rect, pieces: Rect[], x: number): boolean {
	if (x <= r.x + EPS || x >= r.x + r.w - EPS) return false;
	return !pieces.some((p) => p.x < x - EPS && p.x + p.w > x + EPS);
}
function validHorizontal(r: Rect, pieces: Rect[], y: number): boolean {
	if (y <= r.y + EPS || y >= r.y + r.h - EPS) return false;
	return !pieces.some((p) => p.y < y - EPS && p.y + p.h > y + EPS);
}

function splitRegion(r: Rect, c: Cut): [Rect, Rect] {
	if (c.axis === 'v') {
		return [
			{ x: r.x, y: r.y, w: c.pos - r.x, h: r.h },
			{ x: c.pos, y: r.y, w: r.x + r.w - c.pos, h: r.h }
		];
	}
	return [
		{ x: r.x, y: r.y, w: r.w, h: c.pos - r.y },
		{ x: r.x, y: c.pos, w: r.w, h: r.y + r.h - c.pos }
	];
}

/** Velg snittet som gir lavest samlet overskridelse i de to delene (langs mellomrom). */
function chooseCut(r: Rect, pieces: Rect[], limit: TransportLimit): Cut | null {
	const xs = new Set<number>();
	const ys = new Set<number>();
	for (const p of pieces) {
		xs.add(p.x);
		xs.add(p.x + p.w);
		ys.add(p.y);
		ys.add(p.y + p.h);
	}
	// Grense-avledede linjer hjelper når det er store tomme felt (få/ingen biter).
	for (const d of [limit.maxLengthMm, limit.maxWidthMm]) {
		xs.add(r.x + d);
		xs.add(r.x + r.w - d);
		ys.add(r.y + d);
		ys.add(r.y + r.h - d);
	}

	const candidates: Cut[] = [];
	for (const x of xs) if (validVertical(r, pieces, x)) candidates.push({ axis: 'v', pos: x });
	for (const y of ys) if (validHorizontal(r, pieces, y)) candidates.push({ axis: 'h', pos: y });
	if (candidates.length === 0) return null;

	let best: Cut | null = null;
	let bestScore = Infinity;
	for (const c of candidates) {
		const [a, b] = splitRegion(r, c);
		const va = violation(a, limit);
		const vb = violation(b, limit);
		const score = (va + vb) * 1e6 + Math.max(va, vb);
		if (score < bestScore - EPS) {
			bestScore = score;
			best = c;
		}
	}
	return best;
}

export interface TransportPanel {
	x: number;
	y: number;
	w: number;
	h: number;
	fits: boolean; // passer transport-grensen?
}

export interface SheetTransportPlan {
	panels: TransportPanel[];
	cuts: number; // antall giljotin-snitt i butikk
	allFit: boolean;
}

/** Del én plate i transport-paneler via giljotin-snitt som ikke deler ferdige biter. */
export function planSheetTransport(
	placements: SheetPlacement[],
	stockW: number,
	stockH: number,
	limit: TransportLimit
): SheetTransportPlan {
	const panels: TransportPanel[] = [];
	let cuts = 0;

	function rec(r: Rect, depth: number) {
		if (fitsTransport(r.w, r.h, limit)) {
			panels.push({ ...r, fits: true });
			return;
		}
		if (depth > 64) {
			panels.push({ ...r, fits: false });
			return;
		}
		const inside = placements.filter((p) => overlaps(p, r));
		const cut = chooseCut(r, inside, limit);
		if (!cut) {
			panels.push({ ...r, fits: false }); // ingen bit her kan kappes uten å dele en ferdig bit
			return;
		}
		cuts++;
		const [a, b] = splitRegion(r, cut);
		rec(a, depth + 1);
		rec(b, depth + 1);
	}

	rec({ x: 0, y: 0, w: stockW, h: stockH }, 0);
	return { panels, cuts, allFit: panels.every((p) => p.fits) };
}

export interface BoardTransportPlan {
	segments: number[][]; // hvert segment = bitene som havner i én transport-lengde
	cuts: number;
	allFit: boolean;
}

/** Del én lekt/bjelke i transport-lengder. Snitt legges mellom bitene (ingen deles). */
export function planBoardTransport(pieces: number[], limit: TransportLimit): BoardTransportPlan {
	const maxLen = limit.maxLengthMm; // tynn lekt → kun lengden begrenser
	const segments: number[][] = [];
	let cur: number[] = [];
	let curLen = 0;
	for (const p of pieces) {
		if (p > maxLen + EPS) {
			// Selve biten er for lang for bilen — kan ikke transporteres hel.
			if (cur.length) {
				segments.push(cur);
				cur = [];
				curLen = 0;
			}
			segments.push([p]);
			continue;
		}
		if (curLen > 0 && curLen + p > maxLen + EPS) {
			segments.push(cur);
			cur = [p];
			curLen = p;
		} else {
			cur.push(p);
			curLen += p;
		}
	}
	if (cur.length) segments.push(cur);
	return { segments, cuts: Math.max(0, segments.length - 1), allFit: pieces.every((p) => p <= maxLen + EPS) };
}

export interface MaterialTransportPlan {
	needed: boolean; // må noe kappes for å få det hjem?
	totalCuts: number; // antall snitt i butikk totalt
	units: number; // antall plater/lekter som må kappes
	allFit: boolean; // passer alt etter kapping?
	oversized: string[]; // ferdige biter som ikke passer bilen selv (visningstekst)
}

function dedup(arr: string[]): string[] {
	return [...new Set(arr)];
}

/** Aggreger transport-plan for et helt materiale (alle plater/lekter). */
export function planMaterialTransport(result: MaterialResult, limit: TransportLimit): MaterialTransportPlan {
	let totalCuts = 0;
	let units = 0;
	let allFit = true;
	const oversized: string[] = [];

	if (result.layout.kind === 'sheet') {
		const { stockWidthMm: sw, stockHeightMm: sh, sheets } = result.layout;
		for (const s of sheets) {
			const plan = planSheetTransport(s.placements, sw, sh, limit);
			if (plan.cuts > 0) units++;
			totalCuts += plan.cuts;
			if (!plan.allFit) allFit = false;
			for (const p of s.placements) if (!fitsTransport(p.w, p.h, limit)) oversized.push(`${p.w}×${p.h} mm`);
		}
		const needed = sheets.length > 0 && !fitsTransport(sw, sh, limit);
		return { needed, totalCuts, units, allFit, oversized: dedup(oversized) };
	}

	const stockLen = result.layout.stockLengthMm;
	for (const b of result.layout.boards) {
		const plan = planBoardTransport(b.pieces, limit);
		if (plan.cuts > 0) units++;
		totalCuts += plan.cuts;
		if (!plan.allFit) allFit = false;
		for (const p of b.pieces) if (p > limit.maxLengthMm + EPS) oversized.push(`${p} mm`);
	}
	const needed = result.layout.boards.length > 0 && stockLen > limit.maxLengthMm + EPS;
	return { needed, totalCuts, units, allFit, oversized: dedup(oversized) };
}
