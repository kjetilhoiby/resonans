import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/server/openai', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/openai')>('$lib/server/openai');
	return { ...actual, openai: {} };
});

import { routeChatRequest } from './chat-router';

describe('routeChatRequest', () => {
	describe('domener', () => {
		it('ruter helserelaterte meldinger til health', () => {
			const r = routeChatRequest('Hvordan har søvnen min vært?');
			expect(r.domains).toContain('health');
			expect(r.mode).toBe('domain');
		});

		it('ruter treningsrelaterte meldinger til health', () => {
			expect(routeChatRequest('Vis trening denne uken').domains).toContain('health');
		});

		it('ruter økonomi-meldinger til economics', () => {
			const r = routeChatRequest('Hva er saldoen min?');
			expect(r.domains).toContain('economics');
			expect(r.mode).toBe('domain');
		});

		it('ruter matrelaterte meldinger til food', () => {
			const r = routeChatRequest('Hva skal vi ha til middag?');
			expect(r.domains).toContain('food');
		});

		it('ruter oppskrift-meldinger til food', () => {
			expect(routeChatRequest('Finn en oppskrift på lasagne').domains).toContain('food');
		});

		it('ruter familiemeldinger til family', () => {
			const r = routeChatRequest('Når har barna aktivitet?');
			expect(r.domains).toContain('family');
		});

		it('ruter egenfrekvens til self', () => {
			const r = routeChatRequest('Jeg vil gjøre en egenfrekvens-innsjekk');
			expect(r.domains).toContain('self');
		});

		it('ruter jobbmeldinger til jobb', () => {
			const r = routeChatRequest('Hva har jeg på jobben i dag?');
			expect(r.domains).toContain('jobb');
		});

		it('ruter bursdagsmeldinger til self med kavalkade-hint', () => {
			const r = routeChatRequest('Om en uke har jeg bursdag');
			expect(r.domains).toContain('self');
			expect(r.hints.some((h) => h.includes('/kavalkade'))).toBe(true);
		});

		it('ruter temameldinger til themes', () => {
			const r = routeChatRequest('Vis meg tema helse');
			expect(r.domains).toContain('themes');
		});

		it('ruter planmeldinger til planning', () => {
			const r = routeChatRequest('Lag en plan for uken');
			expect(r.domains).toContain('planning');
		});

		it('faller tilbake til general for ukjente meldinger', () => {
			const r = routeChatRequest('Hei, hva gjør du?');
			expect(r.domains).toContain('general');
			expect(r.mode).toBe('conversation');
		});

		it('kan returnere flere domener samtidig', () => {
			const r = routeChatRequest('Hvordan er helsen min og hva er saldoen?');
			expect(r.domains).toContain('health');
			expect(r.domains).toContain('economics');
		});
	});

	describe('skills', () => {
		it('oppdager widget_creation fra widget-nøkkelord', () => {
			const r = routeChatRequest('Lag en widget for vekten min');
			expect(r.skills).toContain('widget_creation');
			expect(r.mode).toBe('tool');
		});

		it('oppdager checklist_planning fra sjekkliste', () => {
			const r = routeChatRequest('Lag en sjekkliste for ferien');
			expect(r.skills).toContain('checklist_planning');
			expect(r.mode).toBe('tool');
		});

		it('oppdager goal_planning fra mål', () => {
			const r = routeChatRequest('Sett et nytt mål for løping');
			expect(r.skills).toContain('goal_planning');
		});

		it('oppdager procedure_management fra prosedyre', () => {
			const r = routeChatRequest('Lagre denne fremgangsmåten');
			expect(r.skills).toContain('procedure_management');
			expect(r.mode).toBe('tool');
		});

		it('oppdager person_management for familie-endringer', () => {
			const r = routeChatRequest('Legg til min datter i familien');
			expect(r.skills).toContain('person_management');
			expect(r.domains).toContain('family');
		});

		it('faller tilbake til general_chat uten spesifikke skills', () => {
			const r = routeChatRequest('Fortell meg en vits');
			expect(r.skills).toContain('general_chat');
		});
	});

	describe('hints', () => {
		it('legger til web_search-hint for nyheter', () => {
			const r = routeChatRequest('Hva skjer med krigen i Ukraina?');
			expect(r.hints.some(h => h.includes('web_search'))).toBe(true);
		});

		it('legger til widget-hint for widget-forespørsler', () => {
			const r = routeChatRequest('Vis meg en oversikt over steg');
			expect(r.hints.some(h => h.includes('widget'))).toBe(true);
		});
	});

	describe('mode-inferens', () => {
		it('tool mode for skill-tunge forespørsler', () => {
			expect(routeChatRequest('Lag en widget').mode).toBe('tool');
			expect(routeChatRequest('Lag en sjekkliste').mode).toBe('tool');
		});

		it('domain mode for domene-spørsmål uten skill-trigger', () => {
			expect(routeChatRequest('Hvordan har søvnen vært?').mode).toBe('domain');
		});

		it('conversation mode for generell prat', () => {
			expect(routeChatRequest('Hei, hvordan går det?').mode).toBe('conversation');
		});
	});

	describe('returformat', () => {
		it('returnerer alle forventede felter', () => {
			const r = routeChatRequest('Hei');
			expect(r).toHaveProperty('domains');
			expect(r).toHaveProperty('skills');
			expect(r).toHaveProperty('focusModules');
			expect(r).toHaveProperty('hints');
			expect(r).toHaveProperty('mode');
			expect(Array.isArray(r.domains)).toBe(true);
			expect(Array.isArray(r.skills)).toBe(true);
		});

		it('domainHints er undefined når ingen domener matcher', () => {
			const r = routeChatRequest('Hei');
			expect(r.domainHints).toBeUndefined();
		});

		it('domainHints er satt når domener matcher', () => {
			const r = routeChatRequest('Vis vekten min');
			expect(r.domainHints).toBeDefined();
			expect(r.domainHints!.length).toBeGreaterThan(0);
		});
	});
});
