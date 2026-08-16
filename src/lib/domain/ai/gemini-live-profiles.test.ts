import { describe, it, expect } from 'vitest';
import {
	ASSISTANT_FUNCTION_DECLARATIONS,
	COACH_FUNCTION_DECLARATIONS,
	MINT_RATE_LIMIT_PER_DAY,
	MINT_RATE_WINDOW_MS,
	TOOLSET_VERSION,
	evaluateMintRateLimit,
	isProfileDisabled,
	personaForProfile,
	resolveTokenProfile,
	toolNamesForProfile,
	toolsForProfile
} from './gemini-live-profiles';
import { buildAuthTokenRequest, LOCKED_FIELDS } from './gemini-live-token';

const NOW = new Date('2026-08-14T10:00:00.000Z');

describe('resolveTokenProfile', () => {
	it('faller tilbake til voice-test på alt ukjent — feature-detection, ikke feil', () => {
		// En 400 på ukjent profil ville gjort en gammel server umulig å skille fra
		// en nede server. Ukjent → dagens oppførsel, som begge generasjoner tåler.
		expect(resolveTokenProfile(undefined)).toBe('voice-test');
		expect(resolveTokenProfile(null)).toBe('voice-test');
		expect(resolveTokenProfile('noe-nytt')).toBe('voice-test');
		expect(resolveTokenProfile(42)).toBe('voice-test');
	});

	it('kjenner de tre profilene', () => {
		expect(resolveTokenProfile('voice-test')).toBe('voice-test');
		expect(resolveTokenProfile('assistant')).toBe('assistant');
		expect(resolveTokenProfile('coach')).toBe('coach');
	});
});

describe('toolsForProfile', () => {
	it('voice-test er tom — spiken skal være byte-identisk med før profilene fantes', () => {
		expect(toolsForProfile('voice-test')).toEqual([]);
	});

	it('coach får handlinger appen alt kan gjøre, ikke nye', () => {
		// Avgrensningen er poenget: dette er ting som til nå krevde at man tok opp
		// telefonen midt i en løpetur. `markLap` er utelatt fordi en runde henger
		// sammen med autohaking, effort og progresjon — det skal ikke oppfinnes i en
		// verktøydeklarasjon.
		expect(toolNamesForProfile('coach')).toEqual([
			'startSharing',
			'stopSharing',
			'sendViewerReply'
		]);
	});

	it('getWorkoutStatus finnes ikke — klienten sender fersk status ved hvert mic-vindu', () => {
		// Et verktøy for tall modellen allerede har er en ekstra rundtur midt i en økt.
		expect(toolNamesForProfile('coach')).not.toContain('getWorkoutStatus');
	});

	it('deling krever muntlig bekreftelse i selve beskrivelsen', () => {
		const share = COACH_FUNCTION_DECLARATIONS.find((d) => d.name === 'startSharing');
		expect(share!.description).toContain('Bekreft muntlig');
	});

	it('assistant låser executor-verktøyene, med startWorkout.place', () => {
		// Navnene speiler AssistantToolExecutor i Ekko én til én — samme executor
		// kjører SSE-veien og Live-veien.
		expect(toolNamesForProfile('assistant')).toEqual([
			'driveDistance',
			'resolvePlace',
			'nearestPlace',
			'sendToCar',
			'startWorkout',
			'calendarLookup'
		]);
		const startWorkout = ASSISTANT_FUNCTION_DECLARATIONS.find((d) => d.name === 'startWorkout');
		expect(Object.keys(startWorkout!.parameters.properties)).toContain('place');
	});

	it('startWorkout krever muntlig bekreftelse i selve beskrivelsen', () => {
		// Vakten mot utilsiktet øktstart bor i skjemaet OG i personaen. Skjemaet er
		// det modellen leser når den velger verktøy.
		const startWorkout = ASSISTANT_FUNCTION_DECLARATIONS.find((d) => d.name === 'startWorkout');
		expect(startWorkout!.description).toMatch(/[Bb]ekreft/);
	});

	it('skjemaene bruker wire-typene (OBJECT/STRING/NUMBER), ikke JSON Schema-små', () => {
		for (const declaration of ASSISTANT_FUNCTION_DECLARATIONS) {
			expect(declaration.parameters.type).toBe('OBJECT');
			for (const property of Object.values(declaration.parameters.properties)) {
				expect(['STRING', 'NUMBER']).toContain(property.type);
			}
		}
	});
});

