/**
 * Kortlevde tokens til Gemini Live API.
 *
 * ## Hvorfor dette finnes
 *
 * Ekko snakker med Gemini realtime over WebSocket, og en WebSocket kan ikke
 * proxyes gjennom oss på noen fornuftig måte — lyd i sanntid tåler ikke et ekstra
 * ledd. Appen må derfor koble direkte til Google, og trenger en credential.
 *
 * Å shippe `GEMINI_API_KEY` i iOS-bundelen er ikke et alternativ: en app-binær er
 * offentlig, og nøkkelen kan ikke roteres uten en ny utgivelse gjennom App Store.
 * Google har en mekanisme for nøyaktig dette — `auth_tokens` — og Resonans er
 * riktig sted å minte dem, siden vi allerede autentiserer Ekko med `Bearer rsn_`.
 * Samme arbeidsdeling som `/api/apps/tesla/state`: nøkkelen bor på serveren, appen
 * får bare det den trenger for økta foran seg.
 *
 * ## Vakten som er hele poenget
 *
 * **`bidiGenerateContentSetup` + `fieldMask` er sikkerhetsgrensa, ikke
 * `expireTime`.** Et token uten noen setup lar den som holder det bestemme ALT ved
 * økta — modell, systeminstruksjon og `tools`. Det er da en generell Gemini-nøkkel
 * på vår kvote, bare med kortere levetid, og med `tools` åpent er angrepsflaten
 * større enn kvotemisbruk (kodekjøring gjennom verktøy).
 *
 * ## fieldMask-semantikken, som er lett å ta feil av
 *
 * Fra Googles eget discovery-dokument for `AuthToken.fieldMask`:
 *
 * - Tom maske **uten** setup → hele setupen tas fra klientens tilkobling. Ulåst.
 * - Tom maske **med** setup → den effektive setupen tas *utelukkende* fra tokenet,
 *   og klientens setup-melding **ignoreres i sin helhet**.
 * - Ikke-tom maske → bare de listede feltene overskriver klientens.
 *
 * Vi vil låse modell og verktøy, men la Ekko eie systeminstruksjon, stemme og
 * modaliteter. Det krever den tredje varianten. Utelot vi masken, ville Ekkos
 * setup blitt kastet, og appen ville fått en økt uten sin egen persona og uten
 * lydkonfigurasjonen sin — en feil som ser ut som «Gemini svarer rart», ikke som
 * en tilgangsfeil.
 *
 * ## Navnene stemmer ikke med dokumentasjonssida
 *
 * `ai.google.dev` beskriver feltet som `liveConnectConstraints` med nøstet
 * `model` og `config`. Det er **Python-SDK-ens** navn. Wire-formatet avviser det
 * («Unknown name "liveConnectConstraints" at 'auth_token'») — feltene er
 * `bidiGenerateContentSetup` og `fieldMask`, med `tools` og `model` flatt inni
 * setupen. Verifisert mot
 * `https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta`.
 * Skriv aldri denne kroppen fra hukommelsen; sjekk discovery.
 *
 * Klientsikker og ren: ingen env- eller nettverksbruk. Se
 * `$lib/server/integrations/gemini-live.ts` for kallet.
 */

/**
 * Standardmodellen — en **fallback**, ikke en anbefaling.
 *
 * Modellnavnene hos Google skifter fra uke til uke, så denne konstanten er
 * garantert å bli feil på et tidspunkt. Derfor tre ting:
 *
 * 1. `GEMINI_LIVE_MODEL` i miljøet overstyrer den, uten en kodeendring.
 * 2. `GET /api/apps/gemini/models` lister hva Google faktisk tilbyr NÅ, så valget
 *    kan tas på ferske data framfor på denne linja.
 * 3. Avviser Google modellen, videreformidles meldingen ordrett til appen — feilen
 *    skal være selvforklarende, ikke «Gemini feilet».
 *
 * Verdien her er hentet fra Googles eksempelkode 6. august 2026.
 */
export const DEFAULT_LIVE_MODEL = 'gemini-3.1-flash-live-preview';

/** Googles endepunkt for å minte tokens. */
export const AUTH_TOKENS_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/auth_tokens';

/** Modellkatalogen. Se `LIVE_GENERATION_METHOD` for hvorfor vi spør framfor å tro. */
export const MODELS_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200';

/**
 * Generasjonsmetoden en Live-modell må støtte.
 *
 * Modellnavnene hos Google skifter fra uke til uke, og en hardkodet default blir
 * feil før den blir gammel. `GET /api/apps/gemini/models` filtrerer katalogen på
 * denne metoden, slik at «hva er nyeste live-modell» besvares av API-et i
 * øyeblikket det spørres — ikke av en konstant noen skrev en gang.
 */
export const LIVE_GENERATION_METHOD = 'bidiGenerateContent';

