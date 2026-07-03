/**
 * Modell-spesifikk parameter-tuning for OpenAI-completions, delt mellom assistent-løkka
 * (`assistant.ts`) og verktøy som gjør egne LLM-kall (f.eks. quiz-bankens batch-generering i
 * `quiz-tools.ts`). Egen modul for å unngå import-sykel assistant → tools → quiz-tools → assistant.
 */

/**
 * GPT-5- og o-serien er reasoning-modeller med et annet parameter-format enn gpt-4o: de krever
 * `max_completion_tokens` (ikke `max_tokens`) og støtter bare default-temperatur. Sender vi feil
 * navn/verdi, svarer OpenAI 400 → 502 mot frontend. Skill derfor per modell.
 */
export function isReasoningModel(modelId: string): boolean {
	return /^(o\d|gpt-5)/i.test(modelId);
}

/** Bygg de modell-spesifikke completion-parametrene (token-tak + ev. temperatur). */
export function completionTuning(
	modelId: string,
	maxTokens: number,
	temperature: number
): Record<string, number> {
	if (isReasoningModel(modelId)) {
		// Reasoning-modeller: nytt token-felt, og ingen egendefinert temperatur (default = 1).
		return { max_completion_tokens: maxTokens };
	}
	return { max_tokens: maxTokens, temperature };
}
