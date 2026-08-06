import { env } from '$env/dynamic/private';
import {
	AUTH_TOKENS_ENDPOINT,
	DEFAULT_LIVE_MODEL,
	MODELS_ENDPOINT,
	buildAuthTokenRequest,
	liveWebSocketUrl,
	parseAuthTokenResponse,
	redactApiKeys,
	selectLiveModels,
	type LiveModelInfo,
	type LiveTokenRequestOptions,
	type ParsedAuthToken
} from '$lib/domain/ai/gemini-live-token';

/**
 * Minter kortlevde Gemini Live-tokens på Ekkos vegne.
 *
 * Kallet mot Google ligger her; reglene for hva tokenet får lov til ligger i
 * `$lib/domain/ai/gemini-live-token.ts`, som er ren og testet. Se den fila for
 * hvorfor `liveConnectConstraints` — og ikke utløpstida — er sikkerhetsgrensa.
 */

export class GeminiNotConfiguredError extends Error {
	constructor() {
		super('GEMINI_API_KEY er ikke satt i miljøet.');
		this.name = 'GeminiNotConfiguredError';
	}
}

export class GeminiTokenMintError extends Error {
	readonly status: number;
	constructor(message: string, status: number) {
		super(message);
		this.name = 'GeminiTokenMintError';
		this.status = status;
	}
}

export interface MintedLiveToken extends ParsedAuthToken {
	model: string;
	uses: number;
	/** Ferdig WebSocket-URL med tokenet i. */
	websocketUrl: string;
}

/**
 * Leser nøkkelen. Kaster en egen feiltype framfor å returnere null, slik at
 * kallstedet kan svare 503 «ikke konfigurert» og ikke 502 «Google feilet» — de to
 * krever helt ulik handling, og en app som får 502 vil prøve igjen i evighet.
 */
function readApiKey(): string {
	const key = env.GEMINI_API_KEY?.trim();
	if (!key) throw new GeminiNotConfiguredError();
	return key;
}

export function configuredLiveModel(): string | null {
	return env.GEMINI_LIVE_MODEL?.trim() || null;
}

/** Feilteksten fra et Google-svar, uten at nøkkelen kan lekke med. */
function describeGoogleError(status: number, body: string, key: string): string {
	let detail = body.slice(0, 500);
	try {
		const parsed = JSON.parse(body) as { error?: { message?: unknown; status?: unknown } };
		const message = parsed.error?.message;
		if (typeof message === 'string' && message) {
			const code = typeof parsed.error?.status === 'string' ? ` (${parsed.error.status})` : '';
			detail = `${message}${code}`;
		}
	} catch {
		// Ikke JSON — den avkortede kroppen er da det beste vi har.
	}
	return redactApiKeys(`Google svarte ${status}: ${detail}`, key);
}

