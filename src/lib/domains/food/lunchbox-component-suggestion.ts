// Ren normalisering + filtrering av AI-forslag til nye matpakke-komponenter.
// Ingen DB-/nettverkskobling, så det kan enhetstestes uten mocking.

import { KIND_META, type ComponentKind } from './lunchbox';

export type SuggestedComponent = {
	name: string;
	kind: ComponentKind;
	tags: string[];
	reason: string | null;
};

const VALID_KINDS = Object.keys(KIND_META) as ComponentKind[];

function norm(s: string): string {
	return s.toLowerCase().trim();
}

/**
 * Gjør modellens JSON om til en trygg forslagsliste:
 * - kun gyldige kinds
 * - dropper forslag som allerede finnes i biblioteket (case-insensitivt)
 * - dropper alt som treffer «avoid» (allergier) — hardt filter
 * - dedup innad i forslaget
 * - respekterer valgfritt kind-filter
 */
export function normalizeComponentSuggestions(
	parsed: unknown,
	opts: { existingNames: string[]; avoid?: string[]; kind?: ComponentKind | null; limit?: number }
): SuggestedComponent[] {
	const rawList = Array.isArray(parsed)
		? parsed
		: Array.isArray((parsed as { suggestions?: unknown })?.suggestions)
			? (parsed as { suggestions: unknown[] }).suggestions
			: [];

	const existing = new Set(opts.existingNames.map(norm));
	const avoid = (opts.avoid ?? []).map(norm).filter(Boolean);
	const seen = new Set<string>();
	const result: SuggestedComponent[] = [];

	for (const raw of rawList) {
		if (!raw || typeof raw !== 'object') continue;
		const r = raw as Record<string, unknown>;
		const name = typeof r.name === 'string' ? r.name.trim() : '';
		if (!name) continue;
		const key = norm(name);

		const kind = (typeof r.kind === 'string' ? r.kind.trim() : '') as ComponentKind;
		if (!VALID_KINDS.includes(kind)) continue;
		if (opts.kind && kind !== opts.kind) continue;

		if (existing.has(key) || seen.has(key)) continue;
		// Allergi-filter: dropp hvis navnet inneholder et allergen (eller omvendt).
		if (avoid.some((a) => key.includes(a) || a.includes(key))) continue;

		seen.add(key);
		result.push({
			name,
			kind,
			tags: Array.isArray(r.tags) ? (r.tags as unknown[]).map((t) => String(t).trim().toLowerCase()).filter(Boolean) : [],
			reason: typeof r.reason === 'string' && r.reason.trim() ? r.reason.trim() : null
		});
		if (opts.limit && result.length >= opts.limit) break;
	}

	return result;
}
