import { describe, it, expect } from 'vitest';
import {
	buildLivsintervjuMarkdown,
	parseLivsintervjuMarkdown,
	parseValueLines,
	livskompassDoorOpeners,
	resolveKilde,
	segmentConversationBySteps,
	parseLongTermGoals,
	horizonForYear,
	LIVSINTERVJU_STEP_PROMPTS
} from './livsintervju';

describe('buildLivsintervjuMarkdown', () => {
	it('bygger én seksjon per besvart del i stabil rekkefølge', () => {
		const md = buildLivsintervjuMarkdown({
			ett_aar: 'Om ett år løper jeg tre ganger i uka.',
			verdier: 'Nærvær med barna\nHelse som fundament'
		});
		expect(md).toBe(
			'## Verdiene mine\nNærvær med barna\nHelse som fundament\n\n## Om ett år\nOm ett år løper jeg tre ganger i uka.'
		);
	});

	it('hopper over tomme og ukjente svar', () => {
		expect(buildLivsintervjuMarkdown({ ti_aar: '   ', ukjent: 'noe' })).toBe('');
	});
});

describe('parseLivsintervjuMarkdown', () => {
	it('parser markdown tilbake til svar per seksjons-id', () => {
		const md = '## Verdiene mine\nNærvær\n\n## Om fem år\nSkriver bok.';
		expect(parseLivsintervjuMarkdown(md)).toEqual({
			verdier: 'Nærvær',
			fem_aar: 'Skriver bok.'
		});
	});

	it('er robust mot ukjente overskrifter og tomt innhold', () => {
		expect(parseLivsintervjuMarkdown('## Noe annet\ntekst\n\n## Om ti år\n')).toEqual({});
	});

	it('runder tur-retur med buildLivsintervjuMarkdown', () => {
		const answers = { verdier: 'Ærlighet', ti_aar: 'Fri og frisk.', speil: 'Du sier X, men gjør Y.' };
		expect(parseLivsintervjuMarkdown(buildLivsintervjuMarkdown(answers))).toEqual(answers);
	});
});

describe('parseValueLines', () => {
	it('splitter på linjer og stripper kulepunkt', () => {
		expect(parseValueLines('- Nærvær med barna\n• Helse som fundament\nRomslighet i økonomien')).toEqual([
			'Nærvær med barna',
			'Helse som fundament',
			'Romslighet i økonomien'
		]);
	});

	it('forkaster tomme, altfor korte og altfor lange linjer', () => {
		const lang = 'x'.repeat(201);
		expect(parseValueLines(`\n- ab\n${lang}\nEkte verdi her`)).toEqual(['Ekte verdi her']);
	});

	it('begrenser til maks 7 verdier', () => {
		const lines = Array.from({ length: 10 }, (_, i) => `Verdi nummer ${i + 1}`).join('\n');
		expect(parseValueLines(lines)).toHaveLength(7);
	});

	it('gir tom liste for tom blokk', () => {
		expect(parseValueLines('')).toEqual([]);
	});
});

describe('resolveKilde', () => {
	it('prioriterer fersk innliming over tidligere import', () => {
		expect(resolveKilde({ kilde: 'Ny tekst', _kildemateriale: 'Gammel import' })).toBe('Ny tekst');
	});

	it('faller tilbake til tidligere import', () => {
		expect(resolveKilde({ kilde: '   ', _kildemateriale: 'Gammel import' })).toBe('Gammel import');
	});

	it('gir tom streng uten kilde', () => {
		expect(resolveKilde({})).toBe('');
		expect(resolveKilde({ kilde: 42 })).toBe('');
	});

	it('kutter lange kilder med markør om at fullteksten er lagret', () => {
		const lang = 'a'.repeat(10_000);
		const result = resolveKilde({ kilde: lang }, 100);
		expect(result).toContain('… [forkortet — fullteksten er lagret]');
		expect(result.length).toBeLessThan(200);
	});

	it('lar korte kilder stå urørt', () => {
		expect(resolveKilde({ kilde: 'Kort notat' })).toBe('Kort notat');
	});
});

