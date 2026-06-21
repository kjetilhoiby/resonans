import { openai } from '$lib/server/openai';
import { env } from '$env/dynamic/private';
import { getFullProgram } from './repository';
import { getRecentAdaptations } from './adaptive-service';
import { formatAdaptationsForPrompt } from './adaptive';
import type { CoachTurn } from './coach-conversation';

/**
 * Fri-tekst coach for Ekko («Spør coachen» + etter-økt-vurdering).
 * Tar en ferdig prompt fra klienten og svarer med kort, talevennlig norsk tekst.
 *
 * To prompt-typer treffer dette:
 *  1. Brukerens egne spørsmål (kort).
 *  2. Etter-økt-vurdering — en lengre, ferdigbygd prompt med per-drag-data + plan.
 *
 * `programId` er valgfri kontekst-peker. Når den er satt og tilhører brukeren,
 * legger vi et kompakt program-sammendrag til prompten. Når den er null (typisk
 * etter-økt-vurdering) ligger all nødvendig data allerede i prompten.
 */

export class ProgramCoachError extends Error {
	constructor(message: string, readonly cause?: unknown) {
		super(message);
		this.name = 'ProgramCoachError';
	}
}

const DEFAULT_MODEL = 'gpt-4o-mini';
const model = () => env.EKKO_COACH_MODEL?.trim() || DEFAULT_MODEL;

const SYSTEM_PROMPT = `Du er en erfaren, varm løpetrener som svarer brukeren direkte på norsk.

Stil:
- Korte, talevennlige svar (kan leses høyt). Ren tekst, INGEN markdown, ingen punktlister med tegn.
- Konkret og oppmuntrende, men ærlig. 3-5 setninger med mindre prompten ber om noe annet.
- Bruk KUN tall og fakta som står i prompten/konteksten. Aldri dikt opp pace, puls eller distanser.
- Unngå ordene «skjema», «idealtempo» og «idealfart».
- Hvis du mangler data for å svare presist, si det kort framfor å gjette.`;

/**
 * Samtalepartner-variant brukt i tråd-modus (vedvarende samtale). Mer åpen enn
 * trener-prompten over, men holder på de samme stil-reglene: kort, talevennlig, ingen
 * markdown, ingen oppdiktede tall. Bygger eksplisitt på det som er sagt før i tråden.
 */
const CONVERSATION_SYSTEM_PROMPT = `Du er en innsiktsfull, varm og talevennlig norsk samtalepartner. Svaret ditt leses høyt.

Stil:
- Korte svar (det leses høyt). Ren tekst, INGEN markdown, ingen punktlister med tegn.
- Bygg på det som er sagt tidligere i samtalen — referer gjerne til forrige tur når det er naturlig.
- Konkret og ærlig. Bruk KUN tall og fakta som står i samtalen eller konteksten; aldri dikt opp.
- Hvis du mangler data for å svare presist, si det kort framfor å gjette.
- Unngå ordet «ekko».`;

/** Kompakt program-kontekst for fritekst-spørsmål (utelates for etter-økt-vurderinger). */
async function buildProgramContext(userId: string, programId: string): Promise<string | null> {
	const program = await getFullProgram(userId, programId);
	if (!program) return null;

	const all = program.weeks.flatMap((w) => w.sessions);
	const completed = all.filter((s) => s.completion).length;
	const lines = [
		`Program: ${program.name}`,
		`Mål: ${program.goal}`,
		`Varighet: ${program.durationWeeks} uker, ${program.sessionsPerWeek} økter/uke`,
		`Fullført: ${completed} av ${all.length} økter`
	];

	if (program.mode === 'adaptiv') {
		lines.push(
			'Modus: adaptiv — planen justeres ukentlig etter faktisk trening (tempo, dagplassering, volum). Uken vurderes på samlet effort på tvers av løp/styrke/sykkel, ikke på enkeltøkter som ble hoppet over.'
		);
		const adaptations = await getRecentAdaptations(userId, programId, 5);
		const block = formatAdaptationsForPrompt(adaptations);
		if (block) lines.push(block);
	}

	return lines.join('\n');
}

