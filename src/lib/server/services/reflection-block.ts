/**
 * Ren formattering av «SISTE REFLEKSJONER»-blokken i chat-konteksten.
 * Skilt ut fra ContextService så logikken kan enhetstestes uten DB.
 *
 * To vern mot prompt-bloat: rå transkripter (arkiv, kan være svært lange)
 * holdes helt utenfor, og hver refleksjon trunkeres. Fulltekst hentes ved
 * behov via query_reflections-verktøyet — oppsummeringen er indeks,
 * ikke erstatning.
 */

/** Arkiv-kinds som aldri skal dumpes inline i systemprompten. */
export const TRANSCRIPT_REFLECTION_KINDS: readonly string[] = [
	'livsintervju_chat',
	'livsintervju_kilde', // rått innlimt materiale (f.eks. Balanse-tråden) — kan være svært langt
	'birthday_interview_chat',
	'retningssamtale',
	'birthday_photos' // JSON-blob, ikke prosa
];

export interface ReflectionRow {
	kind: string;
	content: string;
	createdAt: Date;
}

export function buildReflectionsBlock(
	rows: ReflectionRow[],
	opts: { maxCharsPerReflection?: number; maxRows?: number } = {}
): string {
	const maxChars = opts.maxCharsPerReflection ?? 700;
	const maxRows = opts.maxRows ?? 6;

	const kept = rows
		.filter((r) => !TRANSCRIPT_REFLECTION_KINDS.includes(r.kind) && r.content?.trim())
		.slice(0, maxRows);
	if (kept.length === 0) return '';

	let out = '\n--- SISTE REFLEKSJONER ---\n';
	for (const ref of kept) {
		const dateStr = ref.createdAt.toISOString().slice(0, 10);
		const content =
			ref.content.length > maxChars
				? `${ref.content.slice(0, maxChars).trimEnd()} … [forkortet]`
				: ref.content;
		out += `[${ref.kind} · ${dateStr}] ${content}\n`;
	}
	out += '--- SLUTT PÅ REFLEKSJONER ---\n';
	return out;
}
