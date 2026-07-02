/**
 * Siste forsvarslinje mot at verktøy-args lekker inn i det synlige chat-svaret.
 * Prompt-guardrails skal hindre at modellen skriver rå JSON i teksten, men hvis den
 * likevel gjør det (f.eks. {"personName":"Anita"}), fjerner vi det her før svaret
 * lagres og sendes.
 */
export function stripToolLeakage(text: string): string {
	if (!text) return text;

	// Fjern flate JSON-objekt-blobber (typiske verktøy-args). Bevisst kun objekter,
	// ikke arrays — arrays/braketter er vanligere i legitim prosa/markdown.
	const stripJson = (s: string) =>
		s.replace(/\{[^{}]*\}/g, (match) => {
			try {
				const value = JSON.parse(match);
				return value && typeof value === 'object' && !Array.isArray(value) ? '' : match;
			} catch {
				return match;
			}
		});

	const lines: string[] = [];
	for (const line of text.split('\n')) {
		const hadContent = line.trim().length > 0;
		const cleaned = stripJson(line)
			.replace(/[ \t]{2,}/g, ' ')
			.replace(/[ \t]+([.,!?])/g, '$1')
			.trimEnd();
		// Linje som hadde innhold men nå er tom (bare JSON) droppes helt.
		// Opprinnelig tomme linjer beholdes (bevarer avsnitt).
		if (hadContent && cleaned.trim().length === 0) continue;
		lines.push(cleaned);
	}

	return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
