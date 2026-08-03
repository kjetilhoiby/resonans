import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { loadTrainingDashboardData } from '$lib/server/training-dashboard';
import { resolveThemeDashboardKind } from '$lib/domain/theme-dashboard-registry';
import { and, eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params, locals }) => {
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId))
	});

	if (!theme) {
		return json({ error: 'Tema ikke funnet.' }, { status: 404 });
	}

	if (resolveThemeDashboardKind(theme.name) !== 'training') {
		return json({ error: 'Temaet har ikke treningsdashboard.' }, { status: 400 });
	}

	// evaluateMilestones utelates bevisst: et dashboard-kall skal ikke skrive.
	return json(await loadTrainingDashboardData(locals.userId));
};
