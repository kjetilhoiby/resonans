import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getFullProgram } from '$lib/server/programs/repository';
import { evaluateProgramReadiness } from '$lib/server/programs/readiness';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.userId) throw error(401, 'Unauthorized');
	let program;
	try {
		program = await getFullProgram(locals.userId, params.id);
	} catch (err) {
		console.error('[treningsprogram/:id] getFullProgram feilet', err);
		throw error(503, 'Programmer-tabellen er ikke synkronisert ennå. Prøv igjen om noen sekunder.');
	}
	if (!program) throw error(404, 'Program ikke funnet');

	let readiness = null;
	try {
		const assessment = await evaluateProgramReadiness({
			userId: locals.userId,
			programId: params.id
		});
		readiness = {
			state: assessment.state,
			reasons: assessment.reasons,
			signals: assessment.signals,
			alternative: assessment.alternative,
			hasPlannedSession: !!assessment.plannedSession,
			plannedSessionId: assessment.plannedSession?.id ?? null,
			date: assessment.plannedSessionDate
		};
	} catch (err) {
		console.error('[treningsprogram/:id] readiness-evaluering feilet', err);
	}

	return { program, readiness };
};
