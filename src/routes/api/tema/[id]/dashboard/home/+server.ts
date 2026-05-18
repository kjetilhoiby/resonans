import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themes, tasks, sensorEvents, sensors, checklists } from '$lib/db/schema';
import { resolveThemeDashboardKind } from '$lib/domain/theme-dashboard-registry';
import { and, eq, desc, inArray } from 'drizzle-orm';
import { ProjectMetricsService } from '$lib/server/services/project-metrics-service';
import { currentSeason, HOME_APPLIANCE_SUBTYPES } from '$lib/domains/home';

export const GET: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, userId))
	});
	if (!theme) return json({ error: 'Tema ikke funnet.' }, { status: 404 });
	if (resolveThemeDashboardKind(theme.name) !== 'home') {
		return json({ error: 'Temaet har ikke hjem-dashboard.' }, { status: 400 });
	}

	const season = currentSeason();

	const [activeProjects, seasonalTasks, routines, ownedSensors] = await Promise.all([
		ProjectMetricsService.listProjectsWithProgress(userId, { domain: 'home', status: 'active' }),
		db
			.select()
			.from(tasks)
			.where(eq(tasks.season, season))
			.orderBy(desc(tasks.createdAt))
			.limit(20),
		db
			.select()
			.from(checklists)
			.where(and(eq(checklists.userId, userId), eq(checklists.context, 'home_routine')))
			.orderBy(desc(checklists.createdAt))
			.limit(10),
		db
			.select({ id: sensors.id })
			.from(sensors)
			.where(
				and(
					eq(sensors.userId, userId),
					inArray(sensors.subtype, HOME_APPLIANCE_SUBTYPES as unknown as string[])
				)
			)
	]);

	let applianceEvents: Array<{ id: string; dataType: string | null; timestamp: Date; data: unknown }> = [];
	if (ownedSensors.length > 0) {
		const sensorIds = ownedSensors.map((s) => s.id);
		applianceEvents = await db
			.select({
				id: sensorEvents.id,
				dataType: sensorEvents.dataType,
				timestamp: sensorEvents.timestamp,
				data: sensorEvents.data
			})
			.from(sensorEvents)
			.where(and(eq(sensorEvents.userId, userId), inArray(sensorEvents.sensorId, sensorIds)))
			.orderBy(desc(sensorEvents.timestamp))
			.limit(10);
	}

	return json({
		projects: activeProjects.map((p) => ({
			id: p.id,
			title: p.title,
			description: p.description,
			domain: p.domain,
			type: p.type,
			status: p.status,
			metadata: (p.metadata ?? {}) as Record<string, unknown>,
			progress: p.progress
		})),
		seasonalTasks: seasonalTasks.map((t) => ({
			id: t.id,
			title: t.title,
			season: t.season,
			recurrenceYearly: t.recurrenceYearly,
			status: t.status
		})),
		routines: routines.map((r) => ({
			id: r.id,
			title: r.title,
			emoji: r.emoji,
			completedAt: r.completedAt
		})),
		applianceEvents: applianceEvents.map((e) => ({
			id: e.id,
			dataType: e.dataType ?? '',
			timestamp: e.timestamp,
			data: e.data
		}))
	});
};
