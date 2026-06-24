// Kappliste-beregning — ren forretningslogikk (ingen DB, ingen Svelte).
//
// En kappliste sier hvor mange biter (lengder) av en gitt dimensjon du trenger,
// til hvilken meterpris. Vi regner ut hvor mange hele fjøler (standardlengde,
// f.eks. 3,90 m) du må kjøpe ved å kappe smart (bin-packing), og hva det koster.
//
// Kostnadsmodell: du betaler for HELE fjøler (det du faktisk legger igjen i kassa),
// ikke bare for brukt lengde. Kapp/svinn er inkludert i prisen.

export interface CutListRow {
	id: string;
	dimension: string; // f.eks. "48x48", "73x48", "28x120"
	lengthCm: number; // ønsket bitlengde i cm
	quantity: number; // antall biter av denne lengden
	meterPriceNok: number; // pris per meter for denne dimensjonen
}

export interface DimensionResult {
	dimension: string; // visningsnavn (første rad sin skrivemåte)
	pieces: number; // totalt antall biter etterspurt
	boardsNeeded: number; // antall hele fjøler å kjøpe
	piecesPerFullBoard: number; // biter per fjøl ved én lengde (0 ved blandede lengder)
	costNok: number; // boardsNeeded × fjøllengde(m) × meterpris
	meterPriceNok: number; // meterprisen brukt i kostnaden
	wasteCm: number; // sum kapp/svinn på tvers av fjølene
	tooLong: number[]; // lengder som er lengre enn fjølen og ikke kan kappes
}

export interface CutListResult {
	boardLengthCm: number;
	dimensions: DimensionResult[];
	totalBoards: number;
	totalCostNok: number;
	hasErrors: boolean; // true hvis noen bit er lengre enn fjølen
}

/** Normaliser en dimensjon for gruppering: små bokstaver, fjern mellomrom, «×»/«*» → «x». */
export function normalizeDimension(dimension: string): string {
	return (dimension ?? '')
		.trim()
		.toLowerCase()
		.replace(/\s+/g, '')
		.replace(/[×*]/g, 'x');
}

/**
 * Pakk biter (lengder i cm) inn i fjøler av gitt lengde med First-Fit-Decreasing.
 * `kerfCm` er sagsnittet som går tapt mellom to biter på samme fjøl.
 * Returnerer antall fjøler, samlet svinn, og lengder som ikke får plass.
 */
export function packBoards(
	lengths: number[],
	boardLengthCm: number,
	kerfCm = 0
): { boards: number; wasteCm: number; tooLong: number[] } {
	const tooLong = lengths.filter((l) => l > boardLengthCm);
	const fit = lengths.filter((l) => l > 0 && l <= boardLengthCm).sort((a, b) => b - a);

	const bins: Array<{ remaining: number; count: number }> = [];
	for (const len of fit) {
		let placed = false;
		for (const bin of bins) {
			const cost = len + (bin.count > 0 ? kerfCm : 0);
			if (bin.remaining + 1e-9 >= cost) {
				bin.remaining -= cost;
				bin.count++;
				placed = true;
				break;
			}
		}
		if (!placed) bins.push({ remaining: boardLengthCm - len, count: 1 });
	}

	const wasteCm = bins.reduce((sum, b) => sum + b.remaining, 0);
	return { boards: bins.length, wasteCm, tooLong };
}

/**
 * Regn ut hele kapplista. Biter grupperes per dimensjon (du kan bare kombinere
 * biter av samme dimensjon på én fjøl), bin-pakkes, og prises per hele fjøl.
 */
export function computeCutList(
	rows: CutListRow[],
	boardLengthCm: number,
	kerfMm = 0
): CutListResult {
	const kerfCm = kerfMm / 10;
	const safeBoardLength = boardLengthCm > 0 ? boardLengthCm : 390;
	const boardLengthM = safeBoardLength / 100;

	// Grupper rader per normalisert dimensjon, men behold første skrivemåte til visning.
	const groups = new Map<string, { display: string; rows: CutListRow[] }>();
	for (const row of rows) {
		const key = normalizeDimension(row.dimension);
		if (!key) continue;
		const group = groups.get(key);
		if (group) group.rows.push(row);
		else groups.set(key, { display: row.dimension.trim(), rows: [row] });
	}

	const dimensions: DimensionResult[] = [];
	for (const { display, rows: dimRows } of groups.values()) {
		const lengths: number[] = [];
		for (const row of dimRows) {
			const qty = Math.max(0, Math.floor(row.quantity || 0));
			if (row.lengthCm > 0) {
				for (let i = 0; i < qty; i++) lengths.push(row.lengthCm);
			}
		}
		if (lengths.length === 0) continue;

		const { boards, wasteCm, tooLong } = packBoards(lengths, safeBoardLength, kerfCm);

		// Meterpris per dimensjon: forventes lik på alle rader. Bruk høyeste for å ikke underprise.
		const meterPriceNok = Math.max(0, ...dimRows.map((r) => r.meterPriceNok || 0));
		const costNok = boards * boardLengthM * meterPriceNok;

		// «Biter per fjøl» er bare meningsfullt når alle bitene har samme lengde.
		const uniqueLengths = [...new Set(lengths)];
		const piecesPerFullBoard =
			uniqueLengths.length === 1 ? Math.floor(safeBoardLength / uniqueLengths[0]) : 0;

		dimensions.push({
			dimension: display,
			pieces: lengths.length,
			boardsNeeded: boards,
			piecesPerFullBoard,
			costNok,
			meterPriceNok,
			wasteCm,
			tooLong
		});
	}

	dimensions.sort((a, b) => a.dimension.localeCompare(b.dimension, 'nb'));

	const totalBoards = dimensions.reduce((sum, d) => sum + d.boardsNeeded, 0);
	const totalCostNok = dimensions.reduce((sum, d) => sum + d.costNok, 0);
	const hasErrors = dimensions.some((d) => d.tooLong.length > 0);

	return { boardLengthCm: safeBoardLength, dimensions, totalBoards, totalCostNok, hasErrors };
}

/** Formatter kroner til norsk visning, avrundet til hele kroner: «324 kr». */
export function formatNok(nok: number): string {
	return `${Math.round(nok).toLocaleString('nb-NO')} kr`;
}

/** Formatter en lengde i cm til meter med komma: 390 → «3,90 m». */
export function formatMeters(cm: number): string {
	return `${(cm / 100).toLocaleString('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`;
}
