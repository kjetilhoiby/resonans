import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import {
	mintLiveToken,
	listLiveModels,
	GeminiNotConfiguredError,
	GeminiTokenMintError
} from '$lib/server/integrations/gemini-live';
import { checkMintRateLimit, recordMint } from '$lib/server/integrations/gemini-live-mints';
import { GeminiTokenShapeError } from '$lib/domain/ai/gemini-live-token';
import {
	TOOLSET_VERSION,
	isProfileDisabled,
	personaForProfile,
	resolveTokenProfile,
	toolNamesForProfile
} from '$lib/domain/ai/gemini-live-profiles';

/**
 * POST /api/apps/gemini/ephemeral-token  (Bearer rsn_)
 *
 * Minter et kortlevd Gemini Live-token til Ekko, slik at appen kan koble direkte
 * til Googles WebSocket uten å ha `GEMINI_API_KEY` i bundelen. Samme arbeidsdeling
 * som `/api/apps/tesla/state`: credentials bor på serveren.
 *
 * Kroppen er valgfri. `{ "ttlSeconds": 1800, "newSessionSeconds": 120, "uses": 3 }`
 * kan justere levetidene innenfor grensene i `gemini-live-token.ts`; verdier
 * utenfor klippes framfor å avvises, siden en app som ber om 45 minutter er bedre
 * tjent med 30 enn med en 400.
 *
 * ## Profiler (GEMINI_LIVE_VOICE_BRIEF.md i ekko)
 *
 * `{ "profile": "voice-test" | "assistant" | "coach" }` velger hvilke verktøy
 * som låses inn i tokenets setup — skjemaene bor i `gemini-live-profiles.ts`,
 * ikke i appen. Ukjent/manglende → `voice-test`, med et svar som er
 * BYTE-IDENTISK med tida før profiler fantes: en gammel app merker ingenting,
 * og en ny app som ikke får `profile` ekkoet tilbake vet at serveren er gammel
 * og holder Live-verktøy av. Bare `assistant`/`coach` får de nye feltene
 * (`profile`, `capabilities`, `persona`).
 *
 * Kill switch per profil uten app-release: `GEMINI_LIVE_DISABLED_PROFILES`
 * (kommaseparert) → `403 { "error": "profile_disabled" }`, som klienten møter
 * med SSE-samtale / regelcoach.
 *
 * POST, ikke GET: kallet har en effekt hos Google (kvote), og et token skal ikke
 * kunne mintes av en prefetch eller en lenke noen trykker på ved et uhell.
 *
 * ## Attribusjon
 *
 * Hvert token knyttes til brukeren gjennom `Bearer rsn_`, og loggen +
 * `gemini_token_mints`-tabellen skriver hvem som mintet det. Tokenet selv er
 * anonymt hos Google, så vår bokføring er eneste sted koblingen finnes — den er
 * det som gjør et misbrukt token sporbart, og `user_api_secrets` er stedet det
 * trekkes tilbake. Tabellen bærer også ratelimiten (30/døgn rullende): en
 * klient i reconnect-sløyfe skal stoppes av oss med 429 + `retryAfter`, ikke av
 * Googles kvote uten forklaring.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const num = (value: unknown): number | null =>
		typeof value === 'number' && Number.isFinite(value) ? value : null;
	const profile = resolveTokenProfile(body?.profile);

	if (isProfileDisabled(env.GEMINI_LIVE_DISABLED_PROFILES, profile)) {
		console.warn(`[gemini-live] profil ${profile} er avslått (kill switch) for bruker=${userId}`);
		return json({ error: 'profile_disabled', profile }, { status: 403 });
	}

	// Modellvalg fra appen (Live-debug). Formålet er A/B mellom Live-modeller uten at noen må
	// inn i Vercel og sette en env — men valget VALIDERES mot Googles egen katalog før det får
	// låses inn i et token. Et fritt modellnavn her ville gjort tokenet til en nøkkel mot en
	// vilkårlig modell på vår kvote, og det er nettopp det `bidiGenerateContentSetup` låser.
	// Uten override rører vi ikke katalogen: den koster et kall til Google.
	let modelOverride: string | null = null;
	const requestedModel = typeof body?.model === 'string' ? body.model.trim() : '';
	if (requestedModel) {
		let catalogue: Awaited<ReturnType<typeof listLiveModels>>;
		try {
			catalogue = await listLiveModels();
		} catch (err) {
			if (err instanceof GeminiNotConfiguredError) {
				return json({ error: err.message }, { status: 503 });
			}
			if (err instanceof GeminiTokenMintError) {
				return json({ error: err.message }, { status: err.status });
			}
			throw err;
		}
		// Sammenlignes uten `models/`-prefiks, siden katalogen oppgir begge former.
		const wanted = requestedModel.replace(/^models\//, '');
		const match = catalogue.models.find((m) => m.id === wanted);
		if (!match) {
			// Lista blir med: et modellnavn som ikke finnes lenger er den vanligste feilen her,
			// og «ukjent modell» uten alternativene er en blindvei.
			return json(
				{
					error: 'ukjent_modell',
					requested: requestedModel,
					kjente: catalogue.models.map((m) => m.id)
				},
				{ status: 400 }
			);
		}
		modelOverride = match.id;
	}

	const rate = await checkMintRateLimit(userId, new Date());
	if (!rate.allowed) {
		console.warn(
			`[gemini-live] ratelimit for bruker=${userId}: prøv igjen om ${rate.retryAfterSeconds}s`
		);
		return json(
			{ error: 'rate_limited', retryAfter: rate.retryAfterSeconds },
			{ status: 429, headers: { 'retry-after': String(rate.retryAfterSeconds) } }
		);
	}

	try {
		const token = await mintLiveToken({
			ttlSeconds: num(body?.ttlSeconds),
			newSessionSeconds: num(body?.newSessionSeconds),
			uses: num(body?.uses),
			model: modelOverride,
			profile
		});

		await recordMint(userId, profile);
		console.log(
			`[gemini-live] mintet token for bruker=${userId} profil=${profile} modell=${token.model} uses=${token.uses} utløper=${token.expiresAt ?? 'ukjent'}`
		);

		const base = {
			token: token.token,
			websocketUrl: token.websocketUrl,
			model: token.model,
			uses: token.uses,
			expiresAt: token.expiresAt,
			newSessionExpiresAt: token.newSessionExpiresAt
		};

		// voice-test svarer uten de nye feltene, byte-identisk med før — det er
		// kontrakten mot klienter bygget før profilene fantes.
		if (profile === 'voice-test') return json(base);

		return json({
			...base,
			profile,
			capabilities: {
				// Session resumption konsumerer ikke `uses` hos Google og er ikke låst
				// av masken — klienten kan trygt bygge reconnect på det.
				resumption: true,
				tools: toolNamesForProfile(profile),
				toolsetVersion: TOOLSET_VERSION
			},
			persona: personaForProfile(profile)
		});
	} catch (err) {
		if (err instanceof GeminiNotConfiguredError) {
			// 503, ikke 502: dette er en manglende konfigurasjon hos oss, og appen
			// skal ikke prøve igjen i sløyfe på noe et menneske må rette.
			console.error('[gemini-live] GEMINI_API_KEY mangler i miljøet');
			return json({ error: err.message }, { status: 503 });
		}
		if (err instanceof GeminiTokenMintError) {
			console.error(`[gemini-live] minting feilet for bruker=${userId}: ${err.message}`);
			return json({ error: err.message }, { status: err.status });
		}
		if (err instanceof GeminiTokenShapeError) {
			console.error(`[gemini-live] uventet svarform fra Google: ${err.message}`);
			return json({ error: err.message }, { status: 502 });
		}
		throw err;
	}
};
