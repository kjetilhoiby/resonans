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
import {
	completionSizing,
	FALLBACK_CHAT_MODEL,
	isLegacyChatModelMode,
	resolveDefaultChatModel,
	shouldFallBackToChatModel
} from '$lib/domain/ai/chat-model';
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

function chooseModel(): string {
	const configured = env.CHAT_DEFAULT_MODEL;
	return isLegacyChatModelMode(configured) ? FALLBACK_CHAT_MODEL : resolveDefaultChatModel(configured);
}

async function generate(model: string, facts: string): Promise<string> {
	const response = await openai.chat.completions.create({
		model,
		messages: [
			{ role: 'system', content: HOME_LETTER_SYSTEM_PROMPT },
			{ role: 'user', content: facts }
		],
		...completionSizing(model, { temperature: TEMPERATURE, maxTokens: MAX_TOKENS })
	} as Parameters<typeof openai.chat.completions.create>[0]);
	const message = 'choices' in response ? response.choices[0]?.message?.content : null;
	return (message ?? '').trim();
}

export async function getHomeLetterProse(userId: string, letter: HomeLetter, day: string): Promise<HomeLetterProse> {
	const facts = letterFactsText(letter);
	let model = chooseModel();
	const contextHash = createHash('sha256')
		.update(`${HOME_LETTER_PROMPT_VERSION}\n${model}\n${facts}`)
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
		try {
			text = await generate(model, facts);
		} catch (err) {
			const status = (err as { status?: number }).status;
			if (!shouldFallBackToChatModel(model, status)) throw err;
			console.warn(`[home-letter] ${model} avvist (${status}), prøver ${FALLBACK_CHAT_MODEL}`);
			model = FALLBACK_CHAT_MODEL;
			text = await generate(model, facts);
		}
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
