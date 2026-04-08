import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { createGoal } from '$lib/server/goals';
import { createMemory } from '$lib/server/memories';

function parseNum(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string') {
		const parsed = Number.parseFloat(value.replace(',', '.'));
		if (Number.isFinite(parsed)) return parsed;
	}
	return null;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const userId = locals.userId;
		if (!userId) {
			return json({ success: false, message: 'Unauthorized' }, { status: 401 });
		}

		const body = await request.json().catch(() => null);
		if (!body) {
			return json({ success: false, message: 'Ugyldig payload' }, { status: 400 });
		}

		const historyText = typeof body.historyText === 'string' ? body.historyText.trim() : '';
		const startDate = typeof body.startDate === 'string' ? body.startDate : null;
		const endDate = typeof body.endDate === 'string' ? body.endDate : null;
		const startWeight = parseNum(body.startWeight);
		const targetChange = parseNum(body.targetChange);

		const healthTheme = await db.query.themes.findFirst({
			where: and(eq(themes.userId, userId), eq(themes.name, 'Helse'))
		});

		let createdMemoryId: string | null = null;
		if (historyText.length >= 8) {
			const memory = await createMemory({
				userId,
				themeId: healthTheme?.id ?? null,
				category: 'fitness',
				importance: 'high',
				content: `Vekt-onboarding: ${historyText}`,
				source: 'weight_onboarding'
			});
			createdMemoryId = memory.id;
		}

		let createdGoalId: string | null = null;
		if (startDate && endDate && targetChange != null) {
			const title = targetChange < 0
				? `Vektnedgang ${Math.abs(targetChange).toFixed(1)} kg`
				: `Vektmål ${targetChange.toFixed(1)} kg`;

			const goal = await createGoal({
				userId,
				categoryName: 'Helse',
				themeId: healthTheme?.id,
				title,
				description: 'Opprettet fra vekt-onboarding med historikk og periode',
				targetDate: endDate,
				metricId: 'weight_change',
				goalKind: 'change',
				goalWindow: 'custom',
				durationDays: Math.max(
					7,
					Math.ceil(
						(new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)
					)
				),
				targetValue: targetChange,
				unit: 'kg',
				startDate,
				endDate,
				startValue: startWeight ?? undefined
			});

			createdGoalId = goal.id;
		}

		return json({
			success: true,
			memoryId: createdMemoryId,
			goalId: createdGoalId,
			message: 'Vekt-onboarding lagret'
		});
	} catch (error) {
		console.error('Failed to save weight onboarding:', error);
		return json({ success: false, message: 'Kunne ikke lagre onboarding' }, { status: 500 });
	}
};
