import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { checklistItems, checklists, goals, sensorEvents } from '$lib/db/schema';
import { and, desc, eq, lte, sql } from 'drizzle-orm';
import { upsertPlanArtifactField } from '$lib/server/plan-artifacts';
import { createReflection } from '$lib/server/reflections';

function getIsoWeekInfo(now: Date) {
	const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
	const dayNum = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - dayNum);
	const year = d.getUTCFullYear();
	const yearStart = new Date(Date.UTC(year, 0, 1));
	const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
	const week = String(weekNo).padStart(2, '0');

	const monday = new Date(d);
	monday.setUTCDate(d.getUTCDate() - 3);
	const sunday = new Date(monday);
	sunday.setUTCDate(monday.getUTCDate() + 6);

	return {
		year,
		week,
		weekNo,
		dashedKey: `${year}-W${week}`,
		compactKey: `${year}W${week}`,
		contextKey: `week:${year}-W${week}`,
		startDate: monday.toISOString().slice(0, 10),
		endDate: sunday.toISOString().slice(0, 10)
	};
}

function getIsoWeekInfoFromKey(weekKey: string) {
	const match = weekKey.match(/^(\d{4})-W(\d{2})$/);
	if (!match) return null;
	const year = Number.parseInt(match[1], 10);
	const week = Number.parseInt(match[2], 10);
	if (!Number.isFinite(year) || !Number.isFinite(week) || week < 1 || week > 53) return null;

	const jan4 = new Date(Date.UTC(year, 0, 4));
	const jan4Day = jan4.getUTCDay() || 7;
	const week1Monday = new Date(jan4);
	week1Monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1);
	const monday = new Date(week1Monday);
	monday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
	const resolved = getIsoWeekInfo(monday);
	return resolved.dashedKey === weekKey ? resolved : null;
}

function parseSection(text: string, marker: string): Array<{ title: string; value: number; unit: string }> {
	const idx = text.indexOf(marker);
	if (idx === -1) return [];
	const nextSection = text.indexOf('UKESMÅL:', idx + marker.length);
	const nextSection2 = text.indexOf('UKESOPPGAVER:', idx + marker.length);
	const end = [nextSection, nextSection2].filter((n) => n > idx).reduce((a, b) => Math.min(a, b), text.length);
	const section = text.slice(idx + marker.length, end);
	const results: Array<{ title: string; value: number; unit: string }> = [];
	for (const line of section.split('\n')) {
		const match = line.match(/^-\s+(.+?):\s*(\d+(?:[.,]\d+)?)\s+(.+?)\s*$/);
		if (match) {
			results.push({
				title: match[1].trim(),
				value: parseFloat(match[2].replace(',', '.')),
				unit: match[3].trim()
			});
		}
	}
	return results;
}

function parseGoalUpdates(text: string) { return parseSection(text, 'UKESMÅL:'); }
function parseTaskUpdates(text: string) { return parseSection(text, 'UKESOPPGAVER:'); }

const METRIC_MAP: Record<string, string> = {
	km: 'running_distance',
	kilometer: 'running_distance',
	ganger: 'yoga_sessions',
	yoga: 'yoga_sessions',
	kg: 'weight_kg',
	bøker: 'reading_books',
	kr: 'spending_nok'
};

