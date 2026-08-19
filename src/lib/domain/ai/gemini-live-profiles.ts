/**
 * Token-profiler for Gemini Live — hvem økta er FOR avgjør hva tokenet låser.
 *
 * ## Hvorfor profiler, ikke ett token
 *
 * Spiken («voice-test») trengte bare lyd. Assistenten (fase 1 i
 * `ekko/GEMINI_LIVE_VOICE_BRIEF.md`) trenger verktøy — og verktøyskjemaene MÅ
 * bo her, i det constrainede setupet, ikke i appen: et skjema klienten selv
 * kunne sette er ingen sikkerhetsgrense, og to kopier av et skjema (app +
 * server) driver fra hverandre uten at noen ser det. Serveren er single source
 * of truth; klienten har bare en navne-allow-list og `toolsetVersion`-sjekk.
 *
 * ## Kontrakten mot gamle klienter
 *
 * Ukjent eller manglende `profile` → `voice-test`, som oppfører seg
 * byte-identisk med endepunktet før profiler fantes. Det er feature-detection
 * begge veier: en gammel app merker ingenting, og en ny app som ikke får
 * `profile` ekkoet tilbake vet at serveren er gammel og holder Live-verktøy av.
 *
 * Klientsikker og ren: ingen env- eller nettverksbruk. Kallstedet i
 * `$lib/server/integrations/gemini-live.ts`, endepunktet i
 * `routes/api/apps/gemini/ephemeral-token/+server.ts`.
 */

export const TOKEN_PROFILES = ['voice-test', 'assistant', 'coach'] as const;
export type TokenProfile = (typeof TOKEN_PROFILES)[number];

/**
 * Ukjent → `voice-test`, aldri en feil.
 *
 * En 400 på et ukjent profilnavn ville gjort en gammel server umulig å skille
 * fra en nede server for en ny klient. Fallback til dagens oppførsel er den
 * responsen begge generasjoner av appen kan leve med.
 */
export function resolveTokenProfile(raw: unknown): TokenProfile {
	return typeof raw === 'string' && (TOKEN_PROFILES as readonly string[]).includes(raw)
		? (raw as TokenProfile)
		: 'voice-test';
}

/**
 * Bumpes når et skjema endres inkompatibelt. Klienten sammenligner mot sin
 * egen kjente versjon og holder verktøy av ved sprik — en app som sender
 * argumenter etter et gammelt skjema er verre enn en uten verktøy.
 */
export const TOOLSET_VERSION = 1;

interface FunctionParameterProperty {
	type: 'STRING' | 'NUMBER';
	description?: string;
}

export interface GeminiFunctionDeclaration {
	name: string;
	description: string;
	parameters: {
		type: 'OBJECT';
		properties: Record<string, FunctionParameterProperty>;
		required?: string[];
	};
}

export interface GeminiTool {
	functionDeclarations: GeminiFunctionDeclaration[];
}

/**
 * Assistentens verktøy — speiler `AssistantToolExecutor` i Ekko én til én.
 *
 * Navnene og semantikken er identiske med SSE-veiens verktøy
 * (`ekko/ASSISTANT_HYBRID_TOOLS.md`), slik at samme executor kjører begge
 * transportene. Beskrivelsene er på norsk fordi samtalen er det.
 *
 * `startWorkout` sier «Bekreft muntlig» i beskrivelsen OG i personaen — en
 * feilstart er reversibel og lokal, men den skal ikke skje fordi modellen
 * gjettet.
 */
export const ASSISTANT_FUNCTION_DECLARATIONS: GeminiFunctionDeclaration[] = [
	{
		name: 'driveDistance',
		description: 'Kjøreavstand og ETA fra bilens posisjon til et mål (lagret sted eller adresse).',
		parameters: {
			type: 'OBJECT',
			properties: { to: { type: 'STRING' } },
			required: ['to']
		}
	},
	{
		name: 'resolvePlace',
		description: 'Slå opp om et sted/navn er kjent for brukeren.',
		parameters: {
			type: 'OBJECT',
			properties: { name: { type: 'STRING' } },
			required: ['name']
		}
	},
	{
		name: 'nearestPlace',
		description: 'Hvilket kjent sted bilen står ved nå.',
		parameters: { type: 'OBJECT', properties: {} }
	},
	{
		name: 'sendToCar',
		description: 'Lag en delbar mål-lenke brukeren kan åpne i bilen.',
		parameters: {
			type: 'OBJECT',
			properties: { to: { type: 'STRING' } },
			required: ['to']
		}
	},
	{
		name: 'startWorkout',
		description: 'Start en treningsøkt i appen. Bekreft muntlig med brukeren før du kaller denne.',
		parameters: {
			type: 'OBJECT',
			properties: {
				// NB: lista MÅ stemme med `AssistantToolExecutor.sport(from:)` i Ekko. Fram til
				// 17. august 2026 manglet «elsykkel» her mens appen kjente den — og en modell som
				// bare får se seks verdier finner sin egen syvende. Felttesten: brukeren ba om
				// elsykkel, modellen bekreftet «sykkeløkt … på elsykkel» høyt, og økta ble LØPING,
				// fordi verdien den sendte ikke traff noen gren i appen.
				type: {
					type: 'STRING',
					description: 'løp|sykkel|elsykkel|gåtur|ski|tredemølle|yoga (default løp)'
				},
				distanceKm: { type: 'NUMBER' },
				minutes: { type: 'NUMBER' },
				shape: { type: 'STRING', description: 'tur-retur|én vei|rundtur' },
				pace: { type: 'STRING', description: 'måltempo, «5:30» eller «5,5»' },
				place: { type: 'STRING', description: 'sted økta starter/går, f.eks. «Haraløkka»' }
			}
		}
	},
	{
		name: 'calendarLookup',
		description: 'Read-only kalenderoppslag.',
		parameters: {
			type: 'OBJECT',
			properties: {
				from: { type: 'STRING', description: 'yyyy-MM-dd' },
				to: { type: 'STRING' },
				query: { type: 'STRING' }
			}
		}
	}
];