export async function mintLiveToken(
	opts: Omit<LiveTokenRequestOptions, 'now'> & { now?: Date } = {}
): Promise<MintedLiveToken> {
	const key = readApiKey();
	const body = buildAuthTokenRequest({
		...opts,
		// Miljøvariabelen er standarden; et eksplisitt valg fra kallstedet vinner.
		model: opts.model ?? configuredLiveModel(),
		now: opts.now ?? new Date()
	});

	let response: Response;
	try {
		response = await fetch(AUTH_TOKENS_ENDPOINT, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-goog-api-key': key
			},
			body: JSON.stringify(body)
		});
	} catch (err) {
		// Nettverksfeil mot Google, ikke en avvist forespørsel.
		throw new GeminiTokenMintError(
			redactApiKeys(`Nådde ikke Google: ${err instanceof Error ? err.message : String(err)}`, key),
			502
		);
	}

	const text = await response.text();
	if (!response.ok) {
		/**
		 * Googles egen melding videreformidles med vilje.
		 *
		 * Den vanligste feilen her er et modellnavn som ikke finnes lenger, og
		 * «Gemini feilet» ville gjort den uløselig uten tilgang til loggen. Samme
		 * prinsipp som `extractApiErrorMessage` i klienten — konsekvensen skal sies,
		 * ikke oppdages. 401/403 fra Google speiles som 502: det er VÅR nøkkel som
		 * er avvist, ikke Ekkos, og en 401 videre til appen ville sendt brukeren
		 * til innlogging for noe hun ikke kan fikse.
		 */
		throw new GeminiTokenMintError(describeGoogleError(response.status, text, key), 502);
	}

	let payload: unknown;
	try {
		payload = JSON.parse(text);
	} catch {
		throw new GeminiTokenMintError('Google svarte 200 med noe som ikke var JSON.', 502);
	}

	const parsed = parseAuthTokenResponse(payload);

	/**
	 * Utløpstidene fylles fra det VI ba om, ikke fra svaret.
	 *
	 * `expireTime` og `newSessionExpireTime` er «Input only» hos Google og kommer
	 * derfor aldri tilbake — verifisert mot prod: et ekte token ga `expiresAt: null`.
	 * Vi vet likevel hva de er, siden vi satte dem. Uten dette får appen ingen
	 * frister å planlegge etter og må gjette når den skal minte på nytt.
	 *
	 * Svaret vinner hvis Google en dag begynner å returnere dem.
	 */
	return {
		...parsed,
		expiresAt: parsed.expiresAt ?? body.expireTime,
		newSessionExpiresAt: parsed.newSessionExpiresAt ?? body.newSessionExpireTime,
		model: body.bidiGenerateContentSetup.model,
		uses: body.uses,
		websocketUrl: liveWebSocketUrl(parsed.token)
	};
}

export interface LiveModelCatalogue {
	models: LiveModelInfo[];
	/** Modellen et token får hvis ingenting velges. */
	effectiveDefault: string;
	/** Sann når `GEMINI_LIVE_MODEL` er satt i miljøet. */
	fromEnv: boolean;
	/**
	 * Sann når den gjeldende defaulten ikke finnes i katalogen lenger.
	 *
	 * Dette er den ene tilstanden som stille ødelegger alt: minting fortsetter å
	 * virke helt til noen prøver å koble til. Flagget gjør det synlig i samme svar
	 * som lista, så det oppdages når man ser etter modeller — ikke når en bruker
	 * står midt i en løpetur.
	 */
	defaultIsStale: boolean;
}

/**
 * Live-modellene Google tilbyr NÅ.
 *
 * Finnes fordi modellnavnene skifter fra uke til uke. Et hardkodet navn i koden
 * vår er en påstand med utløpsdato; dette endepunktet er et spørsmål.
 */
export async function listLiveModels(): Promise<LiveModelCatalogue> {
	const key = readApiKey();
	const envModel = configuredLiveModel();
	const effectiveDefault = envModel ?? DEFAULT_LIVE_MODEL;

	let response: Response;
	try {
		response = await fetch(MODELS_ENDPOINT, { headers: { 'x-goog-api-key': key } });
	} catch (err) {
		throw new GeminiTokenMintError(
			redactApiKeys(`Nådde ikke Google: ${err instanceof Error ? err.message : String(err)}`, key),
			502
		);
	}

	const text = await response.text();
	if (!response.ok) {
		throw new GeminiTokenMintError(describeGoogleError(response.status, text, key), 502);
	}

	let payload: unknown;
	try {
		payload = JSON.parse(text);
	} catch {
		throw new GeminiTokenMintError('Modellkatalogen fra Google var ikke JSON.', 502);
	}

	const models = selectLiveModels(payload, effectiveDefault);
	return {
		models,
		effectiveDefault,
		fromEnv: envModel !== null,
		// Tom katalog er ikke bevis på en utdatert default — da vet vi bare ikke.
		defaultIsStale: models.length > 0 && !models.some((m) => m.isDefault)
	};
}
