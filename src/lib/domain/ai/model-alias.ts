/**
 * Modellaliaser fra Stemmegaffel (`resonans-lab/stemmegaffel`): et fast navn
 * (`json_cheap`, `vision`, …) som peker på den modellen laben har målt og et
 * menneske har godtatt, med parameterne som er MÅLT å virke for modellen.
 *
 * Reglene her er rene; hentingen bor i `$lib/server/ai/model-alias.ts`.
 *
 * Tre ting holder dette trygt:
 *
 *   - **Uten laben brukes en fast standard, og laben står aldri i den
 *     kritiske stien.** Mangler `STEMMEGAFFEL_URL`, eller svarer ikke laben,
 *     brukes `ALIAS_DEFAULTS`: en modell og formen den tar, på samme måte som et
 *     svar fra laben.
 *   - **Bare OpenAI.** Resonans har én klient til disse kallene. Peker aliaset på
 *     en annen leverandør, brukes standarden, og grunnen sies – et kall mot feil
 *     endepunkt med feil nøkkel ville feilet for hver bruker.
 *   - **Aliaset bestemmer FORMEN, kallstedet INNHOLDET.** Fra aliaset: modellen,
 *     navnet på tokentaket, om temperatur tas imot, tenkenivået. Fra kallstedet:
 *     meldingene, svarformatet, verdiene. Navneregelen i `chat-model.ts` gjettet
 *     formen ut fra modellnavnet, og gjettet feil for gpt-5.4 (8. oktober 2026).
 */

export const MODEL_ALIASES = ['json_cheap', 'vision'] as const;
export type ModelAlias = (typeof MODEL_ALIASES)[number];

export interface AliasDefault {
	model: string;
	/** Formen modellen tar, i samme språk som labens `params`. */
	params: Record<string, unknown>;
}

/**
 * Modellen som brukes uten laben, med formen den tar.
 *
 * `json_cheap` sto på `gpt-4o-mini` fram til oktober 2026, den modellen
 * kallstedene hadde hardkodet. OpenAI pensjonerer den 14. januar 2027, og en
 * standard som slutter å svare den dagen er ikke en standard. `gpt-6-luna` er
 * målt i Stemmegaffel på de samme oppgavene: minst like god på alle, og
 * billigere. Den tar ikke temperatur, vil ha `max_completion_tokens`, og tenker
 * ikke med `reasoning_effort: 'none'` – som er riktig for et uttrekk.
 *
 * `vision` sto på `gpt-4o` (og `gpt-4o-mini` på ett kallsted), med samme
 * sluttdato. Luna er målt minst like god som `gpt-4o` på alle bildeoppgavene
 * laben har (billett, måltid, kvittering), til en tjuefemdel av prisen. Laben
 * måler IKKE avlesning av søylehøyder i et skjermtidsbilde; se
 * `screen-time-parser.ts` før en terskel der justeres.
 *
 * `null` på tokentaket betyr «dette navnet, men verdien er kallstedets».
 * Et kallsted uten tak får fortsatt ikke noe tak.
 */
const LUNA_FORM = { max_completion_tokens: null, reasoning_effort: 'none' };

export const ALIAS_DEFAULTS: Record<ModelAlias, AliasDefault> = {
	json_cheap: { model: 'gpt-6-luna', params: LUNA_FORM },
	vision: { model: 'gpt-6-luna', params: LUNA_FORM }
};