/**
 * Verktøyene som låses inn i tokenets setup, per profil.
 *
 * `coach` er tom i fase 3a med vilje — coach-verktøyene (markLap,
 * sendViewerReply, startSharing, getWorkoutStatus) designes i fase 3b-PR-en.
 * Tomheten er like bindende som assistentens liste: masken dekker `tools`
 * uansett.
 */
/**
 * Coach-verktøy (brief-PR 11) — handlinger under en pågående økt.
 *
 * Avgrensningen er bevisst smal: dette er ting appen ALLEREDE kan gjøre, som til nå
 * krevde at man tok opp telefonen midt i en løpetur. Verktøy som ville krevd ny
 * domeneatferd (markere runde manuelt) er holdt utenfor — en runde er koblet til
 * autohaking, effort og progresjon, og skal ikke oppfinnes gjennom en verktøydeklarasjon.
 *
 * `getWorkoutStatus` finnes med vilje IKKE: klienten sender en fersk `[status]`-linje hver
 * gang mikrofonvinduet åpnes, så modellen har alltid tallene når brukeren spør. Et verktøy
 * for det samme ville vært en ekstra rundtur for data den allerede har.
 */
export const COACH_FUNCTION_DECLARATIONS: GeminiFunctionDeclaration[] = [
	{
		name: 'startSharing',
		description:
			'Start posisjonsdeling for den pågående økta og gi brukeren en delbar lenke. Bekreft muntlig før du kaller denne.',
		parameters: { type: 'OBJECT', properties: {} }
	},
	{
		name: 'stopSharing',
		description: 'Avslutt posisjonsdelingen for den pågående økta.',
		parameters: { type: 'OBJECT', properties: {} }
	},
	{
		name: 'sendViewerReply',
		description:
			'Send en kort melding til dem som følger økta i sanntid. Brukes når brukeren ber deg svare noen som ser på — ikke for vanlig coaching.',
		parameters: {
			type: 'OBJECT',
			properties: { text: { type: 'STRING', description: 'Meldingen, med brukerens egne ord.' } },
			required: ['text']
		}
	}
];

export function toolsForProfile(profile: TokenProfile): GeminiTool[] {
	if (profile === 'assistant') return [{ functionDeclarations: ASSISTANT_FUNCTION_DECLARATIONS }];
	if (profile === 'coach') return [{ functionDeclarations: COACH_FUNCTION_DECLARATIONS }];
	return [];
}

/** Navnelista til `capabilities.tools` i token-svaret — klientens allow-list. */
export function toolNamesForProfile(profile: TokenProfile): string[] {
	return toolsForProfile(profile).flatMap((tool) =>
		tool.functionDeclarations.map((declaration) => declaration.name)
	);
}

export interface TokenPersona {
	version: number;
	preamble: string;
}

/**
 * Persona-preamblene bor på serveren så stemmen kan itereres på Vercel uten et
 * TestFlight-bygg. Klienten appender sin egen økt-/situasjonsspesifikke blokk.
 *
 * «Unngå ordet ekko» er ikke stil: «ekko» er vekkeordet for barge-inn, og en
 * modell som sier det avbryter seg selv.
 */
