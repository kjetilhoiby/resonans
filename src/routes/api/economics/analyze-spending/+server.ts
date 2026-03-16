import { json } from '@sveltejs/kit';
import { DEFAULT_USER_ID } from '$lib/server/users';
import { analyzeSpending } from '$lib/server/integrations/spending-analyzer';
import type { RequestHandler } from './$types';

// Allow up to 120 seconds on Vercel (Pro plan supports up to 300s)
export const config = { maxDuration: 120 };

/**
 * POST /api/economics/analyze-spending
 *
 * Triggers the LLM-powered spending analyzer.
 * Groups all transactions by merchant, computes stats, and asks OpenAI
 * to classify each unique merchant into categories + subcategories.
 * Results are stored in merchant_mappings and used by future categorizations.
 *
 * Body (JSON, all optional):
 *   accountId?: string   — limit to one account
 *   force?: boolean      — re-classify even recently-analyzed merchants
 *
 * Response: AnalysisResult
 */
export const POST: RequestHandler = async ({ request }) => {
	const userId = DEFAULT_USER_ID;

	let body: { accountId?: string; force?: boolean } = {};
	try {
		body = await request.json();
	} catch {
		// no body is fine
	}

	try {
		const result = await analyzeSpending(userId, body.accountId, body.force ?? false);
		return json(result);
	} catch (e) {
		console.error('[analyze-spending] Error:', e);
		return json({ error: String(e) }, { status: 500 });
	}
};

/**
 * GET /api/economics/analyze-spending
 * Returns the current mapping stats (how many merchants classified, etc.)
 */
export const GET: RequestHandler = async () => {
	const { db } = await import('$lib/db');
	const { merchantMappings } = await import('$lib/db/schema');
	const { eq, count, sql } = await import('drizzle-orm');

	const userId = DEFAULT_USER_ID;

	const [stats] = await db
		.select({
			total: count(),
			aiClassified: sql<number>`count(*) filter (where source = 'ai')`,
			fixedCount: sql<number>`count(*) filter (where is_fixed = true)`,
			lastAnalyzed: sql<Date>`max(analyzed_at)`
		})
		.from(merchantMappings)
		.where(eq(merchantMappings.userId, userId));

	return json({
		totalMerchants: stats?.total ?? 0,
		aiClassified: stats?.aiClassified ?? 0,
		fixedCount: stats?.fixedCount ?? 0,
		lastAnalyzed: stats?.lastAnalyzed ?? null
	});
};
