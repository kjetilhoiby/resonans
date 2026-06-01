import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getFullProgram } from '$lib/server/programs/repository';
import { evaluateProgramReadiness } from '$lib/server/programs/readiness';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.userId) throw error(401, 'Unauthorized');
	const t0 = performance.now();

	const [programResult, readinessResult] = await Promise.allSettled([
		getFullProgram(locals.userId, params.id),
		evaluateProgramReadiness({ userId: locals.userId, programId: params.id })
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

	console.log(`[perf][treningsprogram/:id] user=${locals.userId} step=total ms=${(performance.now() - t0).toFixed(0)} cached=${readiness ? readinessResult.status === 'fulfilled' && (readinessResult.value as any).cached : 'n/a'}`);
	return { program, readiness };
};
