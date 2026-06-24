import { env } from '$env/dynamic/private';

/**
 * Modell-routing for assistenten (B4): rut tunge resonnement-turer til en sterk modell og
 * lett prat/oppslag til en raskere/billigere modell.
 *
 * Provider velges av modell-id-en (`claude-*` → Anthropic, ellers OpenAI), så operatøren styrer
 * alt via env. Default: hvis ANTHROPIC_API_KEY er satt brukes Claude (Sonnet for resonnement,
 * Haiku for prat); ellers OpenAI (gpt-4o / gpt-4o-mini), så miljøer uten Claude-nøkkel virker som
 * før. `EKKO_ASSISTANT_MODEL` (gammel knapp) overstyrer begge tier-ene hvis satt.
 */

export type ModelTier = 'reasoning' | 'fast';

// Resonnement-signaler: planlegging, anbefaling, sammenligning, «rekker bilen», hvorfor/hvordan.
// Ingen avsluttende \b — norske bøyninger skal treffe (anbefale, vurdere, prioritere, planen).
const REASONING_RE =
	/\b(hvorfor|bør|anbefal|planlegg|plan|sammenlign|analyser|vurder|strategi|rekker|optimal|prioriter|hvordan (kan|bør|skal|burde)|hva (bør|burde)|verdt)/i;

/**
 * Klassifiser en brukerytring til en modell-tier. Ren funksjon (testbar). Heuristikk:
 * resonnement ved planleggings-/anbefalingsspråk eller lange, sammensatte spørsmål; ellers rask.
 */
export function classifyTier(prompt: string): ModelTier {
	const text = (prompt ?? '').trim();
	if (!text) return 'fast';
	if (REASONING_RE.test(text)) return 'reasoning';
	const words = text.split(/\s+/).filter(Boolean).length;
	if (words >= 14) return 'reasoning'; // lange, sammensatte spørsmål
	return 'fast';
}

/** Hvilken provider en modell-id hører til. Ren. */
export function providerFor(modelId: string): 'anthropic' | 'openai' {
	return modelId.startsWith('claude') ? 'anthropic' : 'openai';
}

/** Løs opp tier → modell-id fra env, med trygge defaults. */
export function resolveModels(): Record<ModelTier, string> {
	const override = env.EKKO_ASSISTANT_MODEL?.trim();
	if (override) return { reasoning: override, fast: override };

	const hasClaude = !!env.ANTHROPIC_API_KEY?.trim();
	const reasoning = env.EKKO_REASONING_MODEL?.trim() || (hasClaude ? 'claude-sonnet-4-6' : 'gpt-4o');
	const fast = env.EKKO_FAST_MODEL?.trim() || (hasClaude ? 'claude-haiku-4-5-20251001' : 'gpt-4o-mini');
	return { reasoning, fast };
}

/** Velg modell-id for en ny tur ut fra ytringen. */
export function chooseModelId(prompt: string): string {
	return resolveModels()[classifyTier(prompt)];
}

/** Modell-id for gjenopptak (klient-verktøy-etappe) — alltid resonnement-tier. */
export function reasoningModelId(): string {
	return resolveModels().reasoning;
}
