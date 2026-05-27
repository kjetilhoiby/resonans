import { env } from '$env/dynamic/private';
import { openai } from '$lib/server/openai';
import {
	PROGRAM_LIMITS,
	RUN_TYPES,
	STRENGTH_EXERCISES,
	STRENGTH_EXERCISE_NAMES
} from './constants';
import { validateAndNormalizeProgram } from './validator';
import type { GenerateProgramInput, ProgramDTO } from './types';

const PROMPT_VERSION = '2026-05-ekko-hybrid-v1';
const DEFAULT_MODEL = 'gpt-4o';

export class ProgramGenerationError extends Error {
	readonly cause?: unknown;
	constructor(message: string, cause?: unknown) {
		super(message);
		this.name = 'ProgramGenerationError';
		this.cause = cause;
	}
}

export async function generateProgram(input: GenerateProgramInput): Promise<{
	program: ProgramDTO;
	model: string;
}> {
	const model = env.EKKO_PROGRAM_MODEL?.trim() || DEFAULT_MODEL;

	const includeStrength = input.includeStrength !== false;
	const includeRunning = input.includeRunning !== false;
	if (!includeStrength && !includeRunning) {
		throw new ProgramGenerationError('Minst én av includeStrength/includeRunning må være true');
	}

	const durationWeeks = clamp(
		input.durationWeeks ?? 8,
		PROGRAM_LIMITS.minDurationWeeks,
		PROGRAM_LIMITS.maxDurationWeeks
	);
	const sessionsPerWeek = clamp(
		input.sessionsPerWeek ?? (includeStrength && includeRunning ? 4 : 3),
		PROGRAM_LIMITS.minSessionsPerWeek,
		PROGRAM_LIMITS.maxSessionsPerWeek
	);

	const systemPrompt = buildSystemPrompt();
	const userPrompt = buildUserPrompt({
		goal: input.goal,
		durationWeeks,
		sessionsPerWeek,
		runningKmPerWeek: input.runningKmPerWeek,
		experience: input.experience,
		includeStrength,
		includeRunning,
		startDate: input.startDate,
		name: input.name
	});

	let raw: string;
	try {
		const completion = await openai.chat.completions.create({
			model,
			temperature: 0.4,
			response_format: { type: 'json_object' },
			messages: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: userPrompt }
			]
		});
		raw = completion.choices[0]?.message?.content ?? '';
	} catch (err) {
		throw new ProgramGenerationError(
			err instanceof Error ? `LLM-kall feilet: ${err.message}` : 'LLM-kall feilet',
			err
		);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		throw new ProgramGenerationError('LLM returnerte ugyldig JSON', err);
	}

	const program = validateAndNormalizeProgram(parsed, {
		expectedDurationWeeks: durationWeeks,
		expectedSessionsPerWeek: sessionsPerWeek,
		includeStrength,
		includeRunning
	});

	if (input.name) {
		program.name = input.name;
	}
	program.generatedWith = {
		model,
		promptVersion: PROMPT_VERSION,
		generatedAt: new Date().toISOString(),
		inputs: {
			goal: input.goal,
			durationWeeks,
			sessionsPerWeek,
			runningKmPerWeek: input.runningKmPerWeek,
			experience: input.experience,
			includeStrength,
			includeRunning
		}
	};

	return { program, model };
}

