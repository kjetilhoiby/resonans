/**
 * research-card — delt type + ren bygger for «kilde-kort» i chatten.
 *
 * Når web_search finner treff, bygger serveren et ResearchCard som rendres som
 * et bunnpanel under assistent-svaret (kilder med favicon/snippet, en bildestripe,
 * og for reise/steds-treff et mini-kart). Speiler event-cards.ts: rammeverk-
 * agnostisk type + byggefunksjon, lagret i message.metadata og rendret av UI.
 */

export interface ResearchSourceLink {
	url: string;
	/** Domenenavn uten www. */
	source: string;
	snippet: string;
	/** Favicon-URL for domenet. */
	favicon: string;
}

export interface ResearchCardMap {
	lat: number;
	lng: number;
	label: string;
}

export interface ResearchCard {
	query: string;
	sources: ResearchSourceLink[];
	images: string[];
	map?: ResearchCardMap | null;
}

const MAX_SOURCES = 6;
const MAX_IMAGES = 4;

/** Favicon-URL for et domene (DuckDuckGo sin ikon-tjeneste — ingen API-nøkkel). */
export function faviconUrl(domain: string): string {
	return `https://icons.duckduckgo.com/ip3/${domain}.ico`;
}

/** Kun http(s)-URL-er slipper gjennom (unngår data:/javascript: i bilde-src). */
function isHttpUrl(url: string): boolean {
	return /^https?:\/\//i.test(url.trim());
}

/**
 * Bygg et ResearchCard fra rå websøk-resultat. Ren funksjon: capper kilder/bilder,
 * legger på favicon, filtrerer bort ugyldige URL-er. Returnerer null hvis det ikke
 * er noe å vise (ingen kilder).
 */
export function buildResearchCard(input: {
	query: string;
	sources: Array<{ url: string; source: string; snippet: string }>;
	images?: string[];
	map?: ResearchCardMap | null;
}): ResearchCard | null {
	const sources: ResearchSourceLink[] = [];
	const seen = new Set<string>();
	for (const s of input.sources) {
		if (!isHttpUrl(s.url) || seen.has(s.url)) continue;
		seen.add(s.url);
		sources.push({
			url: s.url,
			source: s.source,
			snippet: s.snippet,
			favicon: faviconUrl(s.source)
		});
		if (sources.length >= MAX_SOURCES) break;
	}

	if (sources.length === 0) return null;

	const images: string[] = [];
	const seenImg = new Set<string>();
	for (const img of input.images ?? []) {
		if (!isHttpUrl(img) || seenImg.has(img)) continue;
		seenImg.add(img);
		images.push(img);
		if (images.length >= MAX_IMAGES) break;
	}

	return {
		query: input.query,
		sources,
		images,
		map: input.map ?? null
	};
}
