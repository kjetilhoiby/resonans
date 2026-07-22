/**
 * og-tags.ts — henter en lenke og leser OpenGraph/meta-tagger for
 * lenke-forhåndsvisning. Brukt av funn-triagen: Instagram (og de fleste
 * sider) serverer og:title / og:description / og:image til slike
 * bot-forespørsler. Degraderer grasiøst — returnerer null ved feil, så
 * triagen kan lande funnet med bare lenka.
 */

const FETCH_TIMEOUT_MS = 10000;

export interface LinkPreview {
	url: string;
	title: string | null;
	description: string | null;
	image: string | null;
	siteName: string | null;
}

// Fanger en http(s)-URL. Hale-tegnsetting (punktum, komma, parentes) fjernes
// etterpå — vanlig når lenka står i løpende e-posttekst.
const URL_RE = /https?:\/\/[^\s<>"')\]]+/i;

/** Finn første URL i en tekst (typisk e-postkroppen eller emnet). */
export function extractFirstUrl(text: string | null | undefined): string | null {
	if (!text) return null;
	const m = text.match(URL_RE);
	if (!m) return null;
	return m[0].replace(/[.,;:!?)\]]+$/, '');
}

function decodeEntities(s: string): string {
	return s
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#0?39;|&apos;/g, "'")
		.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
		.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number.parseInt(d, 10)));
}

function metaContent(html: string, key: string): string | null {
	const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	// Matcher både property="og:x" og name="og:x", uansett attributt-rekkefølge.
	const patterns = [
		new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*\\bcontent=["']([^"']*)["']`, 'i'),
		new RegExp(`<meta[^>]+\\bcontent=["']([^"']*)["'][^>]*(?:property|name)=["']${k}["']`, 'i')
	];
	for (const re of patterns) {
		const m = html.match(re);
		if (m) {
			const val = decodeEntities(m[1]).trim();
			if (val) return val;
		}
	}
	return null;
}

/** Parse OpenGraph/meta-tagger fra rå HTML. Ren funksjon — enhetstestbar. */
export function parseLinkPreview(html: string, url: string): LinkPreview {
	const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	return {
		url,
		title: metaContent(html, 'og:title') ?? (titleTag ? decodeEntities(titleTag[1]).trim() || null : null),
		description: metaContent(html, 'og:description') ?? metaContent(html, 'description'),
		image: metaContent(html, 'og:image') ?? metaContent(html, 'og:image:url'),
		siteName: metaContent(html, 'og:site_name')
	};
}

/** Hent lenka og les meta-taggene. Returnerer null ved nettverks-/HTTP-feil. */
export async function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
	if (!/^https?:\/\//i.test(url)) return null;
	try {
		const res = await fetch(url, {
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			headers: {
				// Bot-UA som en lenke-forhåndsvisning — Instagram serverer OG-tagger til denne.
				'User-Agent': 'facebookexternalhit/1.1 (+https://resonans.app)',
				Accept: 'text/html,application/xhtml+xml',
				'Accept-Language': 'nb-NO,nb;q=0.9,en;q=0.6'
			}
		});
		if (!res.ok) return null;
		const html = await res.text();
		return parseLinkPreview(html, url);
	} catch {
		return null;
	}
}
