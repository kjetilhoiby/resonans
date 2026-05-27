import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateProgram, ProgramGenerationError } from '$lib/server/programs/generator';
import { getFullProgram, saveGeneratedProgram } from '$lib/server/programs/repository';
import { ProgramValidationError } from '$lib/server/programs/validator';
import { PROGRAM_LIMITS } from '$lib/server/programs/constants';
import { buildAthleteSnapshot, snapshotForPersistence } from '$lib/server/programs/athlete-context';

interface GenerateBody {
	goal?: unknown;
	durationWeeks?: unknown;
	sessionsPerWeek?: unknown;
	runningKmPerWeek?: unknown;
	experience?: unknown;
	includeStrength?: unknown;
	includeRunning?: unknown;
	startDate?: unknown;
	name?: unknown;
	includeBaselineTests?: unknown;
	useAthleteSnapshot?: unknown;
}

export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: GenerateBody;
	try {
		body = (await request.json()) as GenerateBody;
	} catch {
		throw error(400, 'Invalid JSON body');
	}

	const goal = typeof body.goal === 'string' ? body.goal.trim() : '';
	if (!goal) throw error(400, 'Missing "goal" field');

	const includeStrength = body.includeStrength === false ? false : true;
	const includeRunning = body.includeRunning === false ? false : true;
	if (!includeStrength && !includeRunning) {
		throw error(400, 'Minst én av includeStrength/includeRunning må være true');
	}

	const durationWeeks = parseIntInRange(
		body.durationWeeks,
		PROGRAM_LIMITS.minDurationWeeks,
		PROGRAM_LIMITS.maxDurationWeeks
	);
	const sessionsPerWeek = parseIntInRange(
		body.sessionsPerWeek,
		PROGRAM_LIMITS.minSessionsPerWeek,
		PROGRAM_LIMITS.maxSessionsPerWeek
	);

	const experience = body.experience === 'beginner' || body.experience === 'intermediate' || body.experience === 'advanced'
		? body.experience
		: undefined;

	const startDate = typeof body.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.startDate)
		? body.startDate
		: undefined;

	const includeBaselineTests = body.includeBaselineTests === true;
	const useSnapshot = body.useAthleteSnapshot !== false; // default true
	const snapshot = useSnapshot ? await buildAthleteSnapshot(userId) : undefined;

	try {
		const { program, model } = await generateProgram({
			goal,
			durationWeeks,
			sessionsPerWeek,
			runningKmPerWeek: typeof body.runningKmPerWeek === 'number' ? body.runningKmPerWeek : undefined,
			experience,
			includeStrength,
			includeRunning,
			startDate,
			name: typeof body.name === 'string' ? body.name.trim() || undefined : undefined,
			includeBaselineTests,
			athleteSnapshot: snapshot
				? {
						dataQuality: snapshot.dataQuality,
						recentVolumeKm: snapshot.recentVolumeKm,
						recentSessionsPerWeek: snapshot.recentSessionsPerWeek,
						bestEfforts: snapshot.bestEfforts,
						vdotEstimate: snapshot.vdotEstimate,
						paceZones: snapshot.paceZones,
						strengthBaseline: Object.fromEntries(
							Object.entries(snapshot.strengthBaseline).map(([k, v]) => [
								k,
								{ reps: v.reps, durationSeconds: v.durationSeconds }
							])
						)
					}
				: undefined
		});

		const persistedBaseline = snapshot ? snapshotForPersistence(snapshot) : null;
		const programId = await saveGeneratedProgram(userId, program, persistedBaseline);
		const full = await getFullProgram(userId, programId);

		return json({
			ok: true,
			programId,
			model,
			program: full,
			snapshot: snapshot
				? {
						dataQuality: snapshot.dataQuality,
						vdotEstimate: snapshot.vdotEstimate,
						recentVolumeKm: snapshot.recentVolumeKm
					}
				: null
		});
	} catch (err) {
		if (err instanceof ProgramValidationError) {
			console.error('[programs/generate] validation failed', err.issues);
			return json(
				{
					error: 'LLM produced invalid program',
					code: 'program_validation_failed',
					issues: err.issues
				},
				{ status: 422 }
			);
		}
		if (err instanceof ProgramGenerationError) {
			console.error('[programs/generate]', err);
			return json(
				{
					error: err.message,
					code: 'program_generation_failed'
				},
				{ status: 502 }
			);
		}
		console.error('[programs/generate] unexpected', err);
		return json(
			{
				error: err instanceof Error ? err.message : 'Generation failed',
				code: 'internal_error'
			},
			{ status: 500 }
		);
	}
};

function parseIntInRange(value: unknown, min: number, max: number): number | undefined {
	if (value === undefined || value === null) return undefined;
	const n = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(n)) return undefined;
	return Math.max(min, Math.min(max, Math.round(n)));
}
