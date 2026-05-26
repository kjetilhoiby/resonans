import { db } from '$lib/db';
import { tasks, sensorEvents, sensors, checklists } from '$lib/db/schema';
import { ProjectMetricsService } from '$lib/server/services/project-metrics-service';
import { currentSeason, HOME_APPLIANCE_SUBTYPES, HOME_APPLIANCE_LABELS, type HomeApplianceSubtype, pingApplianceEmoji } from '$lib/domains/home';
import { and, eq, desc, inArray } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.userId;
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
			.select({ id: sensors.id, subtype: sensors.subtype, name: sensors.name })
			.from(sensors)
			.where(
				and(
					eq(sensors.userId, userId),
					inArray(sensors.subtype, HOME_APPLIANCE_SUBTYPES as unknown as string[])
				)
			)
	]);

	const appliances: Array<{
		sensorId: string;
		subtype: string;
		name: string;
		label: string;
		emoji: string;
		recentEvents: Array<{
			id: string;
			eventType: string;
			dataType: string;
			timestamp: string;
			data: Record<string, unknown>;
		}>;
	}> = [];

	if (ownedSensors.length > 0) {
		const sensorIds = ownedSensors.map((s) => s.id);
		const allEvents = await db
			.select({
				id: sensorEvents.id,
				sensorId: sensorEvents.sensorId,
				eventType: sensorEvents.eventType,
				dataType: sensorEvents.dataType,
				timestamp: sensorEvents.timestamp,
				data: sensorEvents.data
			})
			.from(sensorEvents)
			.where(and(eq(sensorEvents.userId, userId), inArray(sensorEvents.sensorId, sensorIds)))
			.orderBy(desc(sensorEvents.timestamp))
			.limit(100);

		function mapEvent(e: typeof allEvents[number]) {
			return {
				id: e.id,
				eventType: e.eventType,
				dataType: e.dataType ?? '',
				timestamp: (e.timestamp as Date).toISOString(),
				data: (e.data ?? {}) as Record<string, unknown>
			};
		}

		for (const sensor of ownedSensors) {
			const sub = (sensor.subtype ?? 'washer') as HomeApplianceSubtype;

			if (sub === 'appliance_monitor') {
				const sensorEvts = allEvents.filter((e) => e.sensorId === sensor.id);
				const byAppliance = new Map<string, typeof allEvents>();
				for (const ev of sensorEvts) {
					const appName = (ev.data as Record<string, unknown>)?.appliance as string | undefined;
					if (!appName) continue;
					if (!byAppliance.has(appName)) byAppliance.set(appName, []);
					byAppliance.get(appName)!.push(ev);
				}

				for (const [appName, evts] of byAppliance) {
					appliances.push({
						sensorId: sensor.id,
						subtype: 'ping',
						name: appName,
						label: appName,
						emoji: pingApplianceEmoji(appName),
						recentEvents: evts.slice(0, 10).map(mapEvent)
					});
				}
			} else {
				const meta = HOME_APPLIANCE_LABELS[sub] ?? { label: sensor.name, emoji: '🔌' };
				const events = allEvents
					.filter((e) => e.sensorId === sensor.id)
					.slice(0, 10);

				appliances.push({
					sensorId: sensor.id,
					subtype: sub,
					name: sensor.name,
					label: meta.label,
					emoji: meta.emoji,
					recentEvents: events.map(mapEvent)
				});
			}
		}
	}

	return {
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
		appliances
	};
};
