import { describe, it, expect } from 'vitest';
import {
	EASY_MAX_ABOVE_Z2_SHARE,
	GREY_CONCERN_SHARE,
	GREY_MIN_Z3_SHARE,
	HARD_ZONE45_SHARE,
	MIN_CLASSIFIED_SESSIONS,
	bucketFor,
	characterOf,
	composeCharacters,
	describeComposition,
	isCompositionTrustworthy,
	type SessionInput
} from './session-character';
import { MAX_HARD_SHARE } from './aerobic-efficiency';

function session(
	date: string,
	zones: { z1?: number; z2?: number; z3?: number; z4?: number; z5?: number } | null,
	km = 10
): SessionInput {
	return { date, distanceKm: km, durationSeconds: 3600, zones };
}

describe('characterOf', () => {
	it('kaller en skikkelig intervalløkt hard, ikke grå', () => {
		// Dette er hele grunnen til at hard sjekkes FØRST. En intervalløkt har mye
		// Z3 — dragene passerer gjennom den og pausene ligger der — så en
		// grå-sjekk foran ville stemplet den som grå. Altså motsatt av det
		// modulen skal fange.
		expect(characterOf({ z1: 0.35, z2: 0.4, z3: 0.1, z4: 0.1, z5: 0.05 })).toBe('hard');
	});

	it('kaller en vedvarende moderat økt grå', () => {
		expect(characterOf({ z1: 0.1, z2: 0.2, z3: 0.65, z4: 0.05 })).toBe('graa');
	});

	it('kaller en rolig tur rolig', () => {
		expect(characterOf({ z1: 0.3, z2: 0.62, z3: 0.08 })).toBe('rolig');
	});

	it('lar en rolig langtur med bakker være rolig', () => {
		// En rolig økt som blir kalt grå på grunn av terrenget er en feil brukeren
		// ikke kan gjøre noe med.
		expect(characterOf({ z1: 0.25, z2: 0.57, z3: 0.18 })).toBe('rolig');
		expect(EASY_MAX_ABOVE_Z2_SHARE).toBe(0.2);
	});

	it('krever at moderat var HOVEDinnholdet for å kalle en økt grå', () => {
		// 30 % Z3 uten Z4–5: mer moderat enn en rolig tur, men ikke nok til at
		// moderat var innholdet. Å kalle en tur grå den ikke var, er verre enn å
		// la den stå — poenget er å få grå-andelen NED.
		expect(characterOf({ z1: 0.2, z2: 0.5, z3: 0.3 })).toBe('rolig');
		expect(GREY_MIN_Z3_SHARE).toBe(0.35);
	});

	it('bruker en LAVERE terskel enn EF-trendens utelukkelse', () => {
		// De to svarer på ulike spørsmål. `MAX_HARD_SHARE` (0,25) holder økter UTE
		// av EF-trenden, og der er en høy terskel konservativ og riktig. Som
		// klassifiserer er den alt for høy: en ekte intervalløkt ligger på 10–20 %
		// av tida i sone 4–5, fordi oppvarming, pauser og nedjogg eier klokka.
		expect(HARD_ZONE45_SHARE).toBeLessThan(MAX_HARD_SHARE);
	});

	it('krever nok absolutt tid hardt, ikke bare en andel', () => {
		// 8 % av en 20-minutters joggetur er halvannet minutt: to bakker og en
		// feilmåling, ikke en hard økt.
		expect(characterOf({ z2: 0.88, z4: 0.12 }, 20 * 60)).not.toBe('hard');
		// Samme andel i en time er over seks minutter — det er en økt.
		expect(characterOf({ z2: 0.88, z4: 0.12 }, 60 * 60)).toBe('hard');
	});

	it('faller tilbake på andelen alene uten varighet', () => {
		expect(characterOf({ z2: 0.88, z4: 0.12 }, null)).toBe('hard');
	});

	it('gir ukjent uten sonefordeling framfor å gjette', () => {
		expect(characterOf(null)).toBe('ukjent');
	});

	it('tolker manglende soner som null, ikke som NaN', () => {
		expect(characterOf({ z2: 0.9 })).toBe('rolig');
		expect(characterOf({ z4: 0.9 })).toBe('hard');
	});
});

describe('composeCharacters', () => {
	it('regner andelene av de KLASSIFISERTE øktene, ikke av alle', () => {
		// En nevner som inkluderte de ukjente ville fått alle tre bøttene til å
		// krympe når dekningen falt — og det leses som en endring i treningen.
		const sessions = [
			session('2026-08-01', { z2: 0.9 }),
			session('2026-08-03', { z2: 0.9 }),
			session('2026-08-05', { z4: 0.5 }),
			session('2026-08-07', null),
			session('2026-08-09', null)
		];
		const comp = composeCharacters(sessions, 30);
		expect(comp.classifiedSessions).toBe(3);
		expect(comp.totalSessions).toBe(5);
		expect(bucketFor(comp, 'rolig')!.sessionShare).toBeCloseTo(2 / 3, 5);
		expect(bucketFor(comp, 'hard')!.sessionShare).toBeCloseTo(1 / 3, 5);
	});

	it('rapporterer dekning som eget tall', () => {
		const comp = composeCharacters(
			[session('2026-08-01', { z2: 0.9 }), session('2026-08-03', null)],
			30
		);
		expect(comp.coverage).toBe(0.5);
	});

	it('teller kilometer ved siden av økter', () => {
		// En rolig 20-km og en rolig 5-km er ikke like mye «rolig».
		const comp = composeCharacters(
			[session('2026-08-01', { z2: 0.9 }, 20), session('2026-08-03', { z4: 0.5 }, 5)],
			30
		);
		expect(bucketFor(comp, 'rolig')!.km).toBe(20);
		expect(bucketFor(comp, 'rolig')!.kmShare).toBeCloseTo(20 / 25, 5);
	});

	it('summerer andelene til 1 blant de klassifiserte', () => {
		const comp = composeCharacters(
			[
				session('2026-08-01', { z2: 0.9 }),
				session('2026-08-03', { z3: 0.7 }),
				session('2026-08-05', { z4: 0.5 }),
				session('2026-08-07', null)
			],
			30
		);
		const total = comp.buckets.reduce((s, b) => s + b.sessionShare, 0);
		expect(total).toBeCloseTo(1, 5);
	});

	it('tåler et tomt vindu uten å dele på null', () => {
		const comp = composeCharacters([], 30);
		expect(comp.coverage).toBe(0);
		expect(comp.buckets.every((b) => b.sessionShare === 0)).toBe(true);
	});
});

