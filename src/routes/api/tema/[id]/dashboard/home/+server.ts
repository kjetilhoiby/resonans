import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themes, tasks, sensorEvents, sensors, checklists, applianceProfiles, checklistItems } from '$lib/db/schema';
import { resolveThemeDashboardKind } from '$lib/domain/theme-dashboard-registry';
import { and, eq, desc, inArray } from 'drizzle-orm';
import { ProjectMetricsService } from '$lib/server/services/project-metrics-service';
import { currentSeason, HOME_APPLIANCE_SUBTYPES, HOME_APPLIANCE_LABELS, type HomeApplianceSubtype, pingApplianceEmoji } from '$lib/domains/home';
import { buildApplianceCycle, type ApplianceCycle } from '$lib/server/services/appliance-cycle';

export const GET: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, userId))
	});
	if (!theme) return json({ error: 'Tema ikke funnet.' }, { status: 404 });
	if (resolveThemeDashboardKind(theme.name) !== 'home') {
		return json({ error: 'Temaet har ikke hjem-dashboard.' }, { status: 400 });
	}

	try {

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

	// Prosjekt-undertemaer (parentTheme='Hjem') med oppgave-progresjon fra checklist_items.
	const projectThemes = await db
		.select()
		.from(themes)
		.where(and(eq(themes.userId, userId), eq(themes.parentTheme, 'Hjem'), eq(themes.archived, false)))
		.orderBy(desc(themes.createdAt));

	const projectIds = projectThemes.map((t) => t.id);
	const projectItems = projectIds.length
		? await db
				.select({ themeId: checklistItems.themeId, checked: checklistItems.checked })
				.from(checklistItems)
				.where(inArray(checklistItems.themeId, projectIds))
		: [];

	const progressByTheme = new Map<string, { total: number; done: number }>();
	for (const item of projectItems) {
		if (!item.themeId) continue;
		const agg = progressByTheme.get(item.themeId) ?? { total: 0, done: 0 };
		agg.total += 1;
		if (item.checked) agg.done += 1;
		progressByTheme.set(item.themeId, agg);
	}

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
		cycle: ApplianceCycle | null;
	}> = [];

	if (ownedSensors.length > 0) {
		const sensorIds = ownedSensors.map((s) => s.id);
		const [allEvents, allProfiles] = await Promise.all([
			db
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
				.limit(100),
			db.select().from(applianceProfiles).where(eq(applianceProfiles.userId, userId))
		]);

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
				// Ping sensor: group events by data.appliance field
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
						recentEvents: evts.slice(0, 10).map(mapEvent),
						cycle: buildApplianceCycle(appName, evts, allProfiles)
					});
				}
			} else {
				const meta = HOME_APPLIANCE_LABELS[sub] ?? { label: sensor.name, emoji: '🔌' };
				const sensorEvts = allEvents.filter((e) => e.sensorId === sensor.id);
				const events = sensorEvts.slice(0, 10);

				appliances.push({
					sensorId: sensor.id,
					subtype: sub,
					name: sensor.name,
					label: meta.label,
					emoji: meta.emoji,
					recentEvents: events.map(mapEvent),
					cycle: buildApplianceCycle(sensor.name, sensorEvts, allProfiles)
				});
			}
		}
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
		projectThemes: projectThemes.map((t) => {
			const agg = progressByTheme.get(t.id) ?? { total: 0, done: 0 };
			const profile = (t.projectProfile ?? {}) as Record<string, unknown>;
			return {
				id: t.id,
				name: t.name,
				emoji: t.emoji,
				room: (profile.room as string | undefined) ?? null,
				status: (profile.status as string | undefined) ?? null,
				targetDate: (profile.targetDate as string | undefined) ?? null,
				tasksTotal: agg.total,
				tasksDone: agg.done
			};
		}),
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
	});

	} catch (err) {
		console.error('[home-dashboard]', err);
		return json({ error: 'Kunne ikke laste hjem-dashboard.' }, { status: 500 });
	}
};
