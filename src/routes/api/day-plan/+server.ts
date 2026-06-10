import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { checklists, checklistItems } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { buildChecklistItemFields } from '$lib/server/checklist-item-builder';
import { upsertPlanArtifactField } from '$lib/server/plan-artifacts';
import { syncStaysForDate } from '$lib/server/stays';
import { PersonMentionService } from '$lib/server/services/person-mention-service';
import { runInBackground } from '$lib/server/run-in-background';

export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json() as {
		dayIso: string;
		weekDashedKey: string;
		headline: string;
		tasks: string[];
	};

	const { dayIso, weekDashedKey, headline, tasks } = body;

	if (!dayIso || !weekDashedKey) {
		return json({ error: 'Missing required fields' }, { status: 400 });
	}

	const compactKey = weekDashedKey.replace('-W', 'W');

	await upsertPlanArtifactField({
		userId,
		kind: 'day',
		periodKey: dayIso,
		parentPeriodKey: compactKey,
		field: 'headline',
		content: headline ?? ''
	});

	// Save tasks to day checklist
	if (tasks?.length) {
		const dayContext = `week:${weekDashedKey}:day:${dayIso}`;

		let dayChecklist = await db.query.checklists.findFirst({
			where: and(eq(checklists.userId, userId), eq(checklists.context, dayContext)),
			with: {
				items: {
					orderBy: (items, { asc }) => [asc(items.sortOrder), asc(items.createdAt)]
				}
			}
		});

		if (!dayChecklist) {
			const [newChecklist] = await db
				.insert(checklists)
				.values({ userId, title: `Dag ${dayIso}`, emoji: '☑️', context: dayContext })
				.returning();
			dayChecklist = { ...newChecklist!, items: [] };
		}

		const existingTexts = new Set(
			(dayChecklist.items ?? []).map((i) => i.text.trim().toLowerCase())
		);
		const toAdd = tasks
			.map((t) => t.trim())
			.filter((t) => t.length > 0 && !existingTexts.has(t.toLowerCase()));

		if (toAdd.length > 0) {
			const nextOrder =
				(dayChecklist.items ?? []).reduce((m, i) => Math.max(m, i.sortOrder), -1) + 1;

			// Parse hvert dag-punkt (tid/sted/reise/måltid/aktivitet/kobling) via
			// den felles builderen — samme resultat som manuell oppretting.
			const built = await Promise.all(
				toAdd.map((text) =>
					buildChecklistItemFields({ userId, context: dayContext, text, allowTaskCreation: false })
				)
			);

			const itemsToInsert = built.map((fields, i) => ({
				checklistId: dayChecklist!.id,
				userId,
				text: fields.text,
				startDate: fields.startDate,
				sortOrder: nextOrder + i,
				...(Object.keys(fields.metadata).length > 0 ? { metadata: fields.metadata } : {})
			}));
			const createdItems = await db.insert(checklistItems).values(itemsToInsert).returning();

			// Index @-mentions for hvert opprettet punkt.
			for (const item of createdItems) {
				runInBackground(PersonMentionService.indexChecklistItem(userId, item.id, item.text));
			}

			// Sted-punkt → skriv opphold automatisk til reise-/ferieplan som dekker dagen.
			if (built.some((f) => f.locationDayIso)) {
				runInBackground(syncStaysForDate(userId, dayIso));
			}
		}
	}

	return json({ success: true });
};
