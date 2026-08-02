import { describe, it, expect } from 'vitest';
import {
	findReferenceFood,
	referenceFoodByKey,
	referenceTableForPrompt,
	REFERENCE_FOODS
} from './food-reference';

describe('REFERENCE_FOODS', () => {
	it('har unike nøkler', () => {
		const keys = REFERENCE_FOODS.map((f) => f.key);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it('har ikke-negative makroer overalt', () => {
		for (const food of REFERENCE_FOODS) {
			expect(food.kcal, food.key).toBeGreaterThanOrEqual(0);
			expect(food.proteinG, food.key).toBeGreaterThanOrEqual(0);
			expect(food.carbsG, food.key).toBeGreaterThanOrEqual(0);
			expect(food.fatG, food.key).toBeGreaterThanOrEqual(0);
		}
	});

	it('har kalorier som stemmer omtrent med makroene', () => {
		// 4 kcal/g protein og karbo, 9 kcal/g fett. Avvik over 35 % betyr at en
		// rad er skrevet feil — det er den feilen som er lettest å gjøre her, og
		// den forplanter seg rett inn i alle estimater.
		for (const food of REFERENCE_FOODS) {
			const fromMacros = food.proteinG * 4 + food.carbsG * 4 + food.fatG * 9;
			// Alkohol og svært kaloriefattige varer har ikke meningsfull dekning.
			if (food.kcal < 20) continue;
			if (['ol_pils', 'vin_rod', 'brus_sukker'].includes(food.key)) continue;
			const ratio = fromMacros / food.kcal;
			expect(ratio, `${food.key}: ${fromMacros} vs ${food.kcal}`).toBeGreaterThan(0.65);
			expect(ratio, `${food.key}: ${fromMacros} vs ${food.kcal}`).toBeLessThan(1.35);
		}
	});

	it('dekker varene som var grunnen til tabellen', () => {
		// «To knekkebrød med egg» skal kunne slås opp i sin helhet.
		for (const key of ['knekkebrod', 'egg', 'brunost', 'kaviar', 'brodskive_grov', 'skyr']) {
			expect(referenceFoodByKey(key), key).not.toBeNull();
		}
	});
});

describe('findReferenceFood', () => {
	it('finner på eksakt navn og på alias', () => {
		expect(findReferenceFood('Knekkebrød')?.key).toBe('knekkebrod');
		expect(findReferenceFood('wasa')?.key).toBe('knekkebrod');
		expect(findReferenceFood('norvegia')?.key).toBe('gulost');
	});

	it('lar lengste treff vinne', () => {
		// «gresk yoghurt» inneholder «yoghurt»; uten lengde-preferansen ville
		// oppslaget landet på feil vare.
		expect(findReferenceFood('gresk yoghurt')?.key).toBe('gresk_yoghurt');
		expect(findReferenceFood('yoghurt')?.key).toBe('yoghurt_naturell');
	});

	it('finner varen inne i en setning', () => {
		expect(findReferenceFood('to skiver med brunost')?.key).toBe('brunost');
	});

	it('gir null for tom streng og ukjent vare', () => {
		expect(findReferenceFood('')).toBeNull();
		expect(findReferenceFood('   ')).toBeNull();
		expect(findReferenceFood('rakfisk med lutefisk')).toBeNull();
	});

	it('krever helt ord for korte aliaser', () => {
		// «is» traff «rakfisk» som delstreng — samme felle som «ro» i «kropp».
		expect(findReferenceFood('rakfisk')).toBeNull();
		expect(findReferenceFood('is til dessert')?.key).toBe('is_pinne');
		expect(findReferenceFood('vin til maten')?.key).toBe('vin_rod');
	});

	it('er ikke følsom for store bokstaver', () => {
		expect(findReferenceFood('BANAN')?.key).toBe('banan');
	});
});

describe('referenceTableForPrompt', () => {
	it('gir én linje per vare med nøkkel, enhet og makroer', () => {
		const lines = referenceTableForPrompt().split('\n');
		expect(lines).toHaveLength(REFERENCE_FOODS.length);
		const knekkebrod = lines.find((l) => l.startsWith('knekkebrod |'));
		expect(knekkebrod).toContain('per stykk');
		expect(knekkebrod).toContain('40 kcal');
		expect(knekkebrod).toContain('1.2 g protein');
	});

	it('holder seg innenfor en rimelig prompt-størrelse', () => {
		// Tabellen sendes med hvert estimat. Sprekker den, koster hvert kall mer.
		expect(referenceTableForPrompt().length).toBeLessThan(12_000);
	});
});
