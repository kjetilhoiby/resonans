/**
 * Ren formattering av «LANGSIKTIG RETNING»-blokken i chat-konteksten.
 * Skilt ut fra ContextService så logikken kan enhetstestes uten DB.
 */

export interface DirectionVision {
	kind: string;
	summary: string;
	originKind?: string | null;
}

const HORIZON_ORDER = ['vision_10year', 'vision_5year', 'vision_yearly', 'vision_quarterly'];

const HORIZON_LABELS: Record<string, string> = {
	vision_10year: '10 år frem',
	vision_5year: '5 år frem',
	vision_yearly: 'i år',
	vision_quarterly: 'kommende kvartal'
};

export function horizonLabel(kind: string): string {
	return HORIZON_LABELS[kind] ?? kind;
}

/**
 * Bygger retningsblokken: visjoner per horisont, brukerens verdier, og — når
 * retningen er brukerforfattet — en instruks om å konfrontere gap mellom
 * uttalt retning og det hverdagen (mål, planer, refleksjoner) viser.
 */
export function buildDirectionBlock(
	visions: DirectionVision[],
	valuesMemories: string[] = [],
	gapNote?: string
): string {
	const withSummary = visions.filter((v) => v.summary?.trim());
	if (withSummary.length === 0 && valuesMemories.length === 0) return '';

	const sorted = [...withSummary].sort(
		(a, b) => HORIZON_ORDER.indexOf(a.kind) - HORIZON_ORDER.indexOf(b.kind)
	);

	let out = '\n--- LANGSIKTIG RETNING (visjon) ---\n';
	for (const v of sorted) {
		const suffix = v.originKind === 'user_authored' ? '' : ' (AI-utkast)';
		out += `[${horizonLabel(v.kind)}]${suffix} ${v.summary.trim()}\n`;
	}

	if (valuesMemories.length > 0) {
		out += '\nVERDIER (brukerens egne, bekreftede ord):\n';
		for (const value of valuesMemories) out += `- ${value}\n`;
	}

	if (gapNote?.trim()) {
		out += `\nKJENTE GAP (fra siste retningssamtale):\n${gapNote.trim()}\n`;
	}

	const hasAuthored = sorted.some((v) => v.originKind === 'user_authored');
	if (hasAuthored) {
		out +=
			'\nDette er brukerens egne, bekreftede formuleringer om hvem han vil være — ikke AI-gjetninger. ' +
			'Din jobb er å være ærlig, ikke behagelig: når mål, planer, dagens drøm eller refleksjoner i denne prompten ' +
			'spriker fra retningen eller verdiene, pek på gapet eksplisitt og still ett ubehagelig oppfølgingsspørsmål. ' +
			'Ikke pakk inn. Bruk query-verktøyene når du trenger tall for å underbygge konfrontasjonen.\n';
	}

	out += '--- SLUTT PÅ VISJON ---\n';
	return out;
}
