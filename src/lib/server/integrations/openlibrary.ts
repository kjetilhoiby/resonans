/**
 * OpenLibrary API-integrasjon for forfatter-bibliografi.
 *
 * Brukes til å hente kronologisk verkliste for en forfatter og plassere
 * en bok i forfatterskapet (verk før / etter).
 */

const OPENLIBRARY_BASE = 'https://openlibrary.org';
const DEFAULT_TIMEOUT_MS = 8_000;

export interface OpenLibraryWork {
	key: string;
	title: string;
	firstPublishYear?: number;
	description?: string;
}

export interface AuthorBibliography {
	authorKey: string;
	authorName: string;
	works: OpenLibraryWork[];
	currentBookIndex: number;
}

interface AuthorSearchEntry {
	key?: string;
	name?: string;
	work_count?: number;
	top_work?: string;
}

interface AuthorWorksEntry {
	key?: string;
	title?: string;
	first_publish_date?: string;
	description?: string | { value?: string };
}

async function fetchJson<T>(path: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T | null> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(`${OPENLIBRARY_BASE}${path}`, {
			headers: {
				'User-Agent': 'Resonans/1.0 (+https://resonans.app/contact)',
				Accept: 'application/json'
			},
			signal: controller.signal
		});
		if (!response.ok) return null;
		return (await response.json()) as T;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

function parseYear(raw?: string): number | undefined {
	if (!raw) return undefined;
	const match = raw.match(/\b(1[5-9]\d{2}|20\d{2}|21\d{2})\b/);
	return match ? parseInt(match[1], 10) : undefined;
}

function normalizeTitle(s: string): string {
	return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function extractDescription(raw: AuthorWorksEntry['description']): string | undefined {
	if (!raw) return undefined;
	if (typeof raw === 'string') return raw;
	if (typeof raw === 'object' && typeof raw.value === 'string') return raw.value;
	return undefined;
}

async function findAuthorKey(authorName: string): Promise<{ key: string; name: string } | null> {
	const q = encodeURIComponent(authorName);
	const data = await fetchJson<{ docs?: AuthorSearchEntry[] }>(`/search/authors.json?q=${q}&limit=5`);
	if (!data?.docs?.length) return null;

	const target = normalizeTitle(authorName);
	const ranked = [...data.docs].sort((a, b) => {
		const aMatch = normalizeTitle(a.name ?? '') === target ? 0 : 1;
		const bMatch = normalizeTitle(b.name ?? '') === target ? 0 : 1;
		if (aMatch !== bMatch) return aMatch - bMatch;
		return (b.work_count ?? 0) - (a.work_count ?? 0);
	});

	const best = ranked[0];
	if (!best?.key || !best.name) return null;
	return { key: best.key, name: best.name };
}

async function fetchAuthorWorks(authorKey: string, limit = 200): Promise<OpenLibraryWork[]> {
	const data = await fetchJson<{ entries?: AuthorWorksEntry[] }>(
		`/authors/${authorKey}/works.json?limit=${limit}`
	);
	if (!data?.entries) return [];

	const works = data.entries
		.filter((e) => e.title)
		.map<OpenLibraryWork>((e) => ({
			key: e.key ?? '',
			title: e.title ?? '',
			firstPublishYear: parseYear(e.first_publish_date),
			description: extractDescription(e.description)
		}));

	const seenTitles = new Set<string>();
	const deduped = works.filter((w) => {
		const norm = normalizeTitle(w.title);
		if (seenTitles.has(norm)) return false;
		seenTitles.add(norm);
		return true;
	});

	deduped.sort((a, b) => {
		const ay = a.firstPublishYear ?? 9999;
		const by = b.firstPublishYear ?? 9999;
		return ay - by;
	});

	return deduped;
}

function findCurrentBookIndex(works: OpenLibraryWork[], currentTitle: string): number {
	const target = normalizeTitle(currentTitle);
	const exact = works.findIndex((w) => normalizeTitle(w.title) === target);
	if (exact !== -1) return exact;
	return works.findIndex((w) => {
		const wt = normalizeTitle(w.title);
		return wt.includes(target) || target.includes(wt);
	});
}

export async function fetchAuthorBibliography(
	authorName: string,
	currentTitle: string
): Promise<AuthorBibliography | null> {
	if (!authorName?.trim()) return null;

	const author = await findAuthorKey(authorName);
	if (!author) return null;

	const works = await fetchAuthorWorks(author.key);
	if (works.length === 0) return null;

	const currentBookIndex = findCurrentBookIndex(works, currentTitle);

	return {
		authorKey: author.key,
		authorName: author.name,
		works,
		currentBookIndex
	};
}

export async function fetchWorkSummary(workKey: string): Promise<string | null> {
	const key = workKey.startsWith('/') ? workKey : `/works/${workKey}`;
	const data = await fetchJson<{ description?: string | { value?: string } }>(`${key}.json`);
	return extractDescription(data?.description) ?? null;
}
