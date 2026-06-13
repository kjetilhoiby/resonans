/**
 * Datalaster for årskavalkaden — deles av /kavalkade-siden og
 * /api/kavalkade/magi (spådom + bursdagshilsner trenger samme kontekst).
 */

import { and, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import {
	books,
	checklistItems,
	goals,
	persons,
	planArtifacts,
	sensorAggregates,
	workoutDailyAggregates
} from '$lib/db/schema';
import {
	buildMonthTimeline,
	buildSportHistory,
	formatKavalkadeForPrompt,
	getBirthdayWindows,
	sportLabel,
	summarizeYear,
	type KavalkadeWindow,
	type MonthTimelineEntry,
	type SportSeries,
	type SportSummary,
	type YearSummary
} from './kavalkade';
import { buildOrdsky, type OrdskyWord } from './ordsky';
import { getReflectionForPeriod } from './reflections';
import { formatAnswersAsText, parseInterviewMarkdown, type InterviewAnswers } from '$lib/flows/birthday-interview';
import { parseBirthdayPhotos, type BirthdayPhoto } from '$lib/flows/birthday-photos';
import { buildBirthdayLoop, type BirthdayLoop } from './birthday-loop';
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
	/** Graf-serier per toppsport: måned for måned i år + år-for-år så langt det finnes data */
	sportHistory: SportSeries[];
	ordsky: OrdskyWord[];
	/** Årets opplastede bilder */
	photos: BirthdayPhoto[];
	/** «Dette ville du i fjor» — fjorårets mål + spådom vs. faktisk */
	loop: BirthdayLoop;
	interview: {
		thisYearKey: string;
		thisYear: InterviewAnswers | null;
		lastYear: InterviewAnswers | null;
		lastYearText: string;
		/** Fjorårets brev til seg selv — vises i åpningen av årets selvangivelse */
		lastYearLetter: string;
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
		greetingsReflection,
		photosReflection,
		lastYearProphecyReflection,
		loopGoalRows
	] = await Promise.all([
		// Hele historikken — år-for-år-grafen går så langt det finnes data
		db.query.workoutDailyAggregates.findMany({
			where: and(
				eq(workoutDailyAggregates.userId, userId),
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
		getReflectionForPeriod(userId, 'birthday_greetings', thisYearKey),
		getReflectionForPeriod(userId, 'birthday_photos', thisYearKey),
		// Fjorårets spådom + målene satt da (frist nå = birthdayKey thisYear) → «Dette ville du i fjor»
		getReflectionForPeriod(userId, 'birthday_prophecy', lastYearKey),
		db.query.goals.findMany({
			where: and(
				eq(goals.userId, userId),
				sql`${goals.metadata}->>'birthdayKey' = ${thisYearKey}`,
				sql`${goals.metadata}->>'source' = 'birthday_interview'`
			)
		})
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

	const photos = photosReflection ? parseBirthdayPhotos(photosReflection.content) : [];

	// «Dette ville du i fjor»: fjorårets mål (frist nå) + spådom vs. faktisk
	const runningKm =
		currentSummary.sports.find((s) => s.family === 'running')?.distanceKm ?? null;
	const loop = buildBirthdayLoop({
		goals: loopGoalRows.map((g) => ({
			title: g.title,
			status: g.status,
			metadata: (g.metadata ?? null) as never
		})),
		prophecyContent: lastYearProphecyReflection?.content ?? null,
		runningKm
	});

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
		sportHistory: buildSportHistory(current, workoutDays),
		ordsky: buildOrdsky(taskRows.map((r) => r.text)),
		photos,
		loop,
		interview: {
			thisYearKey,
			thisYear: thisYearAnswers,
			lastYear: lastYearAnswers,
			// Kontekst som mates inn i intervjuets avsluttende chat-steg
			lastYearText: lastYearAnswers ? formatAnswersAsText(lastYearAnswers) : '',
			lastYearLetter: lastYearAnswers?.letter_to_future ?? '',
			kavalkadeText: formatKavalkadeForPrompt(currentSummary, previousSummary)
		},
		prophecy: prophecyReflection?.content ?? null,
		greetings: greetingsReflection ? parseGreetingsMarkdown(greetingsReflection.content) : []
	};
}
