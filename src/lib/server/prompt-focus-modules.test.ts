import { describe, it, expect } from 'vitest';
import { detectPromptFocusModules } from './openai';

describe('detectPromptFocusModules — sult og inntak', () => {
	it('sender «er dritsulten» til både helse og mat', () => {
		// Meldingen som avdekket hullet: den traff ingen modul, så modellen fikk
		// aldri vite at ernæringsloggen finnes.
		const modules = detectPromptFocusModules('er dritsulten');
		expect(modules).toContain('health');
		expect(modules).toContain('food');
	});

	it('fanger de vanlige formene', () => {
		for (const text of [
			'jeg er sulten',
			'blir sultne før middag',
			'kjenner litt sult',
			'hvor mange kalorier har jeg spist',
			'trenger jeg mer protein i dag?',
			'hva sier ernæringsloggen',
			'lyst på en snack',
			'et mellommåltid nå?',
			'hvordan er energibalansen min'
		]) {
			expect(detectPromptFocusModules(text), text).toContain('health');
		}
	});

	it('lar «resultat» være i fred', () => {
		// «sult» ligger inni «resultat», og et jobb-spørsmål om resultater skal
		// ikke dra inn ernæringsloggen. Samme klasse feil som «is» i «rakfisk».
		const modules = detectPromptFocusModules('presenter resultatene fra prosjektet');
		expect(modules).not.toContain('food');
		expect(modules).toContain('jobb');
	});

	it('fanger verbet «sov», ikke bare substantivet «søvn»', () => {
		// Mønsteret krevde «søvn», så det mest naturlige spørsmålet traff ingenting.
		for (const text of ['hvor mye sov jeg i natt', 'jeg sovnet sent', 'sover jeg nok?']) {
			expect(detectPromptFocusModules(text), text).toContain('health');
		}
	});

	it('rører ikke det som allerede virket', () => {
		expect(detectPromptFocusModules('hva er vekten min')).toContain('health');
		expect(detectPromptFocusModules('hva har jeg i fryseren')).toContain('food');
		expect(detectPromptFocusModules('hva er saldoen')).toContain('economics');
	});
});
