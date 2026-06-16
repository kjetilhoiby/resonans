/**
 * Server-side generering av bursdagsmagi: «spådommen» for året som kommer og
 * hilsner fra romankarakterer i årets bøker. Trukket ut fra /api/kavalkade/magi
 * slik at showet kan etterfylle manglende magi ved sidelast (ensureBirthdayMagi)
 * — ellers blir innslagene borte for den som går rett til showet uten å ha
 * trykket «hent»-knappene på /kavalkade først.
 */

import { openai } from '$lib/server/openai';
import { upsertReflectionForPeriod } from '$lib/server/reflections';
import type { KavalkadeData } from '$lib/server/kavalkade-data';
import { formatAnswersAsText } from '$lib/flows/birthday-interview';
import { buildGreetingsMarkdown, type CharacterGreeting } from '$lib/kavalkade-magi';

function timelineText(data: KavalkadeData): string {
	return data.timeline
		.map((m) => {
			const parts: string[] = [];
			if (m.headline) parts.push(`«${m.headline}»`);
			if (m.topSport) {
				parts.push(
					m.topSport.distanceKm >= 1
						? `${m.topSport.label} ${m.topSport.distanceKm} km`
						: `${m.topSport.label} ${m.topSport.count} økter`
				);
			}
			if (m.books.length > 0) parts.push(`leste ${m.books.join(', ')}`);
			return parts.length > 0 ? `${m.label}: ${parts.join('; ')}` : null;
		})
		.filter(Boolean)
		.join('\n');
}

export async function generateProphecy(data: KavalkadeData): Promise<string | null> {
	const thisYear = data.interview.thisYear ? formatAnswersAsText(data.interview.thisYear) : '';
	const topWords = data.ordsky.slice(0, 15).map((w) => w.word).join(', ');

	const prompt = [
		`Brukeren fyller snart ${data.birthday.turningAge ?? 'et nytt'} år. Spå året som kommer — frem til neste bursdag.`,
		'',
		'Året som gikk i tall:',
		data.interview.kavalkadeText || '(ingen måledata)',
		'',
		timelineText(data) ? `Måned for måned:\n${timelineText(data)}` : '',
		'',
		topWords ? `Ord som preget oppgavelistene: ${topWords}` : '',
		'',
		thisYear ? `Fra årets bursdagsintervju:\n${thisYear}` : '',
		data.interview.lastYearText ? `\nFra fjorårets intervju:\n${data.interview.lastYearText}` : '',
		'',
		'Skriv «spådommen» — en varm, leken og litt høytidelig spåkone-tekst på norsk om året som kommer:',
		'- 4-6 konkrete spådommer som ekstrapolerer trendene (km, bøker, vaner) med glimt i øyet',
		'- minst én spådom som plukker opp noe personlig fra intervjuet',
		'- avslutt med en kort velsignelse for det nye året',
		'- 120-200 ord, avsnitt skilt med blanklinjer, ingen overskrifter',
		'',
		'Svar med JSON: { "spadom": "teksten" }'
	]
		.filter((line) => line !== '')
		.join('\n');

	const completion = await openai.chat.completions.create({
		model: 'gpt-4o',
		messages: [
			{ role: 'system', content: 'Du er en vennlig, treffsikker spåkone. Svar kun med JSON.' },
			{ role: 'user', content: prompt }
		],
		response_format: { type: 'json_object' },
		temperature: 0.8,
		max_tokens: 600
	});

	try {
		const parsed = JSON.parse(completion.choices[0]?.message?.content ?? '{}');
		return typeof parsed.spadom === 'string' && parsed.spadom.trim() ? parsed.spadom.trim() : null;
	} catch {
		return null;
	}
}

