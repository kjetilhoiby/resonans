/**
 * Ren formattering av «LANGSIKTIG RETNING»-blokken i chat-konteksten.
 * Skilt ut fra ContextService så logikken kan enhetstestes uten DB.
 */

import { buildMilestoneBlock, type Milestone } from '$lib/domain/goals/milestone';
import {
	buildPriorityBlock,
	type ResolvedDeprioritization
} from '$lib/domains/livskompass/deprioritization';

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
 * Bygger retningsblokken: visjoner per horisont, brukerens verdier, oppnådde
 * milepæler (ferske som tema, eldre som bakgrunn) og — når retningen er
 * brukerforfattet — en instruks om å konfrontere gap mellom uttalt retning og det
 * hverdagen (mål, planer, refleksjoner) viser.
 *
 * Rekkefølgen er en påstand om hva som skal leses FØR dommen om hva som
 * spriker: prosaen, verdiene, de bevisste prioriteringene, og milepælene som
 * sier hva som alt er oppnådd. Gap-notatet kommer sist, fordi det er dommen.
 *
 * `extras` er et objekt og ikke flere posisjonelle argumenter: da den tredje
 * samlingen kom, var alternativet fire valgfrie parametere på rad der to av dem
 * er lister — og et kallsted som bytter om på to lister får ingen feil.
 */
export interface DirectionExtras {
	/** Oppnådde mål. Ferske er tema, eldre er bakgrunn. */
	milestones?: Milestone[];
	/** Bevisste, tidsavgrensede nedprioriteringer fra livskompasset. */
	deprioritizations?: ResolvedDeprioritization[];
	now?: Date;
}

export function buildDirectionBlock(
	visions: DirectionVision[],
	valuesMemories: string[] = [],
	gapNote?: string,
	extras: DirectionExtras = {}
): string {
	const withSummary = visions.filter((v) => v.summary?.trim());
	// Milepælene alene bærer ikke en retningsblokk: uten prosa eller verdier er det
	// bare en liste oppnåelser, og da er instruksen om å ikke gratulere det eneste
	// som står der. De henger på at det finnes en retning å tolke dem mot.
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

	out += buildPriorityBlock(extras.deprioritizations ?? []);
	out += buildMilestoneBlock(extras.milestones ?? [], extras.now ?? new Date());

	if (gapNote?.trim()) {
		out += `\nKJENTE GAP (fra siste retningssamtale):\n${gapNote.trim()}\n`;
	}

	const hasAuthored = sorted.some((v) => v.originKind === 'user_authored');
	if (hasAuthored) {
		out +=
			'\nDette er brukerens egne, bekreftede formuleringer om hvem han vil være — ikke AI-gjetninger. ' +
			'Din jobb er å være ærlig, ikke behagelig: når mål, planer, dagens drøm eller refleksjoner i denne prompten ' +
			'spriker fra retningen eller verdiene, pek på gapet eksplisitt og still ett ubehagelig oppfølgingsspørsmål. ' +
			'Ikke pakk inn — men konfrontasjonen skal komme fra varme, ikke distanse: vis at du ser hva brukeren står i, ' +
			'og utfordre fordi retningen er hans egen og du vil at den skal bli virkelig. ' +
			'Bruk query-verktøyene når du trenger tall for å underbygge konfrontasjonen. ' +
			'Visjonene over er destillater — hele intervjuet og retningssamtalene finnes i fulltekst via ' +
			"query_reflections (kind 'livsintervju_chat' / 'retningssamtale'); hent dem når brukerens egne ord trengs.\n";
	}

	out += '--- SLUTT PÅ VISJON ---\n';
	return out;
}
