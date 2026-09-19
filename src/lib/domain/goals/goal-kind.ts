/**
 * Målart: noe du KONTROLLERER selv, eller noe du kan LEGGE TIL RETTE FOR.
 *
 * ## Hvorfor skillet må finnes
 *
 * Brukerens egen formulering: noen mål har man kontroll over selv (vekt,
 * bevegelse, skjermtid, økonomiske disposisjoner), mens andre kan man bare legge
 * til rette for (ny jobb, endret tillit hos kone, mer aktive vennskap).
 *
 * Fram til september 2026 kjente datamodellen bare den første arten.
 * `createLongTermGoal` sin metrikk-mapping dekker vekt, 5/10 km-tid, hvilepuls,
 * belastning, kroppssammensetning og sparing — alt sammen tall man selv kan
 * flytte. Alt annet falt til kategorien «Retning» uten metrikk og havnet i den
 * kollapsede **«Uten måling»**-skuffen på /plan/mal. Det er nettopp der jobbmålet
 * ble usynlig.
 *
 * Og navnet på skuffen var problemet i seg selv: «uten måling» er en påstand om
 * OSS — vi fant ingen metrikk — presentert som en egenskap ved MÅLET. Den
 * halvdelen av livet brukeren sier betyr mest, ble strukturelt degradert av en
 * etikett.
 *
 * ## Løsningen er ikke en metrikk for tillit
 *
 * Et tilrettelagt mål måles på **betingelsene du setter opp**, ikke på utfallet.
 * «Mer aktive vennskap» er ikke målbart; «ta initiativ til én ting i måneden» er
 * det, og er den ærlige ledende indikatoren.
 *
 * Mekanismen finnes fra før og er ikke ny lagring: en OPPGAVE under målet med
 * `frequency` og `targetValue`, registrert med `record_tracking_event`. Denne
 * modulen sier bare hvordan den skal LESES — og at et tilrettelagt mål aldri
 * skal få en framdriftsprosent regnet av utfallet, siden utfallet ikke er ditt.
 */

/** `kontrollert`: du flytter tallet selv. `tilrettelagt`: du lager betingelsene. */
export type GoalKind = 'kontrollert' | 'tilrettelagt';

export const GOAL_KIND_LABELS: Record<GoalKind, string> = {
	kontrollert: 'Du styrer det selv',
	tilrettelagt: 'Du legger til rette'
};

export interface GoalKindShape {
	metadata?: unknown;
	tasks?: Array<{
		frequency?: string | null;
		targetValue?: number | null;
		status?: string;
		progress?: Array<{ value?: number | null }> | null;
	}>;
}

/** Arten brukeren har SATT, om noen. Aldri en gjetning. */
export function readGoalKind(metadata: unknown): GoalKind | null {
	if (!metadata || typeof metadata !== 'object') return null;
	const raw = (metadata as Record<string, unknown>).goalKind;
	return raw === 'kontrollert' || raw === 'tilrettelagt' ? raw : null;
}

function hasMetric(metadata: unknown): boolean {
	if (!metadata || typeof metadata !== 'object') return false;
	const meta = metadata as Record<string, unknown>;
	if (typeof meta.metricId === 'string' && meta.metricId.length > 0) return true;
	const track = meta.goalTrack;
	return Boolean(track && typeof track === 'object' && 'targetValue' in track);
}

/**
 * Utledet art — og den gjetter ALDRI `tilrettelagt`.
 *
 * En metrikk beviser at målet er kontrollert: noen har oppgitt et tall man selv
 * flytter. Fravær av metrikk beviser ingenting. Et mål uten tall kan like gjerne
 * være et kontrollert mål noen ikke har gjort ferdig («gå ned i vekt», uten
 * målvekt) som et ekte tilrettelagt mål.
 *
 * Å gjette her ville vært samme feil som `startWorkout.type` sin stille default:
 * en KONKRET verdi satt inn der sannheten er «ikke oppgitt». Derfor null, og
 * flaten SPØR framfor å sortere målet inn i en bås det kanskje ikke hører i.
 */
export function inferGoalKind(goal: GoalKindShape): GoalKind | null {
	return hasMetric(goal.metadata) ? 'kontrollert' : null;
}