function inferTrackingMetric(title: string, unit: string): string {
	const titleLower = title.toLowerCase();
	if (titleLower.includes('løp')) return 'running_distance';
	if (titleLower.includes('yoga') || titleLower.includes('mikroyoga')) return 'yoga_sessions';
	if (titleLower.includes('vekt')) return 'weight_kg';
	return METRIC_MAP[unit.toLowerCase()] ?? 'manual_counter';
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json() as {
		weekKey: string;
		carryoverTexts: string[];
		selectedTasks: string[];
		goalUpdatesText: string;
		prevWeekGoals: Array<{ title: string; currentValue: number; target: { value: number; unit: string }; trackingMetric: string }>;
		narrative: string;
		refleksjonText?: string;
	};

	const { weekKey, carryoverTexts, selectedTasks, goalUpdatesText, prevWeekGoals, narrative, refleksjonText } = body;

	const week = getIsoWeekInfoFromKey(weekKey);
	if (!week) return json({ error: 'Ugyldig ukenøkkel' }, { status: 400 });

	// ── 1. Ensure week checklist exists and add tasks ──────────────────────────
	const parsedTasks = parseTaskUpdates(goalUpdatesText);
	const simpleTaskTexts = [...new Set([...carryoverTexts, ...selectedTasks])].filter(Boolean);
	const needsChecklist = simpleTaskTexts.length > 0 || parsedTasks.length > 0;

	if (needsChecklist) {
		let checklist = await db.query.checklists.findFirst({
			where: and(eq(checklists.userId, userId), eq(checklists.context, week.contextKey)),
			columns: { id: true }
		});

		if (!checklist) {
			const [created] = await db.insert(checklists).values({
				userId,
				title: `Uke ${week.weekNo}`,
				emoji: '🗓️',
				context: week.contextKey
			}).returning({ id: checklists.id });
			checklist = created;
		}

		const existingItems = await db.query.checklistItems.findMany({
			where: eq(checklistItems.checklistId, checklist.id),
			columns: { id: true, text: true, sortOrder: true }
		});
		const existingTexts = new Set(existingItems.map((i) => i.text.trim().toLowerCase()));
		let nextSortOrder = existingItems.length;

		const simpleToInsert = simpleTaskTexts
			.filter((t) => !existingTexts.has(t.trim().toLowerCase()))
			.map((text, i) => ({
				checklistId: checklist!.id,
				userId,
				text: text.trim(),
				sortOrder: nextSortOrder + i
			}));
		if (simpleToInsert.length > 0) {
			await db.insert(checklistItems).values(simpleToInsert);
			nextSortOrder += simpleToInsert.length;
		}

		// UKESOPPGAVER: N=1 → single item, N>1 → parent + N children
		for (const task of parsedTasks) {
			const parentLabel = task.value > 1
				? `${task.title} (${task.value} ${task.unit})`
				: task.title;
			if (existingTexts.has(parentLabel.trim().toLowerCase())) continue;

			if (task.value <= 1) {
				await db.insert(checklistItems).values({
					checklistId: checklist.id,
					userId,
					text: parentLabel.trim(),
					sortOrder: nextSortOrder++
				});
			} else {
				const [parent] = await db.insert(checklistItems).values({
					checklistId: checklist.id,
					userId,
					text: parentLabel.trim(),
					sortOrder: nextSortOrder++
				}).returning({ id: checklistItems.id });

				const children = Array.from({ length: task.value }, (_, i) => ({
					checklistId: checklist!.id,
					userId,
					text: task.title.trim(),
					parentId: parent.id,
					sortOrder: i
				}));
				await db.insert(checklistItems).values(children);
			}
		}
	}

	// ── 2. Create/update week goals ─────────────────────────────────────────────
	const parsedGoals = parseGoalUpdates(goalUpdatesText);

	const goalsToCreate = parsedGoals.length > 0
		? parsedGoals.map((g) => ({
				title: g.title,
				value: g.value,
				unit: g.unit,
				trackingMetric: inferTrackingMetric(g.title, g.unit)
		  }))
		: prevWeekGoals.map((g) => ({
				title: g.title,
				value: g.target.value,
				unit: g.target.unit,
				trackingMetric: g.trackingMetric
		  }));

	for (const goal of goalsToCreate) {
		const existing = await db.query.goals.findFirst({
			where: and(
				eq(goals.userId, userId),
				sql`${goals.metadata}->>'weekKey' = ${week.dashedKey}`,
				sql`lower(${goals.title}) = lower(${goal.title})`
			),
			columns: { id: true }
		});
		if (existing) continue;

		let baselineValue: number | null = null;
		if (goal.trackingMetric === 'weight_kg') {
			const latestWeight = await db
				.select({ data: sensorEvents.data })
				.from(sensorEvents)
				.where(and(
					eq(sensorEvents.userId, userId),
					eq(sensorEvents.dataType, 'weight'),
					lte(sensorEvents.timestamp, new Date(`${week.endDate}T23:59:59.999Z`))
				))
				.orderBy(desc(sensorEvents.timestamp))
				.limit(1);
			const w = Number((latestWeight[0]?.data as { weight?: number } | null)?.weight);
			if (Number.isFinite(w)) baselineValue = Math.round(w * 10) / 10;
		}

		const weightDelta = goal.trackingMetric === 'weight_kg' && baselineValue !== null
			? Math.round((goal.value - baselineValue) * 10) / 10
			: null;

		await db.insert(goals).values({
			userId,
			title: goal.title,
			status: 'active',
			targetDate: new Date(week.endDate),
			metadata: {
				weekKey: week.dashedKey,
				goalType: goal.trackingMetric,
				tracking: {
					source: goal.trackingMetric === 'weight_kg'
						? 'sensor_event'
						: goal.trackingMetric === 'running_distance' || goal.trackingMetric === 'yoga_sessions'
						? 'workout_aggregate'
						: 'manual',
					metric: goal.trackingMetric
				},
				target: { value: goal.value, unit: goal.unit },
				baselineValue,
				currentValue: 0,
				...(goal.trackingMetric === 'running_distance' ? {
					metricId: 'running_distance',
					startDate: week.startDate,
					endDate: week.endDate,
					goalTrack: { targetValue: goal.value }
				} : goal.trackingMetric === 'weight_kg' && baselineValue !== null ? {
					metricId: 'weight_change',
					startDate: week.startDate,
					endDate: week.endDate,
					startValue: baselineValue,
					goalTrack: { targetValue: weightDelta }
				} : {})
			}
		});
	}

	// ── 3. Save narrative as week note ─────────────────────────────────────────
	if (narrative.trim()) {
		await upsertPlanArtifactField({
			userId,
			kind: 'week',
			periodKey: week.compactKey,
			field: 'note',
			content: narrative
		});
	}

	// ── 4. Save refleksjon as plan-artefact reflection AND tracked reflection ──
	if (refleksjonText?.trim()) {
		await upsertPlanArtifactField({
			userId,
			kind: 'week',
			periodKey: week.compactKey,
			field: 'reflection',
			content: refleksjonText
		});
		await createReflection({
			userId,
			kind: 'week_review',
			periodKey: week.dashedKey,
			content: refleksjonText
		});
	}

	return json({ success: true });
};