describe('segmentConversationBySteps', () => {
	const tiAarPrompt = LIVSINTERVJU_STEP_PROMPTS.find((s) => s.stepId === 'ti_aar')!.prompt;
	const femAarPrompt = LIVSINTERVJU_STEP_PROMPTS.find((s) => s.stepId === 'fem_aar')!.prompt;

	it('segmenterer samtalen per steg og utelater selve prompten', () => {
		const segments = segmentConversationBySteps([
			{ role: 'user', content: tiAarPrompt },
			{ role: 'assistant', content: 'Se for deg en tirsdag.' },
			{ role: 'user', content: 'Jeg står opp tidlig og løper.' },
			{ role: 'user', content: femAarPrompt },
			{ role: 'assistant', content: 'Hva må være sant om fem år?' }
		]);
		expect(segments.ti_aar).toEqual([
			{ role: 'assistant', content: 'Se for deg en tirsdag.' },
			{ role: 'user', content: 'Jeg står opp tidlig og løper.' }
		]);
		expect(segments.fem_aar).toEqual([{ role: 'assistant', content: 'Hva må være sant om fem år?' }]);
	});

	it('lar lengste segment vinne ved omstarts-duplikater', () => {
		const segments = segmentConversationBySteps([
			{ role: 'user', content: tiAarPrompt },
			{ role: 'assistant', content: 'Lang natt-samtale, del 1 <status>Om ti år er jeg fri.</status>' },
			{ role: 'user', content: 'Mye innhold her.' },
			{ role: 'assistant', content: 'Lang natt-samtale, del 2.' },
			// Omstart (historisk bug): samme prompt på nytt, kort segment
			{ role: 'user', content: tiAarPrompt },
			{ role: 'assistant', content: 'Da går vi dit. Se for deg en tirsdag.' }
		]);
		expect(segments.ti_aar).toHaveLength(3);
		expect(segments.ti_aar[0].content).toContain('del 1');
	});

	it('ignorerer meldinger før første steg-prompt og tåler tom liste', () => {
		expect(segmentConversationBySteps([])).toEqual({});
		const segments = segmentConversationBySteps([
			{ role: 'user', content: 'Løs prat før intervjuet' },
			{ role: 'assistant', content: 'Svar på løs prat' },
			{ role: 'user', content: tiAarPrompt },
			{ role: 'assistant', content: 'Første ekte melding' }
		]);
		expect(Object.keys(segments)).toEqual(['ti_aar']);
	});
});

describe('parseLongTermGoals', () => {
	it('parser tittel, verdi, enhet og målår', () => {
		const goals = parseLongTermGoals(
			'Bra!\n<langtidsmål>\nVekt: 80 kg innen 2031\n10 km: 50 min innen 2029\nSparing: 8000 kr/mnd innen 2027\n</langtidsmål>'
		);
		expect(goals).toEqual([
			{ title: 'Vekt', value: 80, unit: 'kg', year: 2031 },
			{ title: '10 km', value: 50, unit: 'min', year: 2029 },
			{ title: 'Sparing', value: 8000, unit: 'kr/mnd', year: 2027 }
		]);
	});

	it('tåler linjer uten tall og uten år', () => {
		const goals = parseLongTermGoals('<langtidsmål>\nLøpe Oslo maraton\nVekt: 80 kg\n</langtidsmål>');
		expect(goals[0]).toEqual({ title: 'Løpe Oslo maraton', value: null, unit: null, year: null });
		expect(goals[1]).toEqual({ title: 'Vekt', value: 80, unit: 'kg', year: null });
	});

	it('gir tom liste uten markører — løs prosa blir aldri mål', () => {
		expect(parseLongTermGoals('Kanskje du bør veie 80 kg innen 2031?')).toEqual([]);
	});

	it('begrenser til maks 5', () => {
		const lines = Array.from({ length: 8 }, (_, i) => `Mål ${i}: ${i} stk innen 2030`).join('\n');
		expect(parseLongTermGoals(`<langtidsmål>\n${lines}\n</langtidsmål>`)).toHaveLength(5);
	});
});

describe('horizonForYear', () => {
	const naa = new Date(2026, 6, 15); // juli 2026

	it('mapper målår til riktig visjonshorisont', () => {
		expect(horizonForYear(2026, naa)).toBe('vision_yearly');
		expect(horizonForYear(2027, naa)).toBe('vision_yearly'); // slutten av 2027 er ~17 mnd unna
		expect(horizonForYear(2029, naa)).toBe('vision_5year');
		expect(horizonForYear(2031, naa)).toBe('vision_5year'); // ~65 mnd
		expect(horizonForYear(2033, naa)).toBe('vision_10year');
	});

	it('faller tilbake til fem år uten målår', () => {
		expect(horizonForYear(null, naa)).toBe('vision_5year');
	});
});

describe('livskompassDoorOpeners', () => {
	it('grupperer alle fire livsområder med dimensjoner', () => {
		const text = livskompassDoorOpeners();
		expect(text).toContain('relasjoner: Partner, Barn, Venner');
		expect(text).toContain('helse:');
		expect(text).toContain('arbeid:');
		expect(text).toContain('mening:');
	});
});
