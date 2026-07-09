/**
 * Ren rangeringslogikk for «hva ser jeg i kveld?».
 *
 * Holdt fri for DB/nettverk slik at den kan enhetstestes. Selve API-ruten
 * samler kandidater (biblioteket + lister + evt. TMDB discover) og sender dem
 * hit for filtrering + rangering på tilgjengelig tid og strømmetjeneste.
 */

export interface RecommendCandidate {
	tmdbId?: number | null;
	title: string;
	year?: number | null;
	runtime?: number | null;
	posterUrl?: string | null;
	rating?: number | null; // TMDB/terning e.l., høyere = bedre
	availableProviders?: string[]; // Tjenestenavn filmen finnes på (flatrate)
	source: 'library' | 'list' | 'discover';
}

export interface RankedCandidate extends RecommendCandidate {
	fitsTime: boolean;
	availableOnMyServices: boolean;
	matchedProviders: string[];
}

export interface RankOptions {
	minutes: number;
	providerNames?: string[];
	/** Buffer i minutter utover tilgjengelig tid som fortsatt regnes som «passer». */
	bufferMinutes?: number;
}

function normalizeProvider(s: string): string {
	return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Filtrer bort filmer som er klart for lange, og ranger resten:
 * tilgjengelig-på-mine-tjenester > passer-tiden > rating.
 */
export function rankRecommendations(
	candidates: RecommendCandidate[],
	opts: RankOptions
): RankedCandidate[] {
	const minutes = Math.max(1, opts.minutes);
	const buffer = opts.bufferMinutes ?? 10;
	const mine = new Set((opts.providerNames ?? []).map(normalizeProvider));

	const ranked = candidates
		.map<RankedCandidate>((c) => {
			const runtime = typeof c.runtime === 'number' ? c.runtime : null;
			const fitsTime = runtime == null ? true : runtime <= minutes + buffer;
			const matchedProviders = (c.availableProviders ?? []).filter((p) =>
				mine.has(normalizeProvider(p))
			);
			const availableOnMyServices = mine.size > 0 && matchedProviders.length > 0;
			return { ...c, fitsTime, availableOnMyServices, matchedProviders };
		})
		// Dropp filmer som er vesentlig for lange (mer enn 30 min over)
		.filter((c) => c.runtime == null || c.runtime <= minutes + Math.max(buffer, 30));

	ranked.sort((a, b) => {
		if (a.availableOnMyServices !== b.availableOnMyServices) {
			return a.availableOnMyServices ? -1 : 1;
		}
		if (a.fitsTime !== b.fitsTime) return a.fitsTime ? -1 : 1;
		const ar = a.rating ?? 0;
		const br = b.rating ?? 0;
		if (ar !== br) return br - ar;
		// Stabil sekundærsortering på tittel
		return a.title.localeCompare(b.title, 'nb');
	});

	return ranked;
}
