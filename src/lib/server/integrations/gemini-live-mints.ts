import { db } from '$lib/db';
import { geminiTokenMints } from '$lib/db/schema';
import { and, eq, gte } from 'drizzle-orm';
import {
	MINT_RATE_WINDOW_MS,
	evaluateMintRateLimit,
	type MintRateDecision,
	type TokenProfile
} from '$lib/domain/ai/gemini-live-profiles';

/**
 * Bokføring og ratelimit for tokenminting. Beslutningen bor rent og testet i
 * `evaluateMintRateLimit`; her er bare datainnhentingen.
 */

export async function checkMintRateLimit(userId: string, now: Date): Promise<MintRateDecision> {
	const windowStart = new Date(now.getTime() - MINT_RATE_WINDOW_MS);
	const rows = await db
		.select({ mintedAt: geminiTokenMints.mintedAt })
		.from(geminiTokenMints)
		.where(and(eq(geminiTokenMints.userId, userId), gte(geminiTokenMints.mintedAt, windowStart)));
	return evaluateMintRateLimit(rows.map((row) => row.mintedAt), now);
}

/**
 * Bokføres etter VELLYKKET mint: en avvist forespørsel har ikke kostet Google-
 * kvote, og skal ikke spise av brukerens egen.
 */
export async function recordMint(userId: string, profile: TokenProfile): Promise<void> {
	await db.insert(geminiTokenMints).values({ userId, profile });
}
