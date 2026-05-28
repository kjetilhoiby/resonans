import { env } from '$env/dynamic/private';
import { openai } from '$lib/server/openai';
import {
	PROGRAM_LIMITS,
	RUN_TYPES,
	STRENGTH_EXERCISES,
	STRENGTH_EXERCISE_NAMES
} from './constants';
import { validateAndNormalizeProgram } from './validator';
import type { AthleteSnapshotForGenerator, GenerateProgramInput, ProgramDTO } from './types';

const PROMPT_VERSION = '2026-05-ekko-hybrid-v1.1';
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

	const includeBaselineTests = input.includeBaselineTests === true;
	// Bestem startdato deterministisk (default i dag) og hvilken ukedag den faller på,
	// slik at uke 1 kan «fylle resten» av kalenderuka fra og med startdagen.
	const startDate =
		input.startDate && /^\d{4}-\d{2}-\d{2}$/.test(input.startDate)
			? input.startDate
			: new Date().toISOString().slice(0, 10);
	const startDayNumber = ((new Date(startDate + 'T00:00:00Z').getUTCDay() + 6) % 7) + 1;
	const systemPrompt = buildSystemPrompt(includeBaselineTests);
	const userPrompt = buildUserPrompt({
		goal: input.goal,
		durationWeeks,
		sessionsPerWeek,
		runningKmPerWeek: input.runningKmPerWeek,
		experience: input.experience,
		includeStrength,
		includeRunning,
		startDate,
		startDayNumber,
		name: input.name,
		includeBaselineTests,
		athleteSnapshot: input.athleteSnapshot
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
		includeRunning,
		startDate
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
			includeRunning,
			includeBaselineTests,
			athleteSnapshotDataQuality: input.athleteSnapshot?.dataQuality
		}
	};

	return { program, model };
}

