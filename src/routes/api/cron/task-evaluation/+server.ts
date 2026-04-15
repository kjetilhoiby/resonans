import { json, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/db';
import { users } from '$lib/db/schema';
import { evaluateTasksForWeek } from '$lib/server/task-evaluation';

/**
 * GET /api/cron/task-evaluation
 * Evaluate all active tasks for all users for the current ISO week
 */
export const GET: RequestHandler = async () => {
	try {
		// Get current ISO week boundaries
		const now = new Date();
		const dayOfWeek = now.getUTCDay() || 7; // Sunday = 7
		const weekStart = new Date(now);
		weekStart.setUTCDate(now.getUTCDate() - dayOfWeek + 1); // Monday
		weekStart.setUTCHours(0, 0, 0, 0);

		const weekEnd = new Date(weekStart);
		weekEnd.setUTCDate(weekStart.getUTCDate() + 6); // Sunday
		weekEnd.setUTCHours(23, 59, 59, 999);

		// Get all active users
		const allUsers = await db.query.users.findMany({
			columns: { id: true }
		});

		const results: Record<string, {
			evaluatedCount: number;
			withEvaluation: number;
			errors: string[];
		}> = {};

		for (const user of allUsers) {
			try {
				const evaluations = await evaluateTasksForWeek({
					userId: user.id,
					weekStart,
					weekEnd
				});

				results[user.id] = {
					evaluatedCount: evaluations.length,
					withEvaluation: evaluations.filter((e) => e.evaluation).length,
					errors: []
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				results[user.id] = {
					evaluatedCount: 0,
					withEvaluation: 0,
					errors: [message]
				};
			}
		}

		const totalUsers = allUsers.length;
		const successCount = Object.values(results).filter((r) => r.errors.length === 0).length;

		return json({
			success: true,
			timestamp: new Date().toISOString(),
			weekStart: weekStart.toISOString().slice(0, 10),
			weekEnd: weekEnd.toISOString().slice(0, 10),
			totalUsers,
			successCount,
			results
		});
	} catch (error) {
		console.error('Task evaluation cron failed:', error);
		const message = error instanceof Error ? error.message : String(error);
		return json(
			{
				success: false,
				error: message,
				timestamp: new Date().toISOString()
			},
			{ status: 500 }
		);
	}
};
