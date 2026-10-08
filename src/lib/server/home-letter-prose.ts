/**
 * Modellversjonen av hjemskjermens brev — kall og lagring. PROTOTYPE, se
 * `docs/changelog/2026-10-06-brev-prototype.md`, fase 6. Prompten og vakten bor
 * rent i `$lib/domain/ai/home-letter-prose.ts`.
 *
 * Samme cache-mønster som øktvurderingen (`workout-assessment.ts`): én lagret
 * tekst per bruker og Oslo-dag, skrevet på nytt bare når fakta-hashen endrer seg.
 * Hashen dekker faktaene, modellen og promptversjonen, så en ny veiing eller en
 * endret instruks gir et nytt brev — men ti sidevisninger samme morgen gir ett
 * kall og samme tekst.
 */

import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { homeLetterDrafts } from '$lib/db/schema';
import { openai } from '$lib/server/openai';
import { completionSizing } from '$lib/domain/ai/chat-model';
import { createChatCompletionWithFallback } from '$lib/server/chat-completion';
import {
	HOME_LETTER_PROMPT_VERSION,
	HOME_LETTER_SYSTEM_PROMPT,
	letterFactsText,
	unknownNumbers
} from '$lib/domain/ai/home-letter-prose';
import type { HomeLetter } from '$lib/domain/home-letter';

/** Lav temperatur: samme fakta skal gi omtrent samme brev. */
const TEMPERATURE = 0.3;
const MAX_TOKENS = 600;

export interface HomeLetterProse {
	text: string | null;
	model: string | null;
	cached: boolean;
	/** Tall i teksten som ikke står i faktaene. Flaten sier fra om dem. */
	unknownNumbers: string[];
	error: string | null;
}

/**
 * Brevet skriver bare prosa og kaller ingen verktøy, så det kan bruke en modell
 * chatten ikke kan: GPT-6.1 Sol tar ikke verktøy over Chat Completions
 * (`chatCompletionsToolSupport`). `HOME_LETTER_MODEL` overstyrer uten deploy.
 */
export const DEFAULT_HOME_LETTER_MODEL = 'gpt-6.1-sol';

function chooseModel(): string {
	return env.HOME_LETTER_MODEL?.trim() || DEFAULT_HOME_LETTER_MODEL;
}

/**
 * Gjennom samme reservevei som chatten: avvises en valgfri parameter
 * (`verbosity`), prøves samme modell uten den før `gpt-4o` tar over.
 * Returnerer modellen som faktisk svarte.
 */
async function generate(model: string, facts: string): Promise<{ text: string; model: string }> {
	const sizing = { temperature: TEMPERATURE, maxTokens: MAX_TOKENS };
	const completion = await createChatCompletionWithFallback(
		openai,
		{
			model,
			messages: [
				{ role: 'system', content: HOME_LETTER_SYSTEM_PROMPT },
				{ role: 'user', content: facts }
			],
			...completionSizing(model, sizing)
		},
		sizing,
		{ onFallback: (reason) => console.warn(`[home-letter] ${model} avvist (${reason}), reserven svarte`) }
	);
	return {
		text: (completion.choices[0]?.message?.content ?? '').trim(),
		model: completion.model || model
	};
}

export async function getHomeLetterProse(userId: string, letter: HomeLetter, day: string): Promise<HomeLetterProse> {
	const facts = letterFactsText(letter);
	const requested = chooseModel();
	let model = requested;
	const contextHash = createHash('sha256')
		.update(`${HOME_LETTER_PROMPT_VERSION}\n${requested}\n${facts}`)
		.digest('hex');

	const existing = await db.query.homeLetterDrafts.findFirst({
		where: and(eq(homeLetterDrafts.userId, userId), eq(homeLetterDrafts.day, day)),
		columns: { letter: true, model: true, contextHash: true }
	});
	if (existing && existing.contextHash === contextHash) {
		return {
			text: existing.letter,
			model: existing.model,
			cached: true,
			unknownNumbers: unknownNumbers(existing.letter, facts),
			error: null
		};
	}

	let text: string;
	try {
		({ text, model } = await generate(requested, facts));
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[home-letter] modellbrev feilet user=${userId}: ${message}`);
		// Et brev fra tidligere i dag er bedre enn ingen: faktaene har endret seg,
		// men det gjelder den samme dagen. Vakten regnes mot DAGENS fakta.
		return {
			text: existing?.letter ?? null,
			model: existing?.model ?? null,
			cached: Boolean(existing),
			unknownNumbers: existing ? unknownNumbers(existing.letter, facts) : [],
			error: 'Modellen svarte ikke.'
		};
	}

	if (!text) {
		return { text: existing?.letter ?? null, model, cached: Boolean(existing), unknownNumbers: [], error: 'Modellen svarte tomt.' };
	}

	await db
		.insert(homeLetterDrafts)
		.values({ userId, day, letter: text, model, contextHash })
		.onConflictDoUpdate({
			target: [homeLetterDrafts.userId, homeLetterDrafts.day],
			set: { letter: text, model, contextHash, updatedAt: new Date() }
		});

	return { text, model, cached: false, unknownNumbers: unknownNumbers(text, facts), error: null };
}