const PERSONAS: Record<TokenProfile, TokenPersona | null> = {
	'voice-test': null,
	assistant: {
		version: 1,
		preamble: [
			'Du er Ekko, en norsk stemmeassistent for trening, kjøring og hverdagslogistikk.',
			'Svar på norsk bokmål, i korte talte setninger — du blir lest høyt, ikke vist på skjerm.',
			'Ett spørsmål om gangen når noe er uklart.',
			'Før du kaller startWorkout: gjenta hva du starter og få et muntlig ja.',
			'Tall sies naturlig («fem kilometer», ikke «5,0 km»).',
			'Unngå ordet «ekko» i svarene dine.'
		].join(' ')
	},
	coach: {
		version: 1,
		preamble: [
			'Du er en norsk løpecoach som snakker i ørepropper under en økt.',
			'Norsk bokmål, én til to korte setninger per melding, aldri lister.',
			'Siter tallene du får ordrett — regn aldri om dem selv.',
			'Du kan starte og stoppe posisjonsdeling og sende meldinger til dem som følger økta.',
			'Bekreft muntlig før du deler posisjon — det er en handling brukeren skal ha bedt om.',
			'Unngå ordet «ekko» i svarene dine.'
		].join(' ')
	}
};

export function personaForProfile(profile: TokenProfile): TokenPersona | null {
	return PERSONAS[profile];
}

/**
 * Kill switch per profil, uten app-release: `GEMINI_LIVE_DISABLED_PROFILES` er
 * en kommaseparert liste, og en avslått profil svarer
 * `403 { "error": "profile_disabled" }` — klienten faller da tilbake
 * (SSE-samtale / regelcoach). Ren parsing her; env-lesingen bor på kallstedet.
 */
export function isProfileDisabled(envValue: string | null | undefined, profile: TokenProfile): boolean {
	if (!envValue) return false;
	return envValue
		.split(',')
		.map((part) => part.trim().toLowerCase())
		.includes(profile);
}

/**
 * Mint-ratelimit: 20 per bruker per rullende TIME.
 *
 * **Vakten finnes for å stoppe en klient i loop, ikke for å budsjettere bruk.** Google har
 * ingen dagsgrense på utstedte tokens; kostnaden ligger i Live-BRUKEN (lydminutter), og den
 * er bundet av hvor lenge man faktisk snakker — ikke av hvor mange tokens som ble mintet.
 * Antall mint er derfor en dårlig proxy for kostnad, og en god proxy for «noe kjører løpsk».
 *
 * **Vinduet var et døgn fram til 17. august 2026, og det var feil form.** En loop gjør 18
 * mint i 20 minutter (målt, 16. august); et døgnvindu fanger den, men straffer deretter en
 * hel dag. I praksis: kvota var tom kl. 08:47, og fortsatt tom kl. 20:46 — på grunn av gårsdagens
 * kveld. En testdag ble spist av en feil som alt var rettet. En rullende time fanger loopen
 * **raskere** (20 minutter mot 24 timer) og er usynlig for normal bruk.
 *
 * Dimensjonering etter at klienten gjenbruker tokenet ved gjenopptakelse: én økt ≈ 1 mint,
 * en 3-timers tur ≈ 6 med planlagt rotasjon. 20 i timen er altså rikelig for en testdag med
 * gjentatte økter, og trippes bare av noe som er i stykker.
 */
export const MINT_RATE_LIMIT_PER_HOUR = 20;
export const MINT_RATE_WINDOW_MS = 60 * 60 * 1000;

export interface MintRateDecision {
	allowed: boolean;
	/** Antall mint som gjenstår i vinduet ETTER denne (0 når avvist). */
	remaining: number;
	/** Sekunder til neste mint slipper gjennom. Bare satt når avvist. */
	retryAfterSeconds: number | null;
}

/**
 * Avgjør om en ny mint slipper gjennom, gitt tidspunktene for brukerens
 * tidligere minter. Tidspunkter utenfor vinduet ignoreres, så kallstedet kan
 * sende alt det har.
 *
 * `retryAfterSeconds` peker på når den blokkerende minten faller ut av
 * vinduet: med `limit` eller flere minter i vinduet er det den
 * `limit`-te-nyeste som må eldes ut før tellinga kommer under grensa igjen.
 * Rundes OPP — en klient som prøver på sekundet skal ikke få nei én gang til.
 */
export function evaluateMintRateLimit(
	previousMints: Date[],
	now: Date,
	limit: number = MINT_RATE_LIMIT_PER_HOUR
): MintRateDecision {
	const windowStart = now.getTime() - MINT_RATE_WINDOW_MS;
	const inWindow = previousMints
		.map((d) => d.getTime())
		.filter((t) => t > windowStart && t <= now.getTime())
		.sort((a, b) => a - b);

	if (inWindow.length < limit) {
		return { allowed: true, remaining: limit - inWindow.length - 1, retryAfterSeconds: null };
	}

	// Den som må eldes ut: med nøyaktig `limit` i vinduet er det den eldste;
	// med flere er det den som lar tellinga falle til `limit - 1`.
	const blocker = inWindow[inWindow.length - limit];
	const retryAfterSeconds = Math.max(1, Math.ceil((blocker + MINT_RATE_WINDOW_MS - now.getTime()) / 1000));
	return { allowed: false, remaining: 0, retryAfterSeconds };
}
