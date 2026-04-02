import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { buildCanonicalActivityFeed } from '$lib/server/activity-layer';
import { themes, goals, tasks, memories, progress } from '$lib/db/schema';
import { eq, and, gte, desc, inArray } from 'drizzle-orm';

export const GET: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;
	const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

	// Hent aktive themes
	const activeThemes = await db
		.select({
			id: themes.id,
			name: themes.name,
			emoji: themes.emoji,
			description: themes.description
		})
		.from(themes)
		.where(
			and(
				eq(themes.userId, userId),
				eq(themes.archived, false)
			)
		)
		.limit(5);

	// Hent aktive mål
	const activeGoals = await db
		.select({
			id: goals.id,
			title: goals.title,
			themeId: goals.themeId,
			status: goals.status,
			targetDate: goals.targetDate
		})
		.from(goals)
		.where(
			and(
				eq(goals.userId, userId),
				eq(goals.status, 'active')
			)
		)
		.limit(10);

	// Hent tasks for aktive mål
	let allTasks = [];
	if (activeGoals.length > 0) {
		const goalIds = activeGoals.map(g => g.id);
		allTasks = await db
			.select({
				id: tasks.id,
				title: tasks.title,
				goalId: tasks.goalId,
				status: tasks.status
			})
			.from(tasks)
			.where(inArray(tasks.goalId, goalIds));
	}

	const recentActivity = await buildCanonicalActivityFeed(userId, {
		since: sevenDaysAgo,
		limit: 50
	});

	// Hent progress (for beregning av streaks)
	const recentProgress = await db
		.select({
			id: progress.id,
			taskId: progress.taskId,
			completedAt: progress.completedAt,
			value: progress.value
		})
		.from(progress)
		.where(and(eq(progress.userId, userId), gte(progress.completedAt, sevenDaysAgo)))
		.orderBy(desc(progress.completedAt))
		.limit(100);

	// Generer status cards
	const statusCards = await generateStatusCards({
		activeThemes,
		activeGoals,
		recentActivity,
		recentProgress,
		userId
	});

	// Generer forslag til handlinger
	const suggestedActions = await generateSuggestedActions({
		recentActivity,
		activeThemes,
		activeGoals,
		userId
	});

	return json({
		statusCards,
		suggestedActions,
		stats: {
			activeThemesCount: activeThemes.length,
			activeGoalsCount: activeGoals.length,
			recentActivityCount: recentActivity.length
		}
	});
};

async function generateStatusCards({
	activeThemes,
	activeGoals,
	recentActivity,
	recentProgress,
	userId
}: {
	activeThemes: any[];
	activeGoals: any[];
	recentActivity: any[];
	recentProgress: any[];
	userId: string;
}) {
	const cards = [];

	// Lag cards for themes med aktivitet
	for (const theme of activeThemes.slice(0, 3)) {
		const themeGoals = activeGoals.filter((g) => g.themeId === theme.id);
		
		// Finn tasks for disse målene
		let themeTasks: Array<{ id: string; status: string }> = [];
		if (themeGoals.length > 0) {
			const themeGoalIds = themeGoals.map(g => g.id);
			themeTasks = await db
				.select({
					id: tasks.id,
					status: tasks.status
				})
				.from(tasks)
				.where(inArray(tasks.goalId, themeGoalIds));
		}

		// Beregn streak basert på progress
		const themeProgress = recentProgress.filter(p => 
			themeTasks.some(t => t.id === p.taskId)
		);
		const streak = calculateStreak(themeProgress.map(p => ({ completedAt: p.completedAt })));

		cards.push({
			type: 'theme',
			themeId: theme.id,
			title: theme.name,
			emoji: theme.emoji,
			metrics: {
				streak: streak,
				activeGoals: themeGoals.length,
				weeklyActivity: themeProgress.length
			},
			description: theme.description
		});
	}

	return cards;
}

async function generateSuggestedActions({
	recentActivity,
	activeThemes,
	activeGoals,
	userId
}: {
	recentActivity: any[];
	activeThemes: any[];
	activeGoals: any[];
	userId: string;
}) {
	const suggestions = [];

	// 1. Sjekk om brukeren har daglige aktivitets-mønstre
	if (recentActivity.length >= 3) {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		
		const todayActivity = recentActivity.filter((a) => {
			const activityDate = toActivityDate(a);
			activityDate.setHours(0, 0, 0, 0);
			return activityDate.getTime() === today.getTime();
		});

		if (todayActivity.length === 0) {
			suggestions.push({
				type: 'daily_check_in',
				icon: '✅',
				label: 'Dagens registrering',
				sublabel: 'Logg aktivitet eller fremgang',
				action: {
					type: 'navigate',
					target: '/'
				}
			});
		}
	}

	// 2. Sjekk om det er aktive mål uten nylig aktivitet
	if (activeGoals.length > 0) {
		const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
		const goalWithNoActivity = activeGoals.find(goal => {
			const lastActivity = recentActivity.find(a => 
				(a.payload as Record<string, unknown> | undefined)?.goalId === goal.id
			);
			return !lastActivity || toActivityDate(lastActivity) < threeDaysAgo;
		});

		if (goalWithNoActivity) {
			suggestions.push({
				type: 'check_in',
				icon: '🎯',
				label: `Sjekk inn på ${goalWithNoActivity.title}`,
				sublabel: 'Ingen aktivitet på en stund',
				action: {
					type: 'navigate',
					target: '/goals'
				}
			});
		}
	}

	// 3. Foreslå å se oversikt hvis få suggestions
	if (suggestions.length < 2 && activeGoals.length > 0) {
		suggestions.push({
			type: 'view_goals',
			icon: '📊',
			label: 'Se målene dine',
			sublabel: `${activeGoals.length} aktive mål`,
			action: {
				type: 'navigate',
				target: '/goals'
			}
		});
	}

	// 4. Generell "fortsett samtale" hvis lite aktivitet
	if (suggestions.length < 2) {
		suggestions.push({
			type: 'chat',
			icon: '💬',
			label: 'Snakk med AI',
			sublabel: 'Planlegg, reflekter eller registrer',
			action: {
				type: 'focus_chat',
				target: null
			}
		});
	}

	return suggestions.slice(0, 4); // Max 4 suggestions
}

function calculateStreak(activities: any[]): number {
	if (activities.length === 0) return 0;

	// Sorter activities etter dato (nyeste først)
	const sorted = [...activities].sort(
		(a, b) => toActivityDate(b).getTime() - toActivityDate(a).getTime()
	);

	let streak = 0;
	let currentDate = new Date();
	currentDate.setHours(0, 0, 0, 0);

	for (let i = 0; i < sorted.length; i++) {
		const activityDate = toActivityDate(sorted[i]);
		activityDate.setHours(0, 0, 0, 0);

		const diffDays = Math.floor(
			(currentDate.getTime() - activityDate.getTime()) / (1000 * 60 * 60 * 24)
		);

		if (diffDays === streak) {
			streak++;
		} else if (diffDays > streak) {
			break;
		}
	}

	return streak;
}

function toActivityDate(activity: { completedAt?: Date | string; timestamp?: Date | string }) {
	return new Date(activity.timestamp ?? activity.completedAt ?? new Date());
}

function formatTimeUntil(date: Date | null): string {
	if (!date) return '';

	const now = new Date();
	const diff = new Date(date).getTime() - now.getTime();
	const hours = Math.floor(diff / (1000 * 60 * 60));
	const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

	if (hours < 1) {
		return `om ${minutes} min`;
	} else if (hours < 24) {
		return `om ${hours} timer`;
	} else {
		return `i morgen`;
	}
}
