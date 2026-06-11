/**
 * Datalaster for årskavalkaden — deles av /kavalkade-siden og
 * /api/kavalkade/magi (spådom + bursdagshilsner trenger samme kontekst).
 */

import { and, eq, gte, inArray, isNotNull, lt } from 'drizzle-orm';
import { db } from '$lib/db';
import {
	books,
	checklistItems,
	persons,
	planArtifacts,
	sensorAggregates,
	workoutDailyAggregates
} from '$lib/db/schema';
import {
	buildMonthTimeline,
	formatKavalkadeForPrompt,
	getBirthdayWindows,
	sportLabel,
	summarizeYear,
	type KavalkadeWindow,
	type MonthTimelineEntry,
	type SportSummary,
	type YearSummary
} from './kavalkade';
import { buildOrdsky, type OrdskyWord } from './ordsky';
import { getReflectionForPeriod } from './reflections';
import { formatAnswersAsText, parseInterviewMarkdown, type InterviewAnswers } from '$lib/flows/birthday-interview';
import { parseGreetingsMarkdown, type CharacterGreeting } from '$lib/kavalkade-magi';
import { daysUntilBirthday } from '$lib/domains/family/family-tree';

export type LabeledYearSummary = Omit<YearSummary, 'sports'> & {
	sports: Array<SportSummary & { label: string }>;
};

export interface KavalkadeData {
	birthday: { hasBirthDate: boolean; daysUntil: number | null; turningAge: number | null };
	windows: { current: KavalkadeWindow; previous: KavalkadeWindow };
	windowLabels: { current: string; previous: string };
	current: LabeledYearSummary;
	previous: LabeledYearSummary;
	timeline: MonthTimelineEntry[];
	ordsky: OrdskyWord[];
	interview: {
		thisYearKey: string;
		thisYear: InterviewAnswers | null;
		lastYear: InterviewAnswers | null;
		lastYearText: string;
		kavalkadeText: string;
	};
	prophecy: string | null;
	greetings: CharacterGreeting[];
}

function formatWindowLabel(window: KavalkadeWindow): string {
	const fmt = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' });
	// Vinduet er [start, end) — siste dag i året er dagen før neste bursdag
	const lastDay = new Date(window.end.getTime() - 24 * 60 * 60 * 1000);
	return `${fmt.format(window.start)} – ${fmt.format(lastDay)}`;
}

function monthKeysInWindow(window: KavalkadeWindow): string[] {
	const keys: string[] = [];
	let cursor = new Date(window.start.getFullYear(), window.start.getMonth(), 1);
	while (cursor < window.end) {
		keys.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
		cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
	}
	return keys;
}

export async function loadKavalkadeData(userId: string, today = new Date()): Promise<KavalkadeData> {
	const self = await db.query.persons.findFirst({
		where: and(eq(persons.userId, userId), eq(persons.kind, 'self'), eq(persons.archived, false))
	});
	const birthDate = self?.birthDate ?? null;
	const { current, previous, nextBirthday } = getBirthdayWindows(birthDate, today);

	const thisYearKey = String(today.getFullYear());
	const lastYearKey = String(today.getFullYear() - 1);

	const [
		workoutRows,
		monthRows,
		bookRows,
		taskRows,
		monthArtifactRows,
		thisYearReflection,
		lastYearReflection,
		prophecyReflection,
		greetingsReflection
	] = await Promise.all([
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
		db
			.select({ text: checklistItems.text })
			.from(checklistItems)
			.where(
				and(
					eq(checklistItems.userId, userId),
					gte(checklistItems.createdAt, current.start),
					lt(checklistItems.createdAt, current.end)
				)
			),
		db.query.planArtifacts.findMany({
			where: and(
				eq(planArtifacts.userId, userId),
				eq(planArtifacts.kind, 'month'),
				inArray(planArtifacts.periodKey, monthKeysInWindow(current))
			)
		}),
		getReflectionForPeriod(userId, 'birthday_interview', thisYearKey),
		getReflectionForPeriod(userId, 'birthday_interview', lastYearKey),
		getReflectionForPeriod(userId, 'birthday_prophecy', thisYearKey),
		getReflectionForPeriod(userId, 'birthday_greetings', thisYearKey)
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

	const timeline = buildMonthTimeline(current, {
		...input,
		monthArtifacts: monthArtifactRows.map((a) => ({
			periodKey: a.periodKey,
			headline: a.headline,
			note: a.note
		}))
	});

	const thisYearAnswers = thisYearReflection
		? parseInterviewMarkdown(thisYearReflection.content)
		: null;
	const lastYearAnswers = lastYearReflection
		? parseInterviewMarkdown(lastYearReflection.content)
		: null;

	// Norske verb-etiketter («løpt», «gått») settes her siden kavalkade-modulen er server-only
	const labelSports = (s: YearSummary): LabeledYearSummary => ({
		...s,
		sports: s.sports.map((sp) => ({ ...sp, label: sportLabel(sp.family) }))
	});

	const turningAge =
		birthDate && nextBirthday
			? nextBirthday.getFullYear() - new Date(birthDate).getFullYear()
			: null;

	return {
		birthday: {
			hasBirthDate: !!birthDate,
			daysUntil: daysUntilBirthday(birthDate, today),
			turningAge
		},
		windows: { current, previous },
		windowLabels: {
			current: formatWindowLabel(current),
			previous: formatWindowLabel(previous)
		},
		current: labelSports(currentSummary),
		previous: labelSports(previousSummary),
		timeline,
		ordsky: buildOrdsky(taskRows.map((r) => r.text)),
		interview: {
			thisYearKey,
			thisYear: thisYearAnswers,
			lastYear: lastYearAnswers,
			// Kontekst som mates inn i intervjuets avsluttende chat-steg
			lastYearText: lastYearAnswers ? formatAnswersAsText(lastYearAnswers) : '',
			kavalkadeText: formatKavalkadeForPrompt(currentSummary, previousSummary)
		},
		prophecy: prophecyReflection?.content ?? null,
		greetings: greetingsReflection ? parseGreetingsMarkdown(greetingsReflection.content) : []
	};
}