/**
 * Feltene vi låser. Rekkefølgen er uvesentlig; innholdet er ikke.
 *
 * `tools` må stå her selv om lista er tom — masken er det som gjør tomheten
 * bindende. Uten `tools` i masken kan klienten legge til verktøy selv, og da har
 * låsingen av modellen begrenset verdi.
 */
export const LOCKED_FIELDS = ['model', 'tools'] as const;

/**
 * WebSocket-metoden for et token er en ANNEN enn for en API-nøkkel.
 *
 * `BidiGenerateContent` tar `?key=`; `BidiGenerateContentConstrained` tar
 * `?access_token=`. Det er lett å bomme på, og en app som hardkoder den feile får
 * en 4xx uten forklaring — derfor returnerer endepunktet hele URL-en framfor å la
 * Ekko sette den sammen selv.
 */
export const LIVE_WS_BASE =
	'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';

/**
 * Levetid for økta.
 *
 * Googles tak er **20 timer**; 30 minutter er vår policy, ikke API-grensa. Et
 * langt token kjøper lite: Ekko har nettverk mot oss og kan minte et nytt når som
 * helst, så den eneste effekten av lang levetid er større konsekvens hvis tokenet
 * lekker. Taket er én time for at en lang løpetur skal kunne be om mer.
 */
export const DEFAULT_TTL_SECONDS = 30 * 60;
export const MIN_TTL_SECONDS = 5 * 60;
export const MAX_TTL_SECONDS = 60 * 60;

/**
 * Vinduet appen har på seg å ÅPNE økta. Googles default er 60 sekunder.
 *
 * Vi gir to minutter, fordi ett er stramt for en telefon: tokenet hentes gjerne
 * når skjermen åpnes, og brukeren trykker start noen sekunder senere — på et
 * 4G-nett midt i en løpetur.
 *
 * Kort med vilje, og det er her forsvaret mot et lekket token ligger: `expireTime`
 * hindrer ikke at noen starter sin EGEN samtale, `newSessionExpireTime` gjør det.
 * Googles tak er 20 timer; ti minutter er vår policy.
 */
export const DEFAULT_NEW_SESSION_SECONDS = 2 * 60;
export const MIN_NEW_SESSION_SECONDS = 30;
export const MAX_NEW_SESSION_SECONDS = 10 * 60;

/**
 * Antall NYE økter tokenet tillater. Googles default er 1.
 *
 * NB: reetablering av en økt teller ikke som en bruk («Resuming a Live API session
 * does not count as a use»), så dette handler ikke om nettverksglipp underveis —
 * de dekkes gratis av session resumption. To bruk dekker det ene tilfellet som
 * ikke er gratis: en kald omstart der appen mistet resumption-handtaket, innenfor
 * det korte `newSessionExpireTime`-vinduet.
 *
 * `uses: 0` betyr ubegrenset hos Google. Vi tillater det ikke.
 */
export const DEFAULT_USES = 2;
export const MAX_USES = 5;

export interface LiveTokenRequestOptions {
	/** Sendes inn framfor å leses av `Date.now()`, slik at kroppen kan testes. */
	now: Date;
	model?: string | null;
	ttlSeconds?: number | null;
	newSessionSeconds?: number | null;
	uses?: number | null;
}

export interface AuthTokenRequestBody {
	uses: number;
	expireTime: string;
	newSessionExpireTime: string;
	/** Kommaseparert. Se fieldMask-semantikken i modulkommentaren. */
	fieldMask: string;
	bidiGenerateContentSetup: {
		model: string;
		/** Tom med vilje, og bindende gjennom masken. */
		tools: never[];
	};
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function positiveInt(value: unknown, fallback: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
	const rounded = Math.round(value);
	return rounded > 0 ? rounded : fallback;
}

/**
 * `models/`-prefikset er påkrevd i setupen.
 *
 * Vi legger det på framfor å kreve det: både `GEMINI_LIVE_MODEL` og et modellnavn
 * fra en logg vil naturlig skrives uten prefiks, og en 400 fra Google på et
 * manglende prefiks er en unødvendig runde.
 */
export function normalizeModelName(model: string | null | undefined): string {
	const raw = (model ?? '').trim() || DEFAULT_LIVE_MODEL;
	return raw.startsWith('models/') ? raw : `models/${raw}`;
}

export function buildAuthTokenRequest(opts: LiveTokenRequestOptions): AuthTokenRequestBody {
	const ttl = clamp(positiveInt(opts.ttlSeconds, DEFAULT_TTL_SECONDS), MIN_TTL_SECONDS, MAX_TTL_SECONDS);
	const newSession = clamp(
		positiveInt(opts.newSessionSeconds, DEFAULT_NEW_SESSION_SECONDS),
		MIN_NEW_SESSION_SECONDS,
		// Vinduet for å åpne økta kan ikke være lengre enn økta selv.
		Math.min(MAX_NEW_SESSION_SECONDS, ttl)
	);
	const uses = clamp(positiveInt(opts.uses, DEFAULT_USES), 1, MAX_USES);
	const start = opts.now.getTime();

	return {
		uses,
		expireTime: new Date(start + ttl * 1000).toISOString(),
		newSessionExpireTime: new Date(start + newSession * 1000).toISOString(),
		fieldMask: LOCKED_FIELDS.join(','),
		bidiGenerateContentSetup: {
			model: normalizeModelName(opts.model),
			tools: []
		}
	};
}

export interface ParsedAuthToken {
	/** Selve credentialen. Google returnerer den som `name`, f.eks. `auth_tokens/…`. */
	token: string;
	expiresAt: string | null;
	newSessionExpiresAt: string | null;
}

export class GeminiTokenShapeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'GeminiTokenShapeError';
	}
}

