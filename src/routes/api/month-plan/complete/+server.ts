import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { checklistItems, checklists, goals, memories, sensorEvents } from '$lib/db/schema';
import { and, desc, eq, lte, sql } from 'drizzle-orm';

function getMonthInfoFromKey(key: string) {
	const match = key.match(/^(\d{4})-(\d{2})$/);
	if (!match) return null;
	const year = parseInt(match[1], 10);
	const month = parseInt(match[2], 10);
	if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
	const monthStr = String(month).padStart(2, '0');
	const daysInMonth = new Date(year, month, 0).getDate();
	const endDay = String(daysInMonth).padStart(2, '0');
	const monthName = new Intl.DateTimeFormat('nb-NO', { month: 'long' }).format(new Date(year, month - 1, 1));
	return {
		year,
		month: monthStr,
		dashedKey: `${year}-${monthStr}`,
		compactKey: `${year}M${monthStr}`,
		contextKey: `month:${year}-${monthStr}`,
		startDate: `${year}-${monthStr}-01`,
		endDate: `${year}-${monthStr}-${endDay}`,
		monthName
	};
}

async function upsertMemory(userId: string, source: string, content: string) {
	const trimmed = content.trim();
	const existing = await db.query.memories.findFirst({
		columns: { id: true },
		where: and(eq(memories.userId, userId), eq(memories.source, source))
	});
	if (!trimmed) {
		if (existing) await db.delete(memories).where(eq(memories.id, existing.id));
		return;
	}
	if (existing) {
		await db.update(memories)
			.set({ content: trimmed, updatedAt: new Date(), lastAccessedAt: new Date() })
			.where(eq(memories.id, existing.id));
	} else {
		await db.insert(memories).values({ userId, category: 'other', content: trimmed, importance: 'medium', source });
	}
}

function parseSection(text: string, marker: string): Array<{ title: string; value: number; unit: string }> {
	const idx = text.indexOf(marker);
	if (idx === -1) return [];
	// Stop at the next known section marker
	const nextSection = text.indexOf('MÅNEDSMÅL:', idx + marker.length);
	const nextSection2 = text.indexOf('MÅNEDSOPPGAVER:', idx + marker.length);
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

function parseGoalUpdates(text: string) { return parseSection(text, 'MÅNEDSMÅL:'); }
function parseTaskUpdates(text: string) { return parseSection(text, 'MÅNEDSOPPGAVER:'); }

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
		monthKey: string;
		carryoverTexts: string[];
		selectedTasks: string[];
		goalUpdatesText: string;
		prevMonthGoals: Array<{ title: string; currentValue: number; target: { value: number; unit: string }; trackingMetric: string }>;
		narrative: string;
		refleksjonText?: string;
	};

	const { monthKey, carryoverTexts, selectedTasks, goalUpdatesText, prevMonthGoals, narrative, refleksjonText } = body;

	const month = getMonthInfoFromKey(monthKey);
	if (!month) return json({ error: 'Ugyldig månedsnøkkel' }, { status: 400 });

	// ── 1. Ensure month checklist exists and add tasks ───────────────────────
	const parsedTasks = parseTaskUpdates(goalUpdatesText);
	const simpleTaskTexts = [...new Set([...carryoverTexts, ...selectedTasks])].filter(Boolean);
	const needsChecklist = simpleTaskTexts.length > 0 || parsedTasks.length > 0;

	if (needsChecklist) {
		let checklist = await db.query.checklists.findFirst({
			where: and(eq(checklists.userId, userId), eq(checklists.context, month.contextKey)),
			columns: { id: true }
		});

		if (!checklist) {
			const [created] = await db.insert(checklists).values({
				userId,
				title: `${month.monthName.charAt(0).toUpperCase() + month.monthName.slice(1)} ${month.year}`,
				emoji: '📅',
				context: month.contextKey
			}).returning({ id: checklists.id });
			checklist = created;
		}

		const existingItems = await db.query.checklistItems.findMany({
			where: eq(checklistItems.checklistId, checklist.id),
			columns: { id: true, text: true, sortOrder: true }
		});
		const existingTexts = new Set(existingItems.map((i) => i.text.trim().toLowerCase()));
		let nextSortOrder = existingItems.length;

		// Insert simple carryover/recurring tasks
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

		// Insert MÅNEDSOPPGAVER: N=1 → single item, N>1 → parent + N children
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

	// ── 2. Create/update month goals ─────────────────────────────────────────
	const parsedGoals = parseGoalUpdates(goalUpdatesText);

	// If AI produced structured goals, use those; otherwise carry forward previous month goals
	const goalsToCreate = parsedGoals.length > 0
		? parsedGoals.map((g) => ({
				title: g.title,
				value: g.value,
				unit: g.unit,
				trackingMetric: inferTrackingMetric(g.title, g.unit)
		  }))
		: prevMonthGoals.map((g) => ({
				title: g.title,
				value: g.target.value,
				unit: g.target.unit,
				trackingMetric: g.trackingMetric
		  }));

	for (const goal of goalsToCreate) {
		// Skip if a goal with this title already exists for this month
		const existing = await db.query.goals.findFirst({
			where: and(
				eq(goals.userId, userId),
				sql`${goals.metadata}->>'monthKey' = ${month.dashedKey}`,
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
					lte(sensorEvents.timestamp, new Date(`${month.endDate}T23:59:59.999Z`))
				))
				.orderBy(desc(sensorEvents.timestamp))
				.limit(1);
			const w = Number((latestWeight[0]?.data as { weight?: number } | null)?.weight);
			if (Number.isFinite(w)) baselineValue = Math.round(w * 10) / 10;
		}

		// Build metadata that satisfies both the maanedsplan page (tracking.metric, target)
		// and the goals page (metricId, startDate, endDate, goalTrack, startValue)
		const weightDelta = goal.trackingMetric === 'weight_kg' && baselineValue !== null
			? Math.round((goal.value - baselineValue) * 10) / 10
			: null;

		await db.insert(goals).values({
			userId,
			title: goal.title,
			status: 'active',
			targetDate: new Date(month.endDate),
			metadata: {
				// maanedsplan format
				monthKey: month.dashedKey,
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
				// goals page format
				...(goal.trackingMetric === 'running_distance' ? {
					metricId: 'running_distance',
					startDate: month.startDate,
					endDate: month.endDate,
					goalTrack: { targetValue: goal.value }
				} : goal.trackingMetric === 'weight_kg' && baselineValue !== null ? {
					metricId: 'weight_change',
					startDate: month.startDate,
					endDate: month.endDate,
					startValue: baselineValue,
					goalTrack: { targetValue: weightDelta }
				} : {})
			}
		});
	}

	// ── 3. Save narrative as month note ──────────────────────────────────────
	if (narrative.trim()) {
		await upsertMemory(userId, `month-plan:${month.compactKey}:note`, narrative);
	}

	// ── 4. Save refleksjon chat as reflection memory ──────────────────────────
	if (refleksjonText?.trim()) {
		await upsertMemory(userId, `month-plan:${month.compactKey}:reflection`, refleksjonText);
	}

	return json({ success: true });
};
