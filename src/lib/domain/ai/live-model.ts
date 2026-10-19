/**
 * Hvilken Gemini Live-modell et token låses til, når appen ikke har valgt selv.
 *
 * Modellen kommer fra aliaset `live` i Stemmegaffel (`resonans-lab/stemmegaffel`),
 * ikke fra en miljøvariabel. Fram til oktober 2026 sto den i `GEMINI_LIVE_MODEL`
 * i Coolify, og et bytte krevde at noen åpnet deploy-panelet; nå byttes den i
 * laben, der stengedatoene også står. Se
 * `docs/changelog/2026-10-19-live-modellen-fra-aliaset.md`.
 *
 * Rekkefølgen, og den første som er brukbar vinner:
 *
 *   1. aliasets modell,
 *   2. aliasets reserve – en modell et menneske har prøvd på telefonen,
 *   3. `DEFAULT_LIVE_MODEL` i koden.
 *
 * En modell er ubrukelig når den er STENGT (stengedatoen er i dag eller
 * tidligere) eller BORTE fra Googles katalog. Det siste er den viktige vakta:
 * minting av et token for en modell som er borte virker helt til appen prøver å
 * koble til, og da står brukeren midt i en løpetur. Laben bytter aldri aliaset
 * selv; at Resonans tar reserven den dagen modellen stenger, er ikke et bytte,
 * og loggen sier det.
 *
 * Valget i Ekkos Live-debug vinner over alt dette, og avgjøres i endepunktet.
 *
 * Ren: ingen env og ingen nettverk.
 */
import { DEFAULT_LIVE_MODEL } from './gemini-live-token';

export interface LiveAliasModel {
	model: string;
	provider: string;
	/** Stengedatoen (`YYYY-MM-DD`), når en er kjent. */
	expires: string | null;
}

export interface LiveAliasPayload {
	model: LiveAliasModel | null;
	reserve: LiveAliasModel | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function readModel(raw: unknown): LiveAliasModel | null {
	if (!isRecord(raw) || typeof raw.model !== 'string' || !raw.model.trim() || typeof raw.leverandor !== 'string') return null;
	return {
		model: raw.model.trim().replace(/^models\//, ''),
		provider: raw.leverandor,
		expires: typeof raw.utloper === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw.utloper) ? raw.utloper.slice(0, 10) : null
	};
}

/** Leser svaret fra `GET /api/v1/aliaser/live`, felt for felt, eller `null` når formen ikke stemmer. */
export function parseLiveAliasPayload(raw: unknown): LiveAliasPayload | null {
	if (!isRecord(raw) || raw.alias !== 'live') return null;
	const model = readModel(raw.modell);
	if (!model) return null;
	return { model, reserve: readModel(raw.reserve) };
}

export type LiveModelSource = 'stemmegaffel' | 'reserve' | 'default';

export interface LiveModelChoice {
	model: string;
	source: LiveModelSource;
	/** Hvorfor noe over i rekkefølgen ble hoppet over. Tom når aliasets modell ble brukt. */
	reasons: string[];
}

export interface ChooseLiveModelInput {
	payload: LiveAliasPayload | null;
	/** Hvorfor det ikke finnes noe svar fra laben, når det ikke gjør det. */
	missingReason?: string;
	/** Live-modellene i Googles katalog nå, uten `models/`. `null`: vi vet ikke, og da hindrer katalogen ingenting. */
	catalogue: ReadonlySet<string> | null;
	/** Dagens dato, `YYYY-MM-DD` (UTC). */
	today: string;
}

/** Hvorfor modellen ikke kan brukes, eller `null` når den kan. */
function unusable(m: LiveAliasModel, catalogue: ReadonlySet<string> | null, today: string): string | null {
	if (m.provider !== 'google') return `${m.model} er fra ${m.provider}, og Live går bare mot Google`;
	if (m.expires !== null && m.expires <= today) return `${m.model} stengte ${m.expires}`;
	if (catalogue && !catalogue.has(m.model)) return `${m.model} finnes ikke i Googles katalog`;
	return null;
}

export function chooseLiveModel(input: ChooseLiveModelInput): LiveModelChoice {
	const reasons: string[] = [];
	const { payload, catalogue, today } = input;
	if (!payload) reasons.push(input.missingReason ?? 'ingen svar fra laben');

	const candidates: [LiveAliasModel | null, LiveModelSource][] = [
		[payload?.model ?? null, 'stemmegaffel'],
		[payload?.reserve ?? null, 'reserve']
	];
	for (const [m, source] of candidates) {
		if (!m) continue;
		const why = unusable(m, catalogue, today);
		if (why === null) return { model: m.model, source, reasons };
		reasons.push(why);
	}
	if (payload && !payload.reserve) reasons.push('aliaset har ingen reserve');

	// Under standarden finnes ingenting. Er den borte også, sier `defaultIsStale` fra.
	return { model: DEFAULT_LIVE_MODEL, source: 'default', reasons };
}
