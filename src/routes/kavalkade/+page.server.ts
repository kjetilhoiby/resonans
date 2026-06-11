import { and, eq, gte, isNotNull, lt } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { books, persons, sensorAggregates, workoutDailyAggregates } from '$lib/db/schema';
import {
	formatKavalkadeForPrompt,
	getBirthdayWindows,
	sportLabel,
	summarizeYear,
	type KavalkadeWindow,
	type YearSummary
} from '$lib/server/kavalkade';
import { getReflectionForPeriod } from '$lib/server/reflections';
import { formatAnswersAsText, parseInterviewMarkdown } from '$lib/flows/birthday-interview';
import { daysUntilBirthday } from '$lib/domains/family/family-tree';

function formatWindowLabel(window: KavalkadeWindow): string {
	const fmt = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' });
	// Vinduet er [start, end) — siste dag i året er dagen før neste bursdag
	const lastDay = new Date(window.end.getTime() - 24 * 60 * 60 * 1000);
	return `${fmt.format(window.start)} – ${fmt.format(lastDay)}`;
}

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.userId;
	const today = new Date();

	const self = await db.query.persons.findFirst({
		where: and(eq(persons.userId, userId), eq(persons.kind, 'self'), eq(persons.archived, false))
	});
	const birthDate = self?.birthDate ?? null;
	const { current, previous, nextBirthday } = getBirthdayWindows(birthDate, today);

	const thisYearKey = String(today.getFullYear());
	const lastYearKey = String(today.getFullYear() - 1);

	const [workoutRows, monthRows, bookRows, thisYearReflection, lastYearReflection] =
		await Promise.all([
			db.query.workoutDailyAggregates.findMany({
				where: and(
					eq(workoutDailyAggregates.userId, userId),
					gte(workoutDailyAggregates.date, previous.start),
					lt(workoutDailyAggregates.date, current.end)
				)
			}),
			db.query.sensorAggregates.findMany({
				where: and(
					eq(sensorAggregates.userId, userId),
					eq(sensorAggregates.period, 'month'),
					gte(sensorAggregates.startDate, previous.start),
					lt(sensorAggregates.startDate, current.end)
				)
			}),
			db.query.books.findMany({
				where: and(
					eq(books.userId, userId),
					isNotNull(books.finishedAt),
					gte(books.finishedAt, previous.start)
				)
			}),
			getReflectionForPeriod(userId, 'birthday_interview', thisYearKey),
			getReflectionForPeriod(userId, 'birthday_interview', lastYearKey)
		]);

	const workoutDays = workoutRows.map((r) => ({
		date: r.date,
		sportFamily: r.sportFamily,
		count: r.count,
		distanceMeters: Number(r.distanceMetersSum ?? 0),
		durationSeconds: Number(r.durationSecondsSum ?? 0)
	}));
	const months = monthRows.map((r) => ({ startDate: r.startDate, metrics: r.metrics ?? null }));
	const finishedBooks = bookRows
		.filter((b) => b.finishedAt !== null)
		.map((b) => ({ title: b.title, author: b.author, finishedAt: b.finishedAt as Date }));

	const input = { workoutDays, months, books: finishedBooks };
	const currentSummary = summarizeYear(current, input);
	const previousSummary = summarizeYear(previous, input);

	const thisYearAnswers = thisYearReflection
		? parseInterviewMarkdown(thisYearReflection.content)
		: null;
	const lastYearAnswers = lastYearReflection
		? parseInterviewMarkdown(lastYearReflection.content)
		: null;

	// Norske verb-etiketter («løpt», «gått») settes server-side siden kavalkade-modulen er server-only
	const labelSports = (s: YearSummary) => ({
		...s,
		sports: s.sports.map((sp) => ({ ...sp, label: sportLabel(sp.family) }))
	});

	const turningAge =
		birthDate && nextBirthday ? nextBirthday.getFullYear() - new Date(birthDate).getFullYear() : null;

	return {
		birthday: {
			hasBirthDate: !!birthDate,
			daysUntil: daysUntilBirthday(birthDate, today),
			turningAge
		},
		windowLabels: {
			current: formatWindowLabel(current),
			previous: formatWindowLabel(previous)
		},
		current: labelSports(currentSummary),
		previous: labelSports(previousSummary),
		interview: {
			thisYearKey,
			thisYear: thisYearAnswers,
			lastYear: lastYearAnswers,
			// Kontekst som mates inn i intervjuets avsluttende chat-steg
			lastYearText: lastYearAnswers ? formatAnswersAsText(lastYearAnswers) : '',
			kavalkadeText: formatKavalkadeForPrompt(currentSummary, previousSummary)
		}
	};
};
