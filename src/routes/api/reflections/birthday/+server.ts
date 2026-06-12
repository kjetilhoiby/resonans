import { json } from '@sveltejs/kit';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { goals, persons } from '$lib/db/schema';
import { upsertReflectionForPeriod } from '$lib/server/reflections';
import { getBirthdayWindows } from '$lib/server/kavalkade';
import {
	buildInterviewMarkdown,
	type BirthdayGoal,
	type InterviewAnswers
} from '$lib/flows/birthday-interview';
import type { RequestHandler } from './$types';

/** Enkel metrikk-gjetting for sensor-sporing — samme ånd som ukeplanens mål */
function inferTrackingMetric(title: string, unit: string | null): string {
	const t = title.toLowerCase();
	if (t.includes('løp')) return 'running_distance';
	if (t.includes('vekt') || unit === 'kg') return 'weight_kg';
	if (unit === 'km') return 'running_distance';
	if (unit === 'bøker') return 'reading_books';
	return 'manual_counter';
}

/**
 * Lagrer selvangivelsen: svarene som én refleksjon per år (kind
 * 'birthday_interview', upsert), chattene som transkript-refleksjon
 * ('birthday_interview_chat' — «samtalen er data»), og speilets
 * målforslag som ekte mål med frist neste bursdag.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	const body = await request.json();
	const raw = body?.answers;
	if (!raw || typeof raw !== 'object') {
		return json({ error: 'Mangler svar' }, { status: 400 });
	}

	const answers: InterviewAnswers = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		if (typeof value === 'string' && value.trim()) answers[key] = value.trim();
	}

	const content = buildInterviewMarkdown(answers);
	if (!content) {
		return json({ error: 'Tomt innhold' }, { status: 400 });
	}

	const periodKey = String(new Date().getFullYear());
	const reflection = await upsertReflectionForPeriod({
		userId,
		kind: 'birthday_interview',
		periodKey,
		content
	});

	// Chattene arkiveres som egen refleksjon — selvangivelsen beholder destillatet
	const threads = body?.threads as { kroppOgHode?: unknown; speil?: unknown } | undefined;
	const transcriptParts: string[] = [];
	if (typeof threads?.kroppOgHode === 'string' && threads.kroppOgHode.trim()) {
		transcriptParts.push(`## Kroppen og hodet\n${threads.kroppOgHode.trim()}`);
	}
	if (typeof threads?.speil === 'string' && threads.speil.trim()) {
		transcriptParts.push(`## Året i speilet\n${threads.speil.trim()}`);
	}
	if (transcriptParts.length > 0) {
		await upsertReflectionForPeriod({
			userId,
			kind: 'birthday_interview_chat',
			periodKey,
			content: transcriptParts.join('\n\n')
		});
	}

	// Bursdagsmål: frist = neste bursdag (fallback ett år frem uten fødselsdato)
	const rawGoals = Array.isArray(body?.goals) ? (body.goals as BirthdayGoal[]) : [];
	let goalsCreated = 0;
	if (rawGoals.length > 0) {
		const self = await db.query.persons.findFirst({
			where: and(eq(persons.userId, userId), eq(persons.kind, 'self'), eq(persons.archived, false)),
			columns: { birthDate: true }
		});
		const { nextBirthday } = getBirthdayWindows(self?.birthDate ?? null, new Date());
		const targetDate =
			nextBirthday ?? new Date(new Date().setFullYear(new Date().getFullYear() + 1));
		const birthdayKey = String(targetDate.getFullYear());
		const todayIso = new Date().toISOString().slice(0, 10);

		for (const goal of rawGoals.slice(0, 6)) {
			const title = typeof goal?.title === 'string' ? goal.title.trim() : '';
			if (!title) continue;
			const existing = await db.query.goals.findFirst({
				where: and(
					eq(goals.userId, userId),
					sql`${goals.metadata}->>'birthdayKey' = ${birthdayKey}`,
					sql`lower(${goals.title}) = lower(${title})`
				),
				columns: { id: true }
			});
			if (existing) continue;

			const value = typeof goal.value === 'number' && Number.isFinite(goal.value) ? goal.value : null;
			const unit = typeof goal.unit === 'string' && goal.unit.trim() ? goal.unit.trim() : null;
			const metric = value !== null ? inferTrackingMetric(title, unit) : 'manual_counter';
			await db.insert(goals).values({
				userId,
				title,
				status: 'active',
				targetDate,
				periodKey: birthdayKey,
				metadata: {
					birthdayKey,
					source: 'birthday_interview',
					goalType: metric,
					...(value !== null
						? {
								target: { value, unit: unit ?? '' },
								currentValue: 0,
								tracking: {
									source: metric === 'running_distance' ? 'workout_aggregate' : 'manual',
									metric
								},
								startDate: todayIso,
								endDate: targetDate.toISOString().slice(0, 10)
							}
						: {})
				}
			});
			goalsCreated++;
		}
	}

	return json({ ok: true, id: reflection?.id ?? null, periodKey, goalsCreated });
};
