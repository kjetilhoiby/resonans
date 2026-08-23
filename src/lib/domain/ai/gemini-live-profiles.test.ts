import { describe, it, expect } from 'vitest';
import {
	ASSISTANT_FUNCTION_DECLARATIONS,
	COACH_FUNCTION_DECLARATIONS,
	COACH_TONES,
	DEFAULT_COACH_TONE,
	MINT_RATE_LIMIT_PER_HOUR,
	MINT_RATE_WINDOW_MS,
	TOOLSET_VERSION,
	evaluateMintRateLimit,
	isProfileDisabled,
	personaForProfile,
	resolveCoachTone,
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
			// Bumpet til 2 da personaen fikk et tonetillegg (22. august 2026).
			expect(persona?.version).toBe(2);
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

describe('coach-toner', () => {
	it('ukjent, tom og manglende tone gir nøytral — en tone kan ikke gjøre noe galt', () => {
		for (const raw of [undefined, null, '', 'pushy', 'nøytral', 42, {}]) {
			expect(resolveCoachTone(raw)).toBe('noytral');
		}
	});

	it('alle kjente toner overlever oppslaget', () => {
		for (const tone of COACH_TONES) {
			expect(resolveCoachTone(tone)).toBe(tone);
		}
	});

	it('nøkkelnavnene er ASCII — «ø» blir spørsmålstegn i det laget ingen tester', () => {
		for (const tone of COACH_TONES) {
			expect(tone).toMatch(/^[a-z]+$/);
		}
	});

	it('tonen ekkoes på personaen, så et valg som ikke nådde fram er synlig', () => {
		expect(personaForProfile('coach', 'vennlig')?.tone).toBe('vennlig');
		expect(personaForProfile('coach')?.tone).toBe(DEFAULT_COACH_TONE);
	});

	it('hver tone gir en MERKBART ulik coach-preamble', () => {
		// Fire valg som gir samme prompt er fire valg som ikke finnes.
		const preambles = COACH_TONES.map((tone) => personaForProfile('coach', tone)!.preamble);
		expect(new Set(preambles).size).toBe(COACH_TONES.length);
	});

	it('GRUNNREGLENE står uansett tone — en innstilling skal ikke kunne prompte dem bort', () => {
		for (const tone of COACH_TONES) {
			const coach = personaForProfile('coach', tone)!.preamble;
			expect(coach).toContain('Siter tallene du får ordrett');
			expect(coach).toContain('«ekko»');
			expect(coach).toContain('Bekreft muntlig før du deler posisjon');

			const assistant = personaForProfile('assistant', tone)!.preamble;
			expect(assistant).toContain('startWorkout');
			expect(assistant).toContain('«ekko»');
		}
	});

	it('ingen tone lover noe om helsa — vi måler fart og puls, ikke hva som er bra for noen', () => {
		for (const tone of COACH_TONES) {
			const preamble = personaForProfile('coach', tone)!.preamble;
			expect(preamble).toContain('Ikke påstå noe om helse');
		}
	});

	it('voice-test har ingen persona og dermed ingen tone — spiken er urørt', () => {
		for (const tone of COACH_TONES) {
			expect(personaForProfile('voice-test', tone)).toBeNull();
		}
	});

	it('«krevende» presser og «vennlig» gjør det motsatte', () => {
		expect(personaForProfile('coach', 'krevende')!.preamble).toContain('presse');
		expect(personaForProfile('coach', 'vennlig')!.preamble).toContain('uten press');
		// Den vennlige finnes for lange, rolige turer — lav fart er MENINGEN der, ikke et avvik.
		expect(personaForProfile('coach', 'vennlig')!.preamble).toContain('lav fart er meningen');
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
		expect(decision.remaining).toBe(MINT_RATE_LIMIT_PER_HOUR - 6);
		expect(decision.retryAfterSeconds).toBeNull();
	});

	it('avviser på grensa med retryAfter mot den som må eldes ut', () => {
		// Tett nok til å ligge inne i timesvinduet: 20 mint med to minutters mellomrom.
		const decision = evaluateMintRateLimit(mints(MINT_RATE_LIMIT_PER_HOUR, 2), NOW);
		expect(decision.allowed).toBe(false);
		// Eldste mint er 40 min gammel → faller ut av timesvinduet om 20 minutter.
		expect(decision.retryAfterSeconds).toBe((60 - MINT_RATE_LIMIT_PER_HOUR * 2) * 60);
	});

	it('gårsdagens loop koster ingenting i dag — og timen før koster ingenting nå', () => {
		// Formålet med å bytte fra døgn til time: en loop som brant 18 mint i går kveld skal
		// ikke kunne blokkere en test i dag. 17. august var kvota tom kl. 20:46 av den grunn.
		const lastNight = Array.from(
			{ length: 18 },
			(_, i) => new Date(NOW.getTime() - 3 * 60 * 60 * 1000 - i * 60 * 1000)
		);
		expect(evaluateMintRateLimit(lastNight, NOW).allowed).toBe(true);
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
		// være i nærheten av å stoppes. Med timesvindu er bare de siste to inne i det.
		const longRun = mints(8, 25);
		expect(evaluateMintRateLimit(longRun, NOW).allowed).toBe(true);
	});
});
