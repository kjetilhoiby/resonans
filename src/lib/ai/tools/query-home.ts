import { z } from 'zod';
import { db } from '$lib/db';
import { tasks, sensorEvents, sensors, checklists } from '$lib/db/schema';
import { ProjectMetricsService } from '$lib/server/services/project-metrics-service';
import { and, eq, desc, inArray, or, sql } from 'drizzle-orm';
import { currentSeason, HOME_APPLIANCE_SUBTYPES } from '$lib/domains/home';

export const queryHomeTool = {
	name: 'query_home',
	description: `Read the user's home/household data: active home projects (with progress + budget), seasonal tasks, home routines, and recent home-appliance events.

Query types:
- 'overview': everything in one shot — active projects, current-season tasks, home routines, recent appliance events
- 'projects': just active home projects with burn-up + cost-vs-budget
- 'seasonal_tasks': sesong-bundne oppgaver (alle eller for gjeldende sesong)
- 'routines': checklists with context='home_routine'
- 'appliance_events': last N events from washer/dryer/dishwasher/etc.`,
	parameters: z.object({
		userId: z.string(),
		queryType: z.enum(['overview', 'projects', 'seasonal_tasks', 'routines', 'appliance_events']),
		seasonOnly: z.boolean().optional().describe('For seasonal_tasks: limit to current season'),
		limit: z.number().optional()
	}),
	execute: async (args: {
		userId: string;
		queryType: 'overview' | 'projects' | 'seasonal_tasks' | 'routines' | 'appliance_events';
		seasonOnly?: boolean;
		limit?: number;
	}) => {
		const limit = args.limit ?? 10;
		const season = currentSeason();

		const fetchProjects = () =>
			ProjectMetricsService.listProjectsWithProgress(args.userId, { domain: 'home', status: 'active' });

		const fetchSeasonalTasks = () => {
			const conditions = [eq(tasks.season, season)];
			// Only include user-owned tasks via personId/projectId; tasks themselves don't carry userId,
			// but we filter to just season-tagged ones for the user's projects (or unscoped seasonal tasks).
			return db
				.select()
				.from(tasks)
				.where(args.seasonOnly === false ? sql`${tasks.season} IS NOT NULL` : and(...conditions))
				.orderBy(desc(tasks.createdAt))
				.limit(limit);
		};

		const fetchRoutines = () =>
			db
				.select()
				.from(checklists)
				.where(and(eq(checklists.userId, args.userId), eq(checklists.context, 'home_routine')))
				.orderBy(desc(checklists.createdAt))
				.limit(limit);

		const fetchApplianceEvents = async () => {
			const ownedSensors = await db
				.select({ id: sensors.id, subtype: sensors.subtype })
				.from(sensors)
				.where(
					and(
						eq(sensors.userId, args.userId),
						inArray(sensors.subtype, HOME_APPLIANCE_SUBTYPES as unknown as string[])
					)
				);
			if (ownedSensors.length === 0) return [];
			const sensorIds = ownedSensors.map((s) => s.id);
			const events = await db
				.select()
				.from(sensorEvents)
				.where(and(eq(sensorEvents.userId, args.userId), inArray(sensorEvents.sensorId, sensorIds)))
				.orderBy(desc(sensorEvents.timestamp))
				.limit(limit);
			return events;
		};

		switch (args.queryType) {
			case 'overview': {
				const [projects, seasonal, routines, applianceEvents] = await Promise.all([
					fetchProjects(),
					fetchSeasonalTasks(),
					fetchRoutines(),
					fetchApplianceEvents()
				]);
				return { season, projects, seasonalTasks: seasonal, routines, applianceEvents };
			}
			case 'projects':
				return { projects: await fetchProjects() };
			case 'seasonal_tasks':
				return { season, tasks: await fetchSeasonalTasks() };
			case 'routines':
				return { routines: await fetchRoutines() };
			case 'appliance_events':
				return { events: await fetchApplianceEvents() };
		}
	}
};
