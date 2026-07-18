/**
 * Ren logikk for hodedump-flyten («Tøm hodet»): plasseringer fra triage-steget,
 * landings-oppsummering og refleksjonsprompt. Flow-definisjonen bor i registry.ts,
 * persistering i /api/floker/complete.
 */

export type HodedumpDecision = 'floke' | 'idag' | 'parker' | 'slipp';

export const HODEDUMP_DECISION_OPTIONS: Array<{ value: HodedumpDecision; label: string }> = [
	{ value: 'floke', label: '🪢 Floke' },
	{ value: 'idag', label: '☑️ I dag' },
	{ value: 'parker', label: '📥 Parker' },
	{ value: 'slipp', label: '🕊️ Slipp' }
];

export interface HodedumpPlacements {
	floker: string[];
	idag: string[];
	parkert: string[];
	sluppet: string[];
}

/** Les plasseringer ut av flowData (triage_items-snapshot + decisions). */
export function hodedumpPlacements(data: Record<string, unknown>): HodedumpPlacements {
	const items = Array.isArray(data['triage_items'])
		? (data['triage_items'] as Array<{ id: string; text: string }>)
		: [];
	const decisions = (data['decisions'] ?? {}) as Record<string, string>;

	const out: HodedumpPlacements = { floker: [], idag: [], parkert: [], sluppet: [] };
	for (const item of items) {
		switch (decisions[item.id]) {
			case 'floke':
				out.floker.push(item.text);
				break;
			case 'idag':
				out.idag.push(item.text);
				break;
			case 'slipp':
				out.sluppet.push(item.text);
				break;
			default:
				out.parkert.push(item.text);
		}
	}
	return out;
}

/** Antall punkter totalt i triagen. */
export function hodedumpPointCount(p: HodedumpPlacements): number {
	return p.floker.length + p.idag.length + p.parkert.length + p.sluppet.length;
}

/** Landings-oppsummering: «12 punkter ut av hodet: …». */
export function hodedumpSummary(
	p: HodedumpPlacements,
	valgtFloke: string | null,
	flokeStegCount: number
): string {
	const total = hodedumpPointCount(p);
	if (total === 0) return 'Ingen punkter denne gangen.';

	const parts: string[] = [];
	if (p.floker.length > 0) {
		const rest = valgtFloke ? p.floker.length - 1 : p.floker.length;
		if (valgtFloke) {
			parts.push(
				`1 floke under nedbryting («${valgtFloke}»${flokeStegCount > 0 ? `, ${flokeStegCount} første steg` : ''})`
			);
		}
		if (rest > 0) parts.push(`${rest} floke${rest === 1 ? '' : 'r'} lagt som prosjekt`);
	}
	if (p.idag.length > 0) parts.push(`${p.idag.length} til i dag`);
	if (p.parkert.length > 0) parts.push(`${p.parkert.length} parkert i innboksen`);
	if (p.sluppet.length > 0) parts.push(`${p.sluppet.length} sluppet`);

	return `${total} punkt${total === 1 ? '' : 'er'} ut av hodet: ${parts.join(', ')}.`;
}

/** Select-options for «hvilken floke vil du løsne nå?». */
export function hodedumpFlokeOptions(
	data: Record<string, unknown>
): Array<{ value: string; label: string }> {
	return hodedumpPlacements(data).floker.map((text) => ({ value: text, label: text }));
}

/** Prompt + systemprompt for landings-refleksjonen. */
export function hodedumpReflectionPrompts(data: Record<string, unknown>): {
	prompt: string;
	systemPrompt: string;
} {
	const placements = hodedumpPlacements(data);
	const valgtFloke = typeof data['valgtFloke'] === 'string' && data['valgtFloke'] ? data['valgtFloke'] : null;
	const steg = valgtFloke && Array.isArray(data['selectedTasks']) ? (data['selectedTasks'] as string[]) : [];
	const summary = hodedumpSummary(placements, valgtFloke, steg.length);

	return {
		prompt: `Jeg har tømt hodet. ${summary}`,
		systemPrompt: `Du er en varm, kort samtalepartner. Brukeren har nettopp gjennomført en hodedump-øvelse: tømt hodet for alt som surret, sortert punktene og gitt hvert av dem en plass (floke-prosjekt, dagens liste, innboks-parkering, eller sluppet).

Målet med øvelsen var å gå fra «fullt hode» til «tomt hode». Din jobb er LANDINGEN:
1. Bekreft kort at alt har fått en plass — punktene er trygt lagret og kan hentes frem igjen. Ikke ramse opp listen; brukeren har nettopp sett den.
2. Still ETT spørsmål: «Hvordan kjennes hodet nå?» (eller en naturlig variant).
3. Etter brukerens svar: speil kort og avslutt varmt. Ikke dra samtalen ut — dette skal være en landing, ikke en ny økt.

Strenge regler: ingen råd, ingen nye oppgaver, ingen oppfølgingsplaner. Maks 2–3 setninger per svar. Norsk.`
	};
}
