import { openai } from '$lib/server/openai';
import { env } from '$env/dynamic/private';
import { getFullProgram } from './repository';

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