export async function runProgramCoach(
	userId: string,
	prompt: string,
	programId?: string | null
): Promise<{ text: string }> {
	const messages: Array<{ role: 'system' | 'user'; content: string }> = [
		{ role: 'system', content: SYSTEM_PROMPT }
	];

	if (programId) {
		try {
			const context = await buildProgramContext(userId, programId);
			if (context) {
				messages.push({
					role: 'user',
					content: `Kontekst om brukerens program:\n${context}`
				});
			}
		} catch (error) {
			// Kontekst er "nice to have" — la spørsmålet gå videre uten den hvis oppslaget feiler.
			console.error('[program-coach] kunne ikke bygge programkontekst:', error);
		}
	}

	messages.push({ role: 'user', content: prompt });

	return callCoach(messages);
}

export interface CoachConversationTurnInput {
	userId: string;
	/** Brukerens nye ytring (lagres av kalleren som en user-tur). */
	prompt: string;
	/** Valgfri program-peker — legger til kompakt program-kontekst, som i statsløs modus. */
	programId?: string | null;
	/** Tidligere turer i tråden, kronologisk (allerede klippet til kontekst-vinduet). */
	history: CoachTurn[];
	/** Antall eldre turer som ble utelatt fra `history` (for en kort norsk notis til modellen). */
	droppedCount?: number;
	/** Efemær situasjonskontekst (live-metrikk). Injiseres for DENNE turen, lagres ALDRI. */
	context?: string | null;
}

/**
 * Kjør én tur i en vedvarende coach-samtale. Bygger LLM-kontekst av (i rekkefølge):
 * samtalepartner-system-prompt → valgfri program-kontekst → trunkerings-notis → trådhistorikk
 * → efemær situasjonskontekst → brukerens nye ytring. Kalleren eier persisteringen av turene.
 */
export async function runCoachConversationTurn(
	input: CoachConversationTurnInput
): Promise<{ text: string }> {
	const { userId, prompt, programId, history, droppedCount = 0, context } = input;

	const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
		{ role: 'system', content: CONVERSATION_SYSTEM_PROMPT }
	];

	if (programId) {
		try {
			const programContext = await buildProgramContext(userId, programId);
			if (programContext) {
				messages.push({ role: 'user', content: `Kontekst om brukerens program:\n${programContext}` });
			}
		} catch (error) {
			// Kontekst er "nice to have" — la turen gå videre uten den hvis oppslaget feiler.
			console.error('[program-coach] kunne ikke bygge programkontekst:', error);
		}
	}

	if (droppedCount > 0) {
		messages.push({
			role: 'system',
			content: `Tidligere i samtalen: ${droppedCount} eldre ${droppedCount === 1 ? 'melding' : 'meldinger'} er utelatt for å spare plass.`
		});
	}

	for (const turn of history) {
		messages.push({ role: turn.role, content: turn.text });
	}

	// Efemær situasjonskontekst injiseres rett før den nye ytringen, men lagres aldri som en tur.
	const ephemeral = typeof context === 'string' ? context.trim() : '';
	if (ephemeral) {
		messages.push({
			role: 'system',
			content: `Situasjonskontekst akkurat nå (kan endre seg, ikke lagret): ${ephemeral}`
		});
	}

	messages.push({ role: 'user', content: prompt });

	return callCoach(messages);
}

/** Felles LLM-kall + tom-svar-vakt for både statsløs og tråd-modus. */
async function callCoach(
	messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
): Promise<{ text: string }> {
	try {
		const response = await openai.chat.completions.create({
			model: model(),
			messages,
			temperature: 0.5,
			// Romslig nok til etter-økt-vurderinger med flere setninger — kapp ikke for hardt.
			max_tokens: 500
		});
		const text = response.choices[0]?.message?.content?.trim();
		if (!text) {
			throw new ProgramCoachError('Tomt svar fra LLM');
		}
		return { text };
	} catch (error) {
		if (error instanceof ProgramCoachError) throw error;
		throw new ProgramCoachError('LLM-kall feilet', error);
	}
}