function buildSystemPrompt(includeBaselineTests: boolean): string {
	const exerciseLines = STRENGTH_EXERCISES.map((e) => {
		const modeStr = e.mode === 'reps' ? 'reps-basert' : 'tidsbasert (sekunder)';
		const weight = e.allowsWeight ? ', kan ha weightHint' : ', vektløs';
		return `- "${e.name}" — ${modeStr}${weight}`;
	}).join('\n');

	const testInstructions = includeBaselineTests
		? `
═══════════════════════════════════════════════════════════════════════════
TEST-ØKTER (denne genereringen krever baseline-tester):
═══════════════════════════════════════════════════════════════════════════

I uke 1: legg inn nøyaktig én løps-test OG én styrke-test som separate økter.
Disse skal IKKE telle mot ordinære økter (de er tilleggsøkter).
Marker test-økter med:
  "isTest": true,
  "testType": <en av nedenstående>

Tillatte testType-verdier:
  Løp:    "cooper_12min" (12 min max-distanse, kind=run, plannedRun.runType="tempo")
          "time_5k"      (5k tempo time-trial, kind=run, plannedRun.runType="tempo")
          "time_10k"     (10k time-trial, kind=run, plannedRun.runType="long")
  Styrke: "amrap_utfall"      (AMRAP Utfall, ett sett, repsTarget=1)
          "amrap_armhevinger" (AMRAP Armhevinger, ett sett, repsTarget=1)
          "amrap_taahevinger" (AMRAP Tåhevinger, ett sett, repsTarget=1)
          "max_planke"        (Max hold Planke, ett sett, durationSecondsTarget=1)

For test-økter: bruk repsTarget=1 / durationSecondsTarget=1 som signal til klienten
om at "1" betyr "så mye du klarer" (AMRAP / max). IKKE bruk "Sakte senking
fra pullup-stang" som test (skadefare).

Hvis durationWeeks ≥ 8: legg også inn én test-økt i deload-uken (uke 4 eller 8)
som retest av samme type som uke 1 — bruker da samme testType-verdi.
`
		: '';

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
6. dayNumber må være unik innenfor en uke og angir EKTE ukedag: 1=mandag, 2=tirsdag, ..., 7=søndag. Plasser harde økter/langturer på dagene som faktisk passer (f.eks. langtur i helg = dayNumber 6/7). Uke 1 kan være en delvis uke hvis programmet starter midt i uka — se startdato-instruksen.
7. Progresjon over uker:
   - Reps-baserte øvelser: øk reps med 1-2 per uke (innen grensene), eller behold og legg til vekt-hint hvis tillatt.
   - Tidsbaserte øvelser: øk durationSecondsTarget med 5-10 sekunder per uke.
   - Løp: øk distance/duration gradvis (5-10% per uke), deload-uker reduserer til ~70% av forrige uke.
8. Hvis kun løp (includeStrength=false): bygg en rendyrket løpeplan med variasjon (easy/tempo/intervals/long).
9. Hvis kun styrke (includeRunning=false): bygg styrkeplan med 2-3 økter/uke, varier øvelsesfokus.
10. paceHintSecPerKm og hrZoneHint er VALGFRIE — utelat dem hvis brukeren ikke har spesifisert nivå/erfaring.
11. **Styrkeøkter skal ALLTID inneholde alle 5 tillatte styrkeøvelser.** Hver styrkeøkt
    har samtlige 5 navn — variér kun reps/sets/tid mellom øktene og over uker,
    ikke utvalget. Dette gir helhetlig progresjon på alle øvelser.
12. **Løpsdistanser skal skaleres mot brukerens observerte volum:**
    - Hvis recentVolumeKm er kjent, skal LONGEST run i uke 1 være ≤ 60% av
      recentVolumeKm (en 13 km/uke-løper får maks ~8 km langtur).
    - Vanlige easy/tempo-økter: 3–6 km. Intervall-økter: total volum 4–7 km.
    - Volum-progresjon i løpet av programmet: maks +5–10% per uke,
      capet ved 1.3× initial volum.
    - Prioriter FARTSPROGRESJON (paceHintSecPerKm faller 2–5 sek/km per uke
      på tempo/intervaller) fremfor distansevekst når brukeren har lavt volum
      (< 20 km/uke).
13. Hvis brukeren ikke har spesifisert volum, bruk fornuftige defaults
    (easy ~4 km, tempo ~3 km, intervaller 4 × 800 m, long ~6–8 km).
14. Bruk norske navn på øvelser og økter.
15. Hvis en athlete-snapshot er gitt: bruk den til å sette REALISTISKE targets.
    - rich data: bruk PR-er og paceZones direkte. Easy = paceZones.easySecPerKm,
      tempo ≈ tempoSecPerKm, intervaller ≈ intervalSecPerKm.
    - thin data: vær konservativ. Volum start = 70% av recentVolumeKm.
    - none: ingen paceHintSecPerKm i det hele tatt. Bruk hrZoneHint som veiledning.
16. Styrke-baseline i snapshot: hvis brukerens AMRAP for en øvelse er kjent, sett
    uke 1 repsTarget til ~70% av AMRAP. F.eks. AMRAP Armhevinger=15 → repsTarget=10.
    Hvis ikke kjent, bruk defaults: Utfall 3×10, Armhevinger 3×8, Planke 3×30s,
    Tåhevinger 3×15, Sakte senking 3×8s. Øk reps/tid 1-2 per uke i ikke-deload.
${testInstructions}
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
	startDayNumber?: number;
	name?: string;
	includeBaselineTests: boolean;
	athleteSnapshot?: AthleteSnapshotForGenerator;
}): string {
	const lines: string[] = [];
	lines.push(`Brukerens mål: ${args.goal}`);
	lines.push(`Varighet: ${args.durationWeeks} uker`);
	lines.push(`Økter per uke: ${args.sessionsPerWeek}`);
	if (args.runningKmPerWeek) {
		lines.push(`Nåværende løpsvolum (oppgitt): ~${args.runningKmPerWeek} km/uke`);
	}
	if (args.experience) {
		lines.push(`Erfaringsnivå: ${args.experience}`);
	}
	const types: string[] = [];
	if (args.includeStrength) types.push('styrke');
	if (args.includeRunning) types.push('løping');
	lines.push(`Inkluder: ${types.join(' + ')}`);
	if (args.startDate) {
		const dayNames = ['mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'];
		const sd = args.startDayNumber;
		if (sd && sd >= 1 && sd <= 7) {
			lines.push(`Startdato: ${args.startDate} (${dayNames[sd - 1]}, dayNumber=${sd})`);
			if (sd > 1) {
				lines.push(
					`VIKTIG — uke 1 er en DELVIS uke: programmet starter på ${dayNames[sd - 1]}, ` +
						`så uke 1 skal KUN inneholde økter med dayNumber mellom ${sd} og 7 ` +
						`(altså ${dayNames[sd - 1]}–søndag). Fordel et redusert antall økter på disse ` +
						`gjenværende dagene. Fra og med uke 2 er det fulle uker (dayNumber 1–7, mandag–søndag).`
				);
			}
		} else {
			lines.push(`Startdato: ${args.startDate}`);
		}
	}
	if (args.name) {
		lines.push(`Foreslått navn: ${args.name}`);
	}

	if (args.athleteSnapshot) {
		lines.push('');
		lines.push('━━━ Athlete-snapshot (faktiske observerte data) ━━━');
		lines.push(`Datakvalitet: ${args.athleteSnapshot.dataQuality}`);
		if (args.athleteSnapshot.recentVolumeKm != null) {
			lines.push(`Observert løpsvolum siste 4 uker: ${args.athleteSnapshot.recentVolumeKm} km/uke`);
		}
		if (args.athleteSnapshot.recentSessionsPerWeek != null) {
			lines.push(`Observerte økter/uke siste 4 uker: ${args.athleteSnapshot.recentSessionsPerWeek}`);
		}
		const be = args.athleteSnapshot.bestEfforts;
		if (be) {
			const parts: string[] = [];
			for (const key of ['1k', '3k', '5k', '10k'] as const) {
				const v = be[key];
				if (typeof v === 'number') parts.push(`${key}=${formatSeconds(v)}`);
			}
			if (parts.length) lines.push(`Beste tider siste 90 dager: ${parts.join(', ')}`);
		}
		if (args.athleteSnapshot.vdotEstimate) {
			lines.push(`Estimert VDOT: ${args.athleteSnapshot.vdotEstimate}`);
		}
		if (args.athleteSnapshot.paceZones) {
			const p = args.athleteSnapshot.paceZones;
			const fmtP = (v?: number) => (v != null ? formatPace(v) : '–');
			lines.push(
				`Anbefalte tempo-soner (min/km): easy ${fmtP(p.easySecPerKm)}, marathon ${fmtP(p.marathonSecPerKm)}, tempo ${fmtP(p.tempoSecPerKm)}, interval ${fmtP(p.intervalSecPerKm)}`
			);
		}
		if (args.athleteSnapshot.strengthBaseline) {
			const sb = args.athleteSnapshot.strengthBaseline;
			const parts: string[] = [];
			for (const [name, v] of Object.entries(sb)) {
				if (v.reps != null) parts.push(`${name} AMRAP=${v.reps}`);
				if (v.durationSeconds != null) parts.push(`${name} max=${v.durationSeconds}s`);
			}
			if (parts.length) lines.push(`Styrke-baseline: ${parts.join(', ')}`);
		}
	}

	if (args.includeBaselineTests) {
		lines.push('');
		lines.push('Legg inn baseline-tester i uke 1 (Cooper 12 min eller 5k-tt + minst én styrketest).');
	}

	lines.push('');
	lines.push(`Generer programmet nå. Husk: kun de tillatte styrkeøvelsene (${STRENGTH_EXERCISE_NAMES.join(', ')}) og løpsøkt-typene (${RUN_TYPES.join(', ')}).`);
	return lines.join('\n');
}

function formatSeconds(s: number): string {
	const m = Math.floor(s / 60);
	const r = Math.round(s - m * 60);
	return `${m}:${r.toString().padStart(2, '0')}`;
}

function formatPace(secPerKm: number): string {
	return formatSeconds(secPerKm);
}

function clamp(n: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, Math.round(n)));
}