export async function generateGreetings(
	books: Array<{ title: string; author: string | null }>,
	data: KavalkadeData
): Promise<CharacterGreeting[]> {
	const bookList = books
		.map((b) => `- «${b.title}»${b.author ? ` av ${b.author}` : ''}`)
		.join('\n');

	const prompt = [
		'Brukeren har bursdag og har lest disse romanene det siste året:',
		bookList,
		'',
		data.birthday.turningAge ? `Brukeren fyller ${data.birthday.turningAge} år.` : '',
		'',
		'Skriv én bursdagshilsen per bok, fra en sentral karakter i boken — i karakterens egen stemme, stil og verdensbilde.',
		'- 2-4 setninger per hilsen, på norsk',
		'- hilsenen skal kjennes som karakteren: ordvalg, temperament, tematikk fra boken',
		'- gjerne en skjev, rørende eller humoristisk vri — ingen generiske gratulasjoner',
		'- bruk karakterens faktiske navn fra boken',
		'',
		'Svar med JSON: { "hilsner": [{ "karakter": "navn", "bok": "tittel", "hilsen": "tekst" }] }'
	]
		.filter((line) => line !== '')
		.join('\n');

	const completion = await openai.chat.completions.create({
		model: 'gpt-4o',
		messages: [
			{
				role: 'system',
				content: 'Du er en litterær tekstforfatter som kjenner verdenslitteraturen godt. Svar kun med JSON.'
			},
			{ role: 'user', content: prompt }
		],
		response_format: { type: 'json_object' },
		temperature: 0.9,
		max_tokens: 900
	});

	try {
		const parsed = JSON.parse(completion.choices[0]?.message?.content ?? '{}');
		if (!Array.isArray(parsed.hilsner)) return [];
		return parsed.hilsner
			.filter(
				(h: unknown): h is { karakter: string; bok?: string; hilsen: string } =>
					!!h &&
					typeof (h as Record<string, unknown>).karakter === 'string' &&
					typeof (h as Record<string, unknown>).hilsen === 'string'
			)
			.map((h: { karakter: string; bok?: string; hilsen: string }) => ({
				character: h.karakter.trim(),
				book: typeof h.bok === 'string' ? h.bok.trim() : '',
				text: h.hilsen.trim()
			}))
			.filter((g: CharacterGreeting) => g.character && g.text);
	} catch {
		return [];
	}
}

/**
 * Etterfyll spådom og hilsner hvis de mangler — best effort. Generering koster
 * et LLM-kall hver, men lagres som refleksjon, så bare den første visningen
 * betaler; senere avspillinger leser cachen. Feiler én generering, vises showet
 * uten det innslaget. Returnerer dataene med eventuell ny magi flettet inn.
 */
export async function ensureBirthdayMagi(
	userId: string,
	data: KavalkadeData
): Promise<KavalkadeData> {
	let prophecy = data.prophecy;
	let greetings = data.greetings;
	const tasks: Promise<void>[] = [];

	if (!data.prophecy) {
		tasks.push(
			(async () => {
				try {
					const content = await generateProphecy(data);
					if (content) {
						await upsertReflectionForPeriod({
							userId,
							kind: 'birthday_prophecy',
							periodKey: data.interview.thisYearKey,
							content
						});
						prophecy = content;
					}
				} catch (err) {
					console.warn('[kavalkade-magi] spådom-generering feilet', err);
				}
			})()
		);
	}

	// Hilsner trenger bøker å hente karakterer fra — årets først, ellers fjorårets
	const sourceBooks = data.current.books.length > 0 ? data.current.books : data.previous.books;
	if (data.greetings.length === 0 && sourceBooks.length > 0) {
		tasks.push(
			(async () => {
				try {
					const g = await generateGreetings(sourceBooks.slice(-5), data);
					if (g.length > 0) {
						await upsertReflectionForPeriod({
							userId,
							kind: 'birthday_greetings',
							periodKey: data.interview.thisYearKey,
							content: buildGreetingsMarkdown(g)
						});
						greetings = g;
					}
				} catch (err) {
					console.warn('[kavalkade-magi] hilsen-generering feilet', err);
				}
			})()
		);
	}

	if (tasks.length === 0) return data;
	await Promise.all(tasks);
	return { ...data, prophecy, greetings };
}
