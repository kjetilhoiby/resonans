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

describe('detectPromptFocusModules — sparekonto som buffer', () => {
	// Ordene brukeren faktisk skriver. Ingen av dem inneholder «saldo», «bank» eller
	// «forbruk», så de traff ikke økonomimodulen i det hele tatt — og da vet ikke modellen
	// at savings_buffer finnes. Samme stille feil som «belastning» og «pulsfall» hadde.
	it('sender spørsmål om sparekontoen til økonomi', () => {
		expect(detectPromptFocusModules('går sparekontoen ned?')).toContain('economics');
		expect(detectPromptFocusModules('hvor lenge holder bufferen')).toContain('economics');
		expect(detectPromptFocusModules('hvor mange måneders dekning har vi')).toContain('economics');
		expect(detectPromptFocusModules('hvor ofte tar vi uttak fra sparepengene')).toContain(
			'economics'
		);
	});
});

describe('detectPromptFocusModules — sletting av feilmåling', () => {
	it('sender «slett målingen fra 10. august 2018» til helse', () => {
		// Meldingen brukeren faktisk skriver. Den inneholder ikke ordet «vekt», så
		// den traff ingen modul — og da vet ikke modellen at
		// manage_weight_measurement finnes.
		expect(detectPromptFocusModules('slett målingen fra 10. august 2018')).toContain('health');
	});

	it('fanger de vanlige formene', () => {
		for (const text of [
			'slett målingen fra i går',
			'det er en feilmåling der',
			'den veiingen kan ikke stemme',
			'jeg veide meg aldri den dagen',
			'fjern den målingen'
		]) {
			expect(detectPromptFocusModules(text), text).toContain('health');
		}
	});

	it('lar maling til veggen være i fred', () => {
		// «maling» uten ø er et hus-prosjekt, ikke en vektmåling. Uten skillet ville
		// hver oppussingsmelding dratt inn helse-blokka.
		expect(detectPromptFocusModules('kjøpe maling til stua')).not.toContain('health');
	});
});

describe('detectPromptFocusModules — perioder i vektkurven', () => {
	it('sender spørsmål om nedganger og oppganger til helse', () => {
		// Meldingene brukeren faktisk skriver om periodene i kurven. Ingen av dem
		// inneholder ordet «vekt», så de traff ingen modul — og da finnes ikke
		// query_weight for modellen, som i stedet svarer på siste enkeltmåling.
		for (const text of [
			'hvor mye har jeg gått ned siden april',
			'når snudde nedgangen',
			'har jeg hatt en oppgang i år',
			'hvor mange kilo gikk jeg ned sist'
		]) {
			expect(detectPromptFocusModules(text), text).toContain('health');
		}
	});

	it('lar kilometer være i fred', () => {
		// «kilo» med ordgrense, ellers drar hver løpetur inn vekt-verktøyene.
		expect(detectPromptFocusModules('hvor mange kilometer løp jeg i juli')).not.toContain(
			'health'
		);
	});
});
