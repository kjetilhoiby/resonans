import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { checklistItems, checklists } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { parseListRepeatCount } from '$lib/server/list-repeat-parser';
import { parseChecklistItemIntent } from '$lib/server/checklist-intent-linker';
import { syncStaysForDate } from '$lib/server/stays';
import { parseTaskDateTime } from '$lib/server/date-time-parser';
import { buildChecklistItemFields } from '$lib/server/checklist-item-builder';
import { PersonMentionService } from '$lib/server/services/person-mention-service';
import { runInBackground } from '$lib/server/run-in-background';

// POST /api/checklists/[id]/items — legg til et nytt punkt
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	const { text, sortOrder = 9999, count = 1, parentId, coords, link } = await request.json() as {
		text: string;
		sortOrder?: number;
		count?: number;
		parentId?: string;
		// Pinnet geokoding fra klienten (etter evt. bekreftelse av tvetydig sted).
		coords?: { lat: number; lon: number; label?: string };
		// Eksplisitt kobling fra ukeplan: planlegg en oppgave/ukeliste-punkt ned på
		// denne dagen. Når satt, hopper vi over tekst-basert kobling og bruker denne.
		link?: {
			taskId?: string;
			taskTitle?: string;
			checklistItemId?: string;
			activityType?: string;
			durationMinutes?: number;
			distanceKm?: number;
		};
	};

	if (!text) return json({ error: 'text er påkrevd' }, { status: 400 });

	// Load checklist to get context (for week key extraction)
	const checklist = await db.query.checklists.findFirst({
		where: and(eq(checklists.id, params.id), eq(checklists.userId, userId)),
		columns: { id: true, context: true }
	});
	if (!checklist) return json({ error: 'Sjekkliste ikke funnet' }, { status: 404 });

	// --- Eksplisitt planlagt punkt fra ukeplan ---
	// Kobling er oppgitt direkte (linkedTaskId eller linkedChecklistItemId), så vi
	// bygger et enkelt punkt uten tekst-basert oppgavekobling/-oppretting. Tid og
	// aktivitet parses fortsatt fra teksten så tids-chip og auto-hak virker.
	if (link && (link.taskId || link.checklistItemId) && !parentId) {
		const intent = parseChecklistItemIntent(text, { dayLevel: true });
		const timeMeta =
			intent.timeHour !== undefined ? { timeHour: intent.timeHour, timeMinute: intent.timeMinute ?? 0 } : {};
		const activityMeta = link.activityType
			? {
					activityType: link.activityType,
					...(link.durationMinutes !== undefined ? { durationMinutes: link.durationMinutes } : {}),
					...(link.distanceKm !== undefined ? { distanceKm: link.distanceKm } : {})
				}
			: intent.activityType
				? {
						activityType: intent.activityType,
						...(intent.durationMinutes !== undefined ? { durationMinutes: intent.durationMinutes } : {}),
						...(intent.distanceKm !== undefined ? { distanceKm: intent.distanceKm } : {})
					}
				: {};
		const linkMeta = {
			...(link.taskId ? { linkedTaskId: link.taskId, linkedTaskTitle: link.taskTitle ?? text.trim() } : {}),
			...(link.checklistItemId ? { linkedChecklistItemId: link.checklistItemId } : {})
		};
		const metadata = { ...activityMeta, ...timeMeta, ...linkMeta };

		const [created] = await db
			.insert(checklistItems)
			.values({
				checklistId: params.id,
				userId,
				parentId: null,
				text: text.trim(),
				sortOrder,
				metadata
			})
			.returning();

		runInBackground(PersonMentionService.indexChecklistItem(userId, created.id, created.text));
		return json([created], { status: 201 });
	}

	const parsed = parseListRepeatCount(text, count || 1, 12);
	const repeatCount = parsed.repeatCount;

	// --- Enkelt punkt på toppnivå: full parsing (tid/sted/reise/måltid/aktivitet/
	// oppgavekobling) via den felles builderen, slik at AI-verktøy, redigering og
	// manuell oppretting gir identisk resultat. ---
	if (repeatCount === 1 && !parentId) {
		const fields = await buildChecklistItemFields({
			userId,
			context: checklist.context,
			text: parsed.label,
			coords,
			allowTaskCreation: true
		});

		const [created] = await db
			.insert(checklistItems)
			.values({
				checklistId: params.id,
				userId,
				parentId: null,
				text: fields.text,
				startDate: fields.startDate,
				sortOrder,
				...(Object.keys(fields.metadata).length > 0 ? { metadata: fields.metadata } : {})
			})
			.returning();

		// Index @-mentions for det opprettede punktet — kjører i bakgrunnen via waitUntil.
		runInBackground(PersonMentionService.indexChecklistItem(userId, created.id, created.text));

		// Sted-punkt → skriv opphold automatisk til reise-/ferieplan som dekker dagen.
		if (fields.locationDayIso) {
			runInBackground(syncStaysForDate(userId, fields.locationDayIso));
		}

		return json([created], { status: 201 });
	}

	// --- Gjentaksmønstre («yoga (1/4)») og deloppgaver: enklere parsing
	// (dato/tid for deloppgaver + aktivitets-tag for auto-haking). ---
	const parsedSubtaskDate = repeatCount === 1 && parentId ? parseTaskDateTime(parsed.label) : null;
	const subtaskTimeMeta = parsedSubtaskDate
		? {
			...(parsedSubtaskDate.hour !== undefined ? { timeHour: parsedSubtaskDate.hour } : {}),
			...(parsedSubtaskDate.minute !== undefined ? { timeMinute: parsedSubtaskDate.minute } : {})
		}
		: {};
	const baseLabel = parsedSubtaskDate?.text || parsed.label;

	// Aktivitets-tag fra base-label, slik at også gjentatte slots ("Yoga (1/4)")
	// bærer activityType og kan auto-hakes mot treningsdata.
	const baseActivityIntent = parseChecklistItemIntent(baseLabel, { dayLevel: true });
	const activitySlotMeta: Record<string, unknown> = baseActivityIntent.activityType
		? {
			activityType: baseActivityIntent.activityType,
			...(baseActivityIntent.durationMinutes !== undefined && { durationMinutes: baseActivityIntent.durationMinutes }),
			...(baseActivityIntent.distanceKm !== undefined && { distanceKm: baseActivityIntent.distanceKm })
		}
		: {};

	const createdItems = await db.insert(checklistItems).values(
		Array.from({ length: repeatCount }, (_, index) => {
			const meta = { ...activitySlotMeta, ...subtaskTimeMeta };
			return {
				checklistId: params.id,
				userId,
				parentId: parentId || null, // Support subtasks
				text: repeatCount > 1 ? `${baseLabel} (${index + 1}/${repeatCount})` : baseLabel,
				startDate: parsedSubtaskDate?.startDate ?? null,
				sortOrder: sortOrder + index,
				...(Object.keys(meta).length > 0 ? { metadata: meta } : {})
			};
		})
	).returning();

	// Index @-mentions for hver opprettet item — kjører i bakgrunnen via waitUntil.
	for (const item of createdItems) {
		runInBackground(PersonMentionService.indexChecklistItem(userId, item.id, item.text));
	}

	return json(createdItems, { status: 201 });
};