/**
 * Plukker credentialen ut av Googles svar.
 *
 * Den ligger i `name`, ikke i et felt som heter `token` — et navn som inviterer
 * til å lese feil felt og sende et tomt token videre. Kaster framfor å returnere
 * null: et svar uten `name` er en endret API-kontrakt, og den skal være støyende.
 */
export function parseAuthTokenResponse(payload: unknown): ParsedAuthToken {
	if (!payload || typeof payload !== 'object') {
		throw new GeminiTokenShapeError('Svaret fra Google var ikke et objekt.');
	}
	const record = payload as Record<string, unknown>;
	const name = typeof record.name === 'string' ? record.name.trim() : '';
	if (!name) {
		throw new GeminiTokenShapeError(
			`Svaret fra Google manglet feltet «name». Nøkler som kom: ${Object.keys(record).join(', ') || '(ingen)'}.`
		);
	}

	return {
		token: name,
		expiresAt: typeof record.expireTime === 'string' ? record.expireTime : null,
		newSessionExpiresAt:
			typeof record.newSessionExpireTime === 'string' ? record.newSessionExpireTime : null
	};
}

/** Hele WebSocket-URL-en, ferdig til bruk. Se `LIVE_WS_BASE` for hvorfor. */
export function liveWebSocketUrl(token: string): string {
	return `${LIVE_WS_BASE}?access_token=${encodeURIComponent(token)}`;
}

/**
 * Fjerner alt som kan være en API-nøkkel fra en feilmelding før den logges eller
 * returneres.
 *
 * Googles 400-svar gjentar av og til forespørselen, og en feilmelding som havner i
 * en Vercel-logg eller i en JSON-respons til appen er et sted en nøkkel ikke skal
 * kunne dukke opp. `AIza…` er Googles nøkkelformat.
 */
export function redactApiKeys(message: string, key?: string | null): string {
	let out = message.replace(/AIza[0-9A-Za-z_-]{10,}/g, '[nøkkel fjernet]');
	if (key && key.length >= 8) {
		out = out.split(key).join('[nøkkel fjernet]');
	}
	return out;
}

export interface LiveModelInfo {
	/** Uten `models/`-prefiks, klart til å settes i `GEMINI_LIVE_MODEL`. */
	id: string;
	name: string;
	displayName: string | null;
	description: string | null;
	version: string | null;
	/** Sann for den vi ville brukt hvis ingenting er valgt. */
	isDefault: boolean;
}

/**
 * Live-modellene i Googles katalog, nyeste først.
 *
 * Filtreringen er på `supportedGenerationMethods`, ikke på navnemønster: et navn
 * som inneholder «live» er en gjetning, mens metodelista er modellens egen
 * erklæring om at den kan brukes over WebSocket.
 */
export function selectLiveModels(payload: unknown, defaultModel: string): LiveModelInfo[] {
	const models = (payload as { models?: unknown } | null)?.models;
	if (!Array.isArray(models)) return [];

	const normalizedDefault = normalizeModelName(defaultModel);

	return models
		.flatMap((entry): LiveModelInfo[] => {
			if (!entry || typeof entry !== 'object') return [];
			const row = entry as Record<string, unknown>;
			const name = typeof row.name === 'string' ? row.name : '';
			if (!name) return [];
			const methods = Array.isArray(row.supportedGenerationMethods)
				? row.supportedGenerationMethods
				: [];
			if (!methods.includes(LIVE_GENERATION_METHOD)) return [];

			return [
				{
					id: name.replace(/^models\//, ''),
					name,
					displayName: typeof row.displayName === 'string' ? row.displayName : null,
					description: typeof row.description === 'string' ? row.description : null,
					version: typeof row.version === 'string' ? row.version : null,
					isDefault: name === normalizedDefault
				}
			];
		})
		// Nyeste først, så det øverste navnet er det man vil se etter. Sorteringen er
		// på navn og ikke på en dato — katalogen oppgir ingen — så den er en
		// tilnærming: versjonsnumrene i navnene stiger over tid.
		.sort((a, b) => b.id.localeCompare(a.id, 'en'));
}
