import { json } from '@sveltejs/kit';
import { analyzeSpending, generateSpendingInsights } from '$lib/server/integrations/spending-analyzer';
import type { RequestHandler } from './$types';

// Allow up to 120 seconds on Vercel (Pro plan supports up to 300s)
export const config = { maxDuration: 120 };

/**
 * POST /api/economics/analyze-spending
 *
 * Triggers merchant classification and/or insights generation.
 * 
 * Classification: LLM categorizes merchants into SB1 taxonomy
 * Insights: LLM generates natural-language spending insights
 *
 * Body (JSON, all optional):
 *   accountId?: string     — limit to one account
 *   force?: boolean        — re-classify even recently-analyzed merchants
 *   testLimit?: number     — limit classification to N merchants (for testing)
 *   mode?: 'classify' | 'insights' | 'both'  — what to run (default: 'both')
 *
 * Response: { classification?: ClassificationResult, insights?: InsightsResult }
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	const startTime = Date.now();
	console.log(`[analyze-spending API] Request started for user ${userId}`);

	let body: { 
		accountId?: string; 
		force?: boolean; 
		testLimit?: number;
		mode?: 'classify' | 'insights' | 'both';
	} = {};
	try {
		body = await request.json();
		console.log(`[analyze-spending API] Request body:`, body);
	} catch {
		// no body is fine
	}

	const mode = body.mode ?? 'both';

	try {
		const result: any = {};

		if (mode === 'classify' || mode === 'both') {
			console.log(`[analyze-spending API] Starting classification...`);
			result.classification = await analyzeSpending(
				userId, 
				body.accountId, 
				body.force ?? false, 
				body.testLimit
			);
			console.log(`[analyze-spending API] Classification complete`);
		}

		if (mode === 'insights' || mode === 'both') {
			console.log(`[analyze-spending API] Starting insights generation...`);
			result.insights = await generateSpendingInsights(userId, body.accountId);
			console.log(`[analyze-spending API] Insights complete`);
		}

		console.log(`[analyze-spending API] Total request time: ${Date.now() - startTime}ms`);
		return json(result);
	} catch (e) {
		console.error('[analyze-spending API] Error:', e);
		return json({ error: String(e) }, { status: 500 });
	}
};

/**
 * GET /api/economics/analyze-spending
 * Returns the current mapping stats (how many merchants classified, etc.)
 */
export const GET: RequestHandler = async ({ locals }) => {
	const { db } = await import('$lib/db');
	const { merchantMappings } = await import('$lib/db/schema');
	const { eq, count, sql } = await import('drizzle-orm');

	const userId = locals.userId;

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