/** Det vi leser fra Stemmegaffels svar. Felt for felt, ingen spread. */
export interface AliasPayload {
	alias: string;
	provider: string;
	/** Hvilket endepunkt laben gikk mot. `openai` betyr direkte, ikke gjennom OpenRouter. */
	route: string | null;
	model: string;
	snapshot: string | null;
	params: Record<string, unknown>;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Leser svaret fra `GET /api/v1/aliaser/{navn}`, eller `null` når formen ikke stemmer. */
export function parseAliasPayload(raw: unknown): AliasPayload | null {
	if (!isRecord(raw) || typeof raw.alias !== 'string' || !isRecord(raw.modell)) return null;
	const m = raw.modell;
	if (typeof m.leverandor !== 'string' || typeof m.model !== 'string' || !m.model.trim()) return null;
	return {
		alias: raw.alias,
		provider: m.leverandor,
		route: typeof m.rute === 'string' ? m.rute : null,
		model: m.model.trim(),
		snapshot: typeof m.snapshot === 'string' ? m.snapshot : null,
		params: isRecord(m.params) ? m.params : {}
	};
}

export interface ResolvedAlias {
	alias: ModelAlias;
	model: string;
	/** Formen modellen tar: målt av laben, eller standardens egen. */
	params: Record<string, unknown>;
	source: 'stemmegaffel' | 'default';
	/** Hvorfor standarden ble brukt, når den ble det. */
	reason?: string;
}

export function resolveAlias(alias: ModelAlias, payload: AliasPayload | null, reasonIfMissing = 'laben er ikke konfigurert'): ResolvedAlias {
	const fallback = (reason: string): ResolvedAlias => ({ alias, model: ALIAS_DEFAULTS[alias].model, params: ALIAS_DEFAULTS[alias].params, source: 'default', reason });
	if (!payload) return fallback(reasonIfMissing);
	if (payload.alias !== alias) return fallback(`laben svarte for «${payload.alias}», ikke «${alias}»`);
	if (payload.provider !== 'openai' || (payload.route !== null && payload.route !== 'openai')) return fallback(`aliaset peker på ${payload.provider}, og Resonans har bare en OpenAI-klient for dette`);
	return { alias, model: payload.model, params: payload.params, source: 'stemmegaffel' };
}

/** Parametere som sier hvordan modellen tar imot et kall, ikke hva kallet handler om. */
const FORM_PARAMS = ['reasoning_effort', 'verbosity'] as const;

/**
 * Kallstedets forespørsel med aliasets modell og form. Standarden og laben går
 * gjennom samme regel; forskjellen er bare hvor formen kom fra.
 */
export type AliasedRequest<T> = T & { model: string } & Record<string, unknown>;

export function applyAlias<T extends object>(body: T, resolved: ResolvedAlias): AliasedRequest<T> {
	const out: Record<string, unknown> = { ...body, model: resolved.model };
	const p = resolved.params;
	const inn = body as Record<string, unknown>;

	// Tokentaket: navnet modellen tar, verdien kallstedet ba om.
	const tak = (inn.max_completion_tokens ?? inn.max_tokens) as number | undefined;
	if ('max_completion_tokens' in p || 'max_tokens' in p) {
		delete out.max_tokens;
		delete out.max_completion_tokens;
		const navn = 'max_completion_tokens' in p ? 'max_completion_tokens' : 'max_tokens';
		const verdi = tak ?? p[navn];
		if (typeof verdi === 'number') out[navn] = verdi;
	}

	// Temperatur: laben sender den bare når modellen er målt å ta den.
	if (!('temperature' in p)) delete out.temperature;

	// Tenkenivå og ordrikhet fra målingen, når kallstedet ikke har sagt noe selv.
	for (const k of FORM_PARAMS) if (k in p && !(k in inn)) out[k] = p[k];

	return out as AliasedRequest<T>;
}

/**
 * Skal et avvist aliaskall kjøres om igjen med standarden? Bare når OpenAI
 * avviste FORESPØRSELEN (ukjent modell, parameter den ikke tar) – samme regel
 * som `shouldFallBackToChatModel`. En 429 eller et nettverksbrudd ville bare
 * doblet trykket. Avvises standarden selv, finnes det ingenting under den.
 */
export function shouldFallBackFromAlias(source: ResolvedAlias['source'], status: number | undefined): boolean {
	return source === 'stemmegaffel' && (status === 400 || status === 404);
}
