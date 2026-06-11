/**
 * Kavalkade-show — bygger fullskjerm-slide-sekvensen fra årsdataene.
 * Ren funksjon uten DB/DOM, så rekkefølge- og utvalgslogikken er testbar.
 */

import type { InterviewAnswers } from '$lib/flows/birthday-interview';
import type { Greeting, MonthEntry, OrdskyWordView, YearData } from './types';

export type ShowSlideDef =
	| { kind: 'intro'; title: string; sub?: string; hue: number; durationMs: number }
	| {
			kind: 'stat';
			label: string;
			value: number;
			decimals: number;
			unit: string;
			sub?: string;
			hue: number;
			durationMs: number;
	  }
	| { kind: 'list'; title: string; items: string[]; sub?: string; hue: number; durationMs: number }
	| { kind: 'ordsky'; title: string; words: OrdskyWordView[]; hue: number; durationMs: number }
	| {
			kind: 'quote';
			title?: string;
			text: string;
			attribution?: string;
			hue: number;
			durationMs: number;
	  }
	| { kind: 'outro'; title: string; sub?: string; hue: number; durationMs: number };

export interface ShowInput {
	birthday: { hasBirthDate: boolean; daysUntil: number | null; turningAge: number | null };
	windowLabels: { current: string };
	current: YearData;
	previous: YearData;
	timeline: MonthEntry[];
	ordsky: OrdskyWordView[];
	interview: { thisYear: InterviewAnswers | null };
	prophecy: string | null;
	greetings: Greeting[];
}

// Fargehjul for bakgrunnene — én hue per slide, sykler gjennom paletten
const HUES = [258, 12, 152, 38, 205, 320, 88, 230];

const STAT_MS = 5500;
const QUOTE_MS = 8000;

/** «årets beste»-feltene fra intervjuet, med visningsetikett */
const BEST_OF: Array<{ id: string; label: string }> = [
	{ id: 'best_concert', label: 'Konsert' },
	{ id: 'best_book', label: 'Bok' },
	{ id: 'best_film', label: 'Film eller serie' },
	{ id: 'best_theater', label: 'Teater' },
	{ id: 'best_experience', label: 'Opplevelse' }
];

export function buildShowSlides(input: ShowInput): ShowSlideDef[] {
	const slides: ShowSlideDef[] = [];
	let hueIdx = 0;
	const nextHue = () => HUES[hueIdx++ % HUES.length];

	// Intro
	const { daysUntil, turningAge } = input.birthday;
	const introSub =
		daysUntil !== null && turningAge !== null
			? daysUntil === 0
				? `I dag fyller du ${turningAge} år`
				: `Om ${daysUntil} ${daysUntil === 1 ? 'dag' : 'dager'} fyller du ${turningAge} år`
			: input.windowLabels.current;
	slides.push({ kind: 'intro', title: 'Dette var året ditt', sub: introSub, hue: nextHue(), durationMs: STAT_MS });

	// Sport-tall — distansesporter som km, resten som økter (maks 3)
	const prevByFamily = new Map(input.previous.sports.map((s) => [s.family, s]));
	for (const sport of input.current.sports.slice(0, 3)) {
		const prev = prevByFamily.get(sport.family);
		const asDistance = sport.distanceKm >= 1;
		slides.push({
			kind: 'stat',
			label: `har du ${sport.label}`,
			value: asDistance ? sport.distanceKm : sport.count,
			decimals: asDistance && !Number.isInteger(sport.distanceKm) ? 1 : 0,
			unit: asDistance ? 'km' : 'økter',
			sub: prev
				? asDistance
					? `i fjor: ${prev.distanceKm.toLocaleString('nb-NO')} km`
					: `i fjor: ${prev.count} økter`
				: undefined,
			hue: nextHue(),
			durationMs: STAT_MS
		});
	}

	if (input.current.workoutCount > 0) {
		slides.push({
			kind: 'stat',
			label: 'treningsøkter til sammen',
			value: input.current.workoutCount,
			decimals: 0,
			unit: '',
			sub: `i fjor: ${input.previous.workoutCount}`,
			hue: nextHue(),
			durationMs: STAT_MS
		});
	}

	if (input.current.stepsTotal !== null && input.current.stepsTotal > 0) {
		slides.push({
			kind: 'stat',
			label: 'skritt har du gått',
			value: input.current.stepsTotal,
			decimals: 0,
			unit: '',
			sub:
				input.previous.stepsTotal !== null
					? `i fjor: ${input.previous.stepsTotal.toLocaleString('nb-NO')}`
					: undefined,
			hue: nextHue(),
			durationMs: STAT_MS
		});
	}

	if (input.current.books.length > 0) {
		slides.push({
			kind: 'list',
			title: `${input.current.books.length} ${input.current.books.length === 1 ? 'bok' : 'bøker'} har du lest`,
			items: input.current.books.map((b) => (b.author ? `${b.title} — ${b.author}` : b.title)),
			sub: `i fjor: ${input.previous.books.length}`,
			hue: nextHue(),
			durationMs: Math.max(STAT_MS, 2500 + input.current.books.length * 700)
		});
	}

	if (input.ordsky.length >= 5) {
		slides.push({
			kind: 'ordsky',
			title: 'Året i ord',
			words: input.ordsky.slice(0, 25),
			hue: nextHue(),
			durationMs: 7000
		});
	}

	// Månedshøydepunkter — månedene med overskrift fra månedsplanen
	const headlines = input.timeline.filter((m) => m.headline);
	if (headlines.length >= 2) {
		slides.push({
			kind: 'list',
			title: 'Måned for måned',
			items: headlines.map((m) => `${m.label}: «${m.headline}»`),
			hue: nextHue(),
			durationMs: Math.max(STAT_MS, 2500 + headlines.length * 700)
		});
	}

	// Fra intervjuet: minnet og årets beste
	const answers = input.interview.thisYear;
	if (answers?.memory) {
		slides.push({
			kind: 'quote',
			title: 'Det du husker best',
			text: answers.memory,
			hue: nextHue(),
			durationMs: QUOTE_MS
		});
	}
	const bestOf = answers
		? BEST_OF.filter((b) => answers[b.id]).map((b) => `${b.label}: ${answers[b.id]}`)
		: [];
	if (bestOf.length > 0) {
		slides.push({
			kind: 'list',
			title: 'Årets beste',
			items: bestOf,
			hue: nextHue(),
			durationMs: Math.max(STAT_MS, 2500 + bestOf.length * 700)
		});
	}

	// Hilsner fra romankarakterene
	for (const greeting of input.greetings) {
		slides.push({
			kind: 'quote',
			title: 'Hilsen fra bokhylla',
			text: greeting.text,
			attribution: greeting.book ? `${greeting.character}, «${greeting.book}»` : greeting.character,
			hue: nextHue(),
			durationMs: QUOTE_MS
		});
	}

	// Spådommen — første avsnitt som teaser
	if (input.prophecy) {
		const firstParagraph = input.prophecy.split(/\n{2,}/)[0]?.trim();
		if (firstParagraph) {
			slides.push({
				kind: 'quote',
				title: 'Spådommen for neste år',
				text: firstParagraph,
				hue: nextHue(),
				durationMs: QUOTE_MS
			});
		}
	}

	// Outro
	slides.push({
		kind: 'outro',
		title: daysUntil === 0 ? 'Gratulerer med dagen! 🎂' : 'God bursdag når den kommer 🎂',
		sub: turningAge !== null ? `Her kommer år ${turningAge}.` : 'Her kommer et nytt år.',
		hue: nextHue(),
		durationMs: STAT_MS
	});

	return slides;
}