describe('buildAuthTokenRequest med profil', () => {
	it('uten profil er kroppen byte-identisk med voice-test — kontrakten mot gamle klienter', () => {
		expect(JSON.stringify(buildAuthTokenRequest({ now: NOW }))).toBe(
			JSON.stringify(buildAuthTokenRequest({ now: NOW, profile: 'voice-test' }))
		);
	});

	it('assistant-profilen legger verktøyene i setupet', () => {
		const body = buildAuthTokenRequest({ now: NOW, profile: 'assistant' });
		expect(body.bidiGenerateContentSetup.tools).toEqual([
			{ functionDeclarations: ASSISTANT_FUNCTION_DECLARATIONS }
		]);
	});

	it('masken forblir model,tools for alle profiler — klienten eier resten', () => {
		// sessionResumption, systemInstruction, responseModalities, transkripsjon
		// og realtimeInputConfig skal forbli KLIENT-skrivbare (brief §2). De er det
		// nøyaktig så lenge masken bare dekker model og tools.
		for (const profile of ['voice-test', 'assistant', 'coach'] as const) {
			expect(buildAuthTokenRequest({ now: NOW, profile }).fieldMask).toBe(LOCKED_FIELDS.join(','));
		}
	});

	it('coach-profilen låser coach-verktøyene men ikke systemInstruction', () => {
		// systemInstruction må forbli klient-skrivbar: øktrammen (sport, mål, rute) og
		// kald-oppstartens ferske tall bygges i appen og kan ikke ligge i tokenet.
		const body = buildAuthTokenRequest({ now: NOW, profile: 'coach' });
		expect(body.bidiGenerateContentSetup.tools).toEqual([
			{ functionDeclarations: COACH_FUNCTION_DECLARATIONS }
		]);
		expect(body.bidiGenerateContentSetup).not.toHaveProperty('systemInstruction');
	});
});

describe('personaForProfile', () => {
	it('voice-test har ingen persona — spiken eier sin egen instruks', () => {
		expect(personaForProfile('voice-test')).toBeNull();
	});

	it('assistant og coach har versjonert preamble på norsk', () => {
		for (const profile of ['assistant', 'coach'] as const) {
			const persona = personaForProfile(profile);
			expect(persona?.version).toBe(1);
			expect(persona?.preamble).toMatch(/norsk/i);
		}
	});

	it('personaen forbyr ordet «ekko» — det er vekkeordet for barge-inn', () => {
		// En modell som sier «ekko» avbryter seg selv midt i setningen.
		expect(personaForProfile('assistant')?.preamble).toContain('«ekko»');
		expect(personaForProfile('coach')?.preamble).toContain('«ekko»');
	});

	it('assistant-personaen krever muntlig bekreftelse før startWorkout', () => {
		expect(personaForProfile('assistant')?.preamble).toContain('startWorkout');
	});
});

describe('isProfileDisabled (kill switch)', () => {
	it('ingenting er avslått uten env', () => {
		expect(isProfileDisabled(undefined, 'assistant')).toBe(false);
		expect(isProfileDisabled('', 'assistant')).toBe(false);
	});

	it('leser kommaseparert liste, tolerant for mellomrom og store bokstaver', () => {
		expect(isProfileDisabled('assistant', 'assistant')).toBe(true);
		expect(isProfileDisabled(' Assistant , coach', 'coach')).toBe(true);
		expect(isProfileDisabled('coach', 'assistant')).toBe(false);
	});

	it('slår aldri av mer enn det som står der', () => {
		// «assistant» i lista skal ikke treffe voice-test via delstreng-logikk.
		expect(isProfileDisabled('assistant', 'voice-test')).toBe(false);
	});
});

describe('evaluateMintRateLimit', () => {
	function mints(count: number, spacingMinutes = 10): Date[] {
		return Array.from(
			{ length: count },
			(_, i) => new Date(NOW.getTime() - (i + 1) * spacingMinutes * 60 * 1000)
		);
	}

	it('slipper gjennom under grensa og teller ned remaining', () => {
		const decision = evaluateMintRateLimit(mints(5), NOW);
		expect(decision.allowed).toBe(true);
		expect(decision.remaining).toBe(MINT_RATE_LIMIT_PER_DAY - 6);
		expect(decision.retryAfterSeconds).toBeNull();
	});

	it('avviser på grensa med retryAfter mot den som må eldes ut', () => {
		const decision = evaluateMintRateLimit(mints(MINT_RATE_LIMIT_PER_DAY), NOW);
		expect(decision.allowed).toBe(false);
		// Eldste mint er 300 min gammel → den faller ut av døgnvinduet om 24 t − 300 min.
		expect(decision.retryAfterSeconds).toBe((24 * 60 - MINT_RATE_LIMIT_PER_DAY * 10) * 60);
	});

	it('ignorerer minter utenfor vinduet — gårsdagens økter koster ingenting i dag', () => {
		const old = Array.from(
			{ length: 100 },
			(_, i) => new Date(NOW.getTime() - MINT_RATE_WINDOW_MS - (i + 1) * 1000)
		);
		expect(evaluateMintRateLimit(old, NOW).allowed).toBe(true);
	});

	it('runder retryAfter OPP, så et nytt forsøk på sekundet ikke får nei igjen', () => {
		const justInside = [new Date(NOW.getTime() - MINT_RATE_WINDOW_MS + 500)];
		const decision = evaluateMintRateLimit(justInside, NOW, 1);
		expect(decision.allowed).toBe(false);
		expect(decision.retryAfterSeconds).toBe(1);
	});

	it('en 3-timers økt med rotasjon hvert 25. minutt går klart under grensa', () => {
		// Dimensjoneringstesten fra briefen: ~6–8 minter på en lang tur skal aldri
		// være i nærheten av å stoppes.
		const longRun = mints(8, 25);
		expect(evaluateMintRateLimit(longRun, NOW).allowed).toBe(true);
	});
});