describe('isCompositionTrustworthy', () => {
	it('avviser tynn dekning selv med nok økter', () => {
		const sessions: SessionInput[] = [
			...Array.from({ length: 5 }, (_, i) => session(`2026-08-0${i + 1}`, { z2: 0.9 })),
			...Array.from({ length: 10 }, (_, i) => session(`2026-08-1${i}`, null))
		];
		const comp = composeCharacters(sessions, 30);
		expect(comp.classifiedSessions).toBe(5);
		expect(comp.coverage).toBeLessThan(0.5);
		expect(isCompositionTrustworthy(comp)).toBe(false);
	});

	it('avviser for få økter selv med full dekning', () => {
		const comp = composeCharacters([session('2026-08-01', { z2: 0.9 })], 30);
		expect(comp.coverage).toBe(1);
		expect(isCompositionTrustworthy(comp)).toBe(false);
		expect(MIN_CLASSIFIED_SESSIONS).toBe(5);
	});

	it('godtar nok økter med god dekning', () => {
		const sessions = Array.from({ length: 6 }, (_, i) =>
			session(`2026-08-0${i + 1}`, { z2: 0.9 })
		);
		expect(isCompositionTrustworthy(composeCharacters(sessions, 30))).toBe(true);
	});
});

describe('describeComposition', () => {
	/** Åtte rolige, fem grå, to harde — grå over bekymringsterskelen. */
	function greyHeavy(): SessionInput[] {
		return [
			...Array.from({ length: 8 }, (_, i) => session(`2026-08-${10 + i}`, { z2: 0.9 })),
			...Array.from({ length: 5 }, (_, i) => session(`2026-08-${20 + i}`, { z3: 0.7 })),
			...Array.from({ length: 2 }, (_, i) => session(`2026-08-0${i + 1}`, { z4: 0.5 }))
		];
	}

	it('sier hvor mange økter fordelingen hviler på', () => {
		const text = describeComposition(composeCharacters(greyHeavy(), 30));
		expect(text).toContain('15 økter med pulskurve');
	});

	it('navngir grå som det som gir minst igjen', () => {
		const comp = composeCharacters(greyHeavy(), 30);
		expect(bucketFor(comp, 'graa')!.sessionShare).toBeGreaterThan(GREY_CONCERN_SHARE);
		const text = describeComposition(comp);
		expect(text).toContain('Grå-andelen er høy');
		expect(text).toContain('grunnmur');
	});

	it('roser en polarisert fordeling', () => {
		const sessions = [
			...Array.from({ length: 9 }, (_, i) => session(`2026-08-${10 + i}`, { z2: 0.9 })),
			session('2026-08-01', { z4: 0.5 })
		];
		const text = describeComposition(composeCharacters(sessions, 30));
		expect(text).toContain('polarisert');
	});

	it('sier fra når det ikke finnes harde økter', () => {
		const sessions = Array.from({ length: 8 }, (_, i) =>
			session(`2026-08-${10 + i}`, { z2: 0.9 })
		);
		const text = describeComposition(composeCharacters(sessions, 30));
		expect(text).toContain('Ingen harde økter');
	});

	it('nekter å gi en fordeling på tynn dekning', () => {
		const sessions = [
			session('2026-08-01', { z2: 0.9 }),
			...Array.from({ length: 9 }, (_, i) => session(`2026-08-1${i}`, null))
		];
		const text = describeComposition(composeCharacters(sessions, 30));
		expect(text).toContain('For tynt');
		expect(text).not.toContain('%');
	});

	it('skiller «ingen økter» fra «ingen med pulskurve»', () => {
		// Den ene betyr at du ikke har trent. Den andre at vi ikke kunne måle.
		expect(describeComposition(composeCharacters([], 30))).toContain('Ingen økter');
		const unmeasured = Array.from({ length: 6 }, (_, i) =>
			session(`2026-08-0${i + 1}`, null)
		);
		expect(describeComposition(composeCharacters(unmeasured, 30))).toContain('ingen med pulskurve');
	});

	it('sier hvor mange økter som mangler når dekningen er delvis', () => {
		const sessions = [
			...Array.from({ length: 8 }, (_, i) => session(`2026-08-${10 + i}`, { z2: 0.9 })),
			session('2026-08-01', { z4: 0.5 }),
			session('2026-08-02', null)
		];
		const text = describeComposition(composeCharacters(sessions, 30));
		expect(text).toContain('1 økter mangler pulskurve');
	});
});
