/**
 * Utdrag rundt første treff for søkeresultater i chatten.
 *
 * Ren og testbar: klipper et vindu rundt første case-insensitive forekomst av
 * søketermen og flagger selve treffet, slik at UI-et kan markere det (<mark>).
 * Ingen regex bygges fra brukerinput — kun `toLowerCase().indexOf`.
 */

export interface SnippetPart {
	text: string;
	hit: boolean;
}

/**
 * Bygger et utdrag på inntil ~2×`radius` tegn rundt første treff, med «…» i endene
 * når teksten er kuttet. Uten treff returneres starten av teksten som ett segment.
 */
export function buildSearchSnippet(content: string, query: string, radius = 60): SnippetPart[] {
	const trimmed = content.replace(/\s+/g, ' ').trim();
	const q = query.trim();
	const idx = q ? trimmed.toLowerCase().indexOf(q.toLowerCase()) : -1;

	if (idx === -1) {
		const head = trimmed.slice(0, radius * 2);
		return [{ text: head + (trimmed.length > head.length ? '…' : ''), hit: false }];
	}

	const start = Math.max(0, idx - radius);
	const end = Math.min(trimmed.length, idx + q.length + radius);

	const parts: SnippetPart[] = [];
	const prefix = (start > 0 ? '…' : '') + trimmed.slice(start, idx);
	if (prefix) parts.push({ text: prefix, hit: false });
	parts.push({ text: trimmed.slice(idx, idx + q.length), hit: true });
	const suffix = trimmed.slice(idx + q.length, end) + (end < trimmed.length ? '…' : '');
	if (suffix) parts.push({ text: suffix, hit: false });
	return parts;
}