/** Satt art vinner over utledet. Null betyr «ikke avgjort ennå». */
export function resolveGoalKind(goal: GoalKindShape): GoalKind | null {
	return readGoalKind(goal.metadata) ?? inferGoalKind(goal);
}

/* ── Den ledende indikatoren ─────────────────────────────────────────────── */

export interface LeadingIndicator {
	title: string;
	frequency: string;
	targetValue: number | null;
	/** Registrerte runder så langt, summert fra `progress`. */
	done: number;
}

/**
 * Den ledende indikatoren, lest av målets egne oppgaver.
 *
 * Ingen ny lagring: en frekvens-oppgave ER indikatoren. Finnes flere, vinner den
 * FØRSTE aktive — en liste med to «ledende» indikatorer er ikke en indikator,
 * og valget hører hos brukeren, ikke i en sorteringsregel her.
 */
export function readLeadingIndicator(goal: GoalKindShape): LeadingIndicator | null {
	const task = (goal.tasks ?? []).find(
		(t) => typeof t.frequency === 'string' && t.frequency.length > 0 && t.status !== 'completed'
	);
	if (!task) return null;
	const done = (task.progress ?? []).reduce((sum, p) => sum + (p?.value ?? 0), 0);
	return {
		title: (task as { title?: string }).title ?? '',
		frequency: task.frequency as string,
		targetValue: typeof task.targetValue === 'number' ? task.targetValue : null,
		done
	};
}

/* ── Gruppering på flaten ────────────────────────────────────────────────── */

export type GoalGroup =
	/** Har en metrikk eller en satt art med tall — framdrift kan regnes. */
	| 'kontrollert'
	/** Tilrettelagt, med en ledende indikator å følge. */
	| 'tilrettelagt'
	/** Tilrettelagt, men ingen indikator ennå — det ENESTE som mangler noe. */
	| 'mangler-indikator'
	/** Arten er ikke avgjort. Flaten spør; den sorterer ikke bort. */
	| 'uavklart';

/**
 * Hvilken bås målet hører i på /plan/mal.
 *
 * `mangler-indikator` og `uavklart` erstatter den gamle «Uten måling»-skuffen.
 * Forskjellen er ikke kosmetisk: begge sier hva som MANGLER og kan handles på,
 * mens «uten måling» var en dom uten en handling ved siden av seg.
 */
export function groupGoal(goal: GoalKindShape): GoalGroup {
	const kind = resolveGoalKind(goal);
	if (kind === 'kontrollert') return 'kontrollert';
	if (kind === 'tilrettelagt') {
		return readLeadingIndicator(goal) ? 'tilrettelagt' : 'mangler-indikator';
	}
	return 'uavklart';
}

/* ── Ord ─────────────────────────────────────────────────────────────────── */

/**
 * Linja som følger målet inn i chat-konteksten.
 *
 * Den sier ikke bare hvilken art målet er — den sier hva det BETYR for hvordan
 * modellen skal snakke om det. Uten den halvdelen leser modellen «tilrettelagt»
 * som en etikett og fortsetter å spørre om framdrift mot utfallet, som er
 * nettopp det brukeren ikke har kontroll over.
 */
export function describeGoalKindForPrompt(goal: GoalKindShape): string | null {
	const kind = resolveGoalKind(goal);
	if (kind === 'kontrollert') return null; // normalen — en linje her ville vært støy

	if (kind === 'tilrettelagt') {
		const indicator = readLeadingIndicator(goal);
		if (!indicator) {
			return 'Art: tilrettelagt — utfallet er ikke brukerens å styre, og det finnes ingen ledende indikator ennå. Spør hva hen kan GJØRE jevnlig som legger til rette for det, og foreslå det som en frekvens-oppgave.';
		}
		const mot = indicator.targetValue !== null ? ` (${indicator.done} av ${indicator.targetValue})` : '';
		return `Art: tilrettelagt — måles på det brukeren GJØR, ikke på utfallet. Ledende indikator: «${indicator.title}», ${indicator.frequency}${mot}. Snakk om denne; ikke be om framdrift mot selve utfallet, og ikke gjør manglende utfall til noe hen har mislyktes med.`;
	}

	return 'Art: ikke avklart — vi vet ikke om dette er noe brukeren styrer selv eller bare kan legge til rette for. Ta det opp hvis målet er tema, men ikke gjett.';
}
