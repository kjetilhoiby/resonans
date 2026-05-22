/**
 * HTML-side-henting og artikkelekstraksjon med Mozilla Readability.
 *
 * Brukes når Tavily ikke returnerer nok renset innhold (paywalls, tunge
 * norske aviser), eller når book_research-toolet trenger å lese en spesifikk
 * URL grundig.
 */

import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

export interface ExtractedPage {
	url: string;
	title: string;
	text: string;
	publishedAt?: string;
	siteName?: string;
	ok: boolean;
	error?: string;
}

interface FetchOptions {
	timeoutMs?: number;
	maxBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 1_500_000;

export async function fetchAndExtract(
	url: string,
	opts: FetchOptions = {}
): Promise<ExtractedPage> {
	const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(url, {
			headers: {
				'User-Agent': 'Resonans/1.0 (+https://resonans.app/contact)',
				Accept: 'text/html,application/xhtml+xml',
				'Accept-Language': 'no,nb,nn,en;q=0.7'
			},
			signal: controller.signal,
			redirect: 'follow'
		});

		if (!response.ok) {
			return { url, title: '', text: '', ok: false, error: `HTTP ${response.status}` };
		}

		const buf = await response.arrayBuffer();
		if (buf.byteLength > maxBytes) {
			return { url, title: '', text: '', ok: false, error: `Page too large (${buf.byteLength}b)` };
		}

		const html = new TextDecoder('utf-8').decode(buf);
		const dom = new JSDOM(html, { url });
		const reader = new Readability(dom.window.document);
		const article = reader.parse();

		if (!article || !article.textContent) {
			return { url, title: '', text: '', ok: false, error: 'Readability returned null' };
		}

		const text = article.textContent.replace(/\s+/g, ' ').trim();
		const meta = dom.window.document;
		const publishedAt =
			meta.querySelector('meta[property="article:published_time"]')?.getAttribute('content') ??
			meta.querySelector('time[datetime]')?.getAttribute('datetime') ??
			undefined;
		const siteName =
			meta.querySelector('meta[property="og:site_name"]')?.getAttribute('content') ??
			new URL(url).hostname.replace(/^www\./, '');

		return {
			url,
			title: article.title ?? '',
			text,
			publishedAt,
			siteName,
			ok: true
		};
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { url, title: '', text: '', ok: false, error: msg };
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Hent og ekstraher flere sider parallelt med begrenset samtidighet.
 */
export async function fetchAndExtractMany(
	urls: string[],
	opts: FetchOptions & { concurrency?: number } = {}
): Promise<ExtractedPage[]> {
	const concurrency = opts.concurrency ?? 4;
	const results: ExtractedPage[] = [];
	const queue = [...urls];

	async function worker() {
		while (queue.length > 0) {
			const next = queue.shift();
			if (!next) return;
			const result = await fetchAndExtract(next, opts);
			results.push(result);
		}
	}

	const workers = Array.from({ length: Math.min(concurrency, urls.length) }, () => worker());
	await Promise.all(workers);
	return results;
}
