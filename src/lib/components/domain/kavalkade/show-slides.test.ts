import { describe, expect, it } from 'vitest';
import { buildShowSlides, type ShowInput } from './show-slides';

function baseInput(overrides: Partial<ShowInput> = {}): ShowInput {
	return {
		birthday: { hasBirthDate: true, daysUntil: 7, turningAge: 44 },
		windowLabels: { current: '18. juni 2025 – 17. juni 2026' },
		current: {
			workoutCount: 0,
			sports: [],
			stepsTotal: null,
			sleepAvgHours: null,
			weightStartKg: null,
			weightEndKg: null,
			weightChangeKg: null,
			screenTimeAvgMinPerDay: null,
			books: []
		},
		previous: {
			workoutCount: 0,
			sports: [],
			stepsTotal: null,
			sleepAvgHours: null,
			weightStartKg: null,
			weightEndKg: null,
			weightChangeKg: null,
			screenTimeAvgMinPerDay: null,
			books: []
		},
		timeline: [],
		ordsky: [],
		interview: { thisYear: null },
		prophecy: null,
		greetings: [],
		...overrides
	};
}

describe('buildShowSlides', () => {
	it('gir alltid intro først og outro sist', () => {
		const slides = buildShowSlides(baseInput());
		expect(slides[0].kind).toBe('intro');
		expect(slides[slides.length - 1].kind).toBe('outro');
		expect(slides).toHaveLength(2); // helt tomt år = bare intro + outro
	});

	it('intro forteller dager til bursdagen, outro gratulerer på dagen', () => {
		const omEnUke = buildShowSlides(baseInput());
		expect(omEnUke[0]).toMatchObject({ sub: 'Om 7 dager fyller du 44 år' });

		const paaDagen = buildShowSlides(
			baseInput({ birthday: { hasBirthDate: true, daysUntil: 0, turningAge: 44 } })
		);
		expect(paaDagen[0]).toMatchObject({ sub: 'I dag fyller du 44 år' });
		expect(paaDagen[paaDagen.length - 1]).toMatchObject({
			kind: 'outro',
			title: expect.stringContaining('Gratulerer med dagen')
		});
	});

	it('lager km-slide for distansesport og økter-slide for styrke, maks 3 sporter', () => {
		const slides = buildShowSlides(
			baseInput({
				current: {
					...baseInput().current,
					workoutCount: 10,
					sports: [
						{ family: 'running', label: 'løpt', count: 5, distanceKm: 512.4, durationHours: 47 },
						{ family: 'strength', label: 'styrketrent', count: 3, distanceKm: 0, durationHours: 3 },
						{ family: 'walking', label: 'gått', count: 1, distanceKm: 9, durationHours: 2 },
						{ family: 'cycling', label: 'syklet', count: 1, distanceKm: 30, durationHours: 1 }
					]
				},
				previous: {
					...baseInput().previous,
					sports: [
						{ family: 'running', label: 'løpt', count: 4, distanceKm: 387.2, durationHours: 36 }
					]
				}
			})
		);
		const stats = slides.filter((s) => s.kind === 'stat');
		// 3 sport-slides + treningsøkter totalt
		expect(stats).toHaveLength(4);
		expect(stats[0]).toMatchObject({
			label: 'har du løpt',
			value: 512.4,
			decimals: 1,
			unit: 'km',
			sub: 'i fjor: 387,2 km'
		});
		expect(stats[1]).toMatchObject({ label: 'har du styrketrent', value: 3, unit: 'økter', sub: undefined });
	});

	it('tar med bøker, ordsky, minne, årets beste, hilsner og spådom når data finnes', () => {
		const slides = buildShowSlides(
			baseInput({
				current: {
					...baseInput().current,
					books: [{ title: 'Stoner', author: 'John Williams' }]
				},
				ordsky: Array.from({ length: 6 }, (_, i) => ({ word: `ord${i}`, count: 2, weight: 0.5 })),
				interview: {
					thisYear: {
						memory: 'Gaustatoppen i juli',
						best_book: 'Stoner',
						best_concert: 'Bon Iver'
					}
				},
				prophecy: 'Du kommer til å runde 600 km.\n\nOg mer til.',
				greetings: [{ character: 'Kelvin', book: 'Solaris', text: 'Gratulerer.' }]
			})
		);
		const kinds = slides.map((s) => s.kind);
		expect(kinds).toEqual(['intro', 'list', 'ordsky', 'quote', 'list', 'quote', 'quote', 'outro']);

		const greeting = slides.find((s) => s.kind === 'quote' && s.attribution);
		expect(greeting).toMatchObject({ attribution: 'Kelvin, «Solaris»' });

		const prophecy = slides.filter((s) => s.kind === 'quote').at(-1);
		expect(prophecy).toMatchObject({ text: 'Du kommer til å runde 600 km.' });
	});

	it('hopper over ordsky med under 5 ord og månedsliste med under 2 overskrifter', () => {
		const slides = buildShowSlides(
			baseInput({
				ordsky: [{ word: 'rydde', count: 3, weight: 1 }],
				timeline: [
					{
						key: '2025-07',
						label: 'juli 2025',
						workoutCount: 0,
						topSport: null,
						stepsTotal: null,
						books: [],
						headline: 'Ferie'
					}
				]
			})
		);
		expect(slides.map((s) => s.kind)).toEqual(['intro', 'outro']);
	});

	it('fester graf-serier på sport-slides og krever minst to år for år-for-år', () => {
		const input = baseInput({
			current: {
				...baseInput().current,
				sports: [
					{ family: 'running', label: 'løpt', count: 5, distanceKm: 512.4, durationHours: 47 },
					{ family: 'strength', label: 'styrketrent', count: 3, distanceKm: 0, durationHours: 3 }
				]
			},
			sportHistory: [
				{
					family: 'running',
					asDistance: true,
					monthly: [{ label: 'jul', value: 64 }],
					yearly: [
						{ label: '2024–25', value: 387 },
						{ label: '2025–26', value: 512 }
					]
				},
				{
					family: 'strength',
					asDistance: false,
					monthly: [{ label: 'jul', value: 0 }],
					yearly: [{ label: '2025–26', value: 3 }] // bare ett år — ingen graf
				}
			]
		});
		const stats = buildShowSlides(input).filter((s) => s.kind === 'stat');
		expect(stats[0].monthly).toEqual([{ label: 'jul', value: 64 }]);
		expect(stats[0].yearly).toHaveLength(2);
		expect(stats[1].monthly).toBeUndefined(); // alle måneder 0
		expect(stats[1].yearly).toBeUndefined(); // under to år
	});

	it('setter writer og strøm-tilpasset varighet på hilsner', () => {
		const text = 'Et stille år er også et liv. '.repeat(10).trim();
		const slides = buildShowSlides(
			baseInput({ greetings: [{ character: 'William Stoner', book: 'Stoner', text }] })
		);
		const greeting = slides.find((s) => s.kind === 'quote');
		expect(greeting).toMatchObject({ writer: 'William Stoner' });
		// 290 tegn på 75 tegn/s ≈ 3,9 s strøm + skrive-pause + lesero > 8 s
		expect(greeting && greeting.durationMs).toBeGreaterThan(8000);
	});

	it('gir alltid outroen konfetti, introen bare på selve dagen', () => {
		const foer = buildShowSlides(baseInput());
		expect(foer[0]).toMatchObject({ kind: 'intro', confetti: false });
		expect(foer[foer.length - 1]).toMatchObject({ kind: 'outro', confetti: true });

		const paaDagen = buildShowSlides(
			baseInput({ birthday: { hasBirthDate: true, daysUntil: 0, turningAge: 44 } })
		);
		expect(paaDagen[0]).toMatchObject({ kind: 'intro', confetti: true });
	});

	it('lager photos-slide når bilder finnes, ellers ikke', () => {
		const med = buildShowSlides(
			baseInput({ photos: [{ url: 'https://a/1.jpg', caption: 'Gaustatoppen' }] })
		);
		expect(med.some((s) => s.kind === 'photos')).toBe(true);
		expect(buildShowSlides(baseInput()).some((s) => s.kind === 'photos')).toBe(false);
	});

	it('lager loop-slide kun når loop har mål', () => {
		const med = buildShowSlides(
			baseInput({
				loop: {
					hasData: true,
					prophecyExcerpt: null,
					promises: [
						{ title: 'Løpe 600 km', targetValue: 600, unit: 'km', actualValue: 612, achieved: true, status: 'active' }
					]
				}
			})
		);
		expect(med.some((s) => s.kind === 'loop')).toBe(true);
		// hasData via kun spådom (ingen mål) → ingen loop-slide
		const baretekst = buildShowSlides(
			baseInput({ loop: { hasData: true, prophecyExcerpt: 'Du runder 600 km.', promises: [] } })
		);
		expect(baretekst.some((s) => s.kind === 'loop')).toBe(false);
	});

	it('gir hver slide en hue fra paletten', () => {
		const slides = buildShowSlides(baseInput());
		for (const slide of slides) {
			expect(slide.hue).toBeGreaterThanOrEqual(0);
			expect(slide.hue).toBeLessThan(360);
		}
	});
});
