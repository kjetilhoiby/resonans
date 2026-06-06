import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { checklists, checklistItems } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { parseChecklistItemIntent, findLinkedTask, stripTimeFromText } from '$lib/server/checklist-intent-linker';
import { parseLocationPrefix, parseTravelPrefix } from '$lib/utils/checklist-group';
import { upsertPlanArtifactField } from '$lib/server/plan-artifacts';
import { syncStaysForDate } from '$lib/server/stays';
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

			// Parse intent + find linked task for each day item
			const itemsToInsert = await Promise.all(
				toAdd.map(async (text, i) => {
					// «Sted: X» → dag-kontekst (ikke avkryssbart). «kjøre/båt/fly til X [kl T]»
					// → reisesegment med transportmodus. Begge tar presedens over aktivitet.
					const location = parseLocationPrefix(text);
					const travel = location ? null : parseTravelPrefix(text);
					const intent = parseChecklistItemIntent(text, { dayLevel: true });
					const timeFields = intent.timeHour !== undefined
						? { timeHour: intent.timeHour, timeMinute: intent.timeMinute ?? 0 }
						: {};
					let metadata: Record<string, unknown> = { ...timeFields };
					if (location) {
						metadata = { kind: 'location', locationName: location.name };
					} else if (travel) {
						metadata = {
							...timeFields,
							kind: 'travel',
							travelMode: travel.mode,
							destination: travel.destination
						};
					} else if (intent.matched) {
						const linkedTask = await findLinkedTask({
							userId,
							itemText: text,
							weekDashedKey,
							weekCompactKey: compactKey
						});
						if (linkedTask) {
							metadata = {
								...timeFields,
								linkedTaskId: linkedTask.taskId,
								linkedTaskTitle: linkedTask.taskTitle,
								activityType: intent.activityType,
								...(intent.durationMinutes !== undefined && { durationMinutes: intent.durationMinutes }),
								...(intent.distanceKm !== undefined && { distanceKm: intent.distanceKm })
							};
						} else if (intent.activityType) {
							metadata = {
								...timeFields,
								activityType: intent.activityType,
								...(intent.durationMinutes !== undefined && { durationMinutes: intent.durationMinutes }),
								...(intent.distanceKm !== undefined && { distanceKm: intent.distanceKm })
							};
						}
					}
					const storedText = location
						? location.name
						: intent.timeHour !== undefined ? stripTimeFromText(text) : text;
					return {
						checklistId: dayChecklist!.id,
						userId,
						text: storedText,
						sortOrder: nextOrder + i,
						...(Object.keys(metadata).length > 0 && { metadata })
					};
				})
			);
			await db.insert(checklistItems).values(itemsToInsert);

			// Sted-punkt → skriv opphold automatisk til reise-/ferieplan som dekker dagen.
			if (itemsToInsert.some((it) => (it.metadata as { kind?: string } | undefined)?.kind === 'location')) {
				runInBackground(syncStaysForDate(userId, dayIso));
			}
		}
	}

	return json({ success: true });
};