function buildSystemPrompt(): string {
	const exerciseLines = STRENGTH_EXERCISES.map((e) => {
		const modeStr = e.mode === 'reps' ? 'reps-basert' : 'tidsbasert (sekunder)';
		const weight = e.allowsWeight ? ', kan ha weightHint' : ', vektløs';
		return `- "${e.name}" — ${modeStr}${weight}`;
	}).join('\n');

	return `Du er en treningsprogram-generator for hybride treningsprogrammer (styrke + løping).
Du svarer ALLTID med et JSON-objekt som matcher schemaet nedenfor. Ingen prosa, ingen markdown.

═══════════════════════════════════════════════════════════════════════════
HARD CONSTRAINTS — Bryt ALDRI disse:
═══════════════════════════════════════════════════════════════════════════

TILLATTE STYRKEØVELSER (nøyaktige navn — ingen andre):
${exerciseLines}

TILLATTE LØPSØKT-TYPER (nøyaktige verdier):
- "easy"      — rolig løp, distance eller duration, lav intensitet
- "tempo"     — tempo-økt, vanligvis varighet på tempo-delen + warmup/cooldown
- "intervals" — intervaller, må ha "intervals"-array med reps × (distance eller duration) + rest
- "long"      — langtur, distance eller duration, rolig tempo

═══════════════════════════════════════════════════════════════════════════
SCHEMA (returner nøyaktig denne strukturen som JSON):
═══════════════════════════════════════════════════════════════════════════

{
  "name": "kort navn på programmet",
  "goal": "brukerens mål, parafrasert",
  "durationWeeks": <heltall>,
  "sessionsPerWeek": <heltall>,
  "startDate": "YYYY-MM-DD",
  "weeks": [
    {
      "weekNumber": <1-basert>,
      "deload": <bool>,
      "notes": "valgfri ukenotat",
      "sessions": [
        {
          "dayNumber": <1=mandag .. 7=søndag>,
          "kind": "strength" | "run",
          "name": "f.eks. Styrke A eller Rolig 5k",
          "restSeconds": <kun for strength, hvile mellom sett>,
          "notes": "valgfritt",

          // For kind=strength:
          "plannedExercises": [
            {
              "exerciseName": "et av de tillatte navnene",
              "sets": <1-${PROGRAM_LIMITS.maxSetsPerExercise}>,
              "repsTarget": <1-${PROGRAM_LIMITS.maxRepsTarget} for reps-baserte>,
              "durationSecondsTarget": <1-${PROGRAM_LIMITS.maxDurationSecondsTarget} for tidsbaserte>,
              "weightHint": "valgfri fritekst som 'kroppsvekt' eller '10kg'"
            }
          ],

          // For kind=run:
          "plannedRun": {
            "runType": "easy" | "tempo" | "intervals" | "long",
            "targetDistanceMeters": <heltall, valgfri>,
            "targetDurationSeconds": <heltall, valgfri>,
            "intervals": [{ "reps": N, "distanceMeters": M, "restSeconds": S }],
            "warmupSeconds": <valgfri>,
            "cooldownSeconds": <valgfri>,
            "paceHintSecPerKm": <valgfri, kun hvis brukeren har gitt nivå>,
            "hrZoneHint": "Z2 / Z3 / Z4-Z5 (valgfri)"
          }
        }
      ]
    }
  ]
}

═══════════════════════════════════════════════════════════════════════════
REGLER FOR PROGRAMMET:
═══════════════════════════════════════════════════════════════════════════

1. Antall uker: produser nøyaktig durationWeeks uker.
2. Antall økter per uke: ca sessionsPerWeek per uke (kan justeres ±1 ved deload).
3. Deload-uker: hvis durationWeeks > 4, sett deload=true for hver 4. uke (uke 4, 8, ...) med redusert volum.
4. Maks ${PROGRAM_LIMITS.maxStrengthSessionsPerWeek} styrkeøkter per uke.
5. Aldri styrke samme dag som hard løpsøkt (tempo/intervals). Easy/long kan kombineres hvis nødvendig, men foretrekk separate dager.
6. dayNumber må være unik innenfor en uke (1-7, mandag-søndag).
7. Progresjon over uker:
   - Reps-baserte øvelser: øk reps med 1-2 per uke (innen grensene), eller behold og legg til vekt-hint hvis tillatt.
   - Tidsbaserte øvelser: øk durationSecondsTarget med 5-10 sekunder per uke.
   - Løp: øk distance/duration gradvis (5-10% per uke), deload-uker reduserer til ~70% av forrige uke.
8. Hvis kun løp (includeStrength=false): bygg en rendyrket løpeplan med variasjon (easy/tempo/intervals/long).
9. Hvis kun styrke (includeRunning=false): bygg styrkeplan med 2-3 økter/uke, varier øvelsesfokus.
10. paceHintSecPerKm og hrZoneHint er VALGFRIE — utelat dem hvis brukeren ikke har spesifisert nivå/erfaring.
11. Hvis brukeren ikke har spesifisert volum, bruk fornuftige defaults (f.eks. easy ~5-8 km, long ~10-15 km, tempo 20-30 min).
12. Bruk norske navn på øvelser og økter.

Returner KUN JSON. Ikke wrap i \`\`\`json. Ikke kommenter.`;
}

function buildUserPrompt(args: {
	goal: string;
	durationWeeks: number;
	sessionsPerWeek: number;
	runningKmPerWeek?: number;
	experience?: 'beginner' | 'intermediate' | 'advanced';
	includeStrength: boolean;
	includeRunning: boolean;
	startDate?: string;
	name?: string;
}): string {
	const lines: string[] = [];
	lines.push(`Brukerens mål: ${args.goal}`);
	lines.push(`Varighet: ${args.durationWeeks} uker`);
	lines.push(`Økter per uke: ${args.sessionsPerWeek}`);
	if (args.runningKmPerWeek) {
		lines.push(`Nåværende løpsvolum: ~${args.runningKmPerWeek} km/uke`);
	}
	if (args.experience) {
		lines.push(`Erfaringsnivå: ${args.experience}`);
	}
	const types: string[] = [];
	if (args.includeStrength) types.push('styrke');
	if (args.includeRunning) types.push('løping');
	lines.push(`Inkluder: ${types.join(' + ')}`);
	if (args.startDate) {
		lines.push(`Startdato: ${args.startDate}`);
	}
	if (args.name) {
		lines.push(`Foreslått navn: ${args.name}`);
	}
	lines.push('');
	lines.push(`Generer programmet nå. Husk: kun de tillatte styrkeøvelsene (${STRENGTH_EXERCISE_NAMES.join(', ')}) og løpsøkt-typene (${RUN_TYPES.join(', ')}).`);
	return lines.join('\n');
}

function clamp(n: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, Math.round(n)));
}
