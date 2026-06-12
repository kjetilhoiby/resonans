import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getFullProgram } from '$lib/server/programs/repository';
import { evaluateProgramReadiness } from '$lib/server/programs/readiness';
import { getRecentAdaptations } from '$lib/server/programs/adaptive-service';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.userId) throw error(401, 'Unauthorized');
	const t0 = performance.now();

	const [programResult, readinessResult, adaptationsResult] = await Promise.allSettled([
		getFullProgram(locals.userId, params.id),
		evaluateProgramReadiness({ userId: locals.userId, programId: params.id }),
		getRecentAdaptations(locals.userId, params.id)
	]);

	if (programResult.status === 'rejected') {
		console.error('[treningsprogram/:id] getFullProgram feilet', programResult.reason);
		throw error(503, 'Programmer-tabellen er ikke synkronisert ennå. Prøv igjen om noen sekunder.');
	}
	const program = programResult.value;
	if (!program) throw error(404, 'Program ikke funnet');

	let readiness = null;
	if (readinessResult.status === 'fulfilled') {
		const assessment = readinessResult.value;
		readiness = {
			state: assessment.state,
			reasons: assessment.reasons,
			signals: assessment.signals,
			alternative: assessment.alternative,
			hasPlannedSession: !!assessment.plannedSession,
			plannedSessionId: assessment.plannedSession?.id ?? null,
			date: assessment.plannedSessionDate
		};
	} else {
		console.error('[treningsprogram/:id] readiness-evaluering feilet', readinessResult.reason);
	}

	let adaptations: Awaited<ReturnType<typeof getRecentAdaptations>> = [];
	if (adaptationsResult.status === 'fulfilled') {
		adaptations = adaptationsResult.value;
	} else {
		console.error('[treningsprogram/:id] henting av justeringer feilet', adaptationsResult.reason);
	}

	console.log(`[perf][treningsprogram/:id] user=${locals.userId} step=total ms=${(performance.now() - t0).toFixed(0)} cached=${readiness ? readinessResult.status === 'fulfilled' && (readinessResult.value as any).cached : 'n/a'}`);
	return { program, readiness, adaptations };
};
