import type { PageServerLoad } from './$types';
import { listProjects } from '$lib/server/writing/projects';
import { listWritingDayKeys } from '$lib/server/writing/docs';
import { osloDayKey } from '$lib/server/trip-geo';
import { describeStreak, writingStreakDays } from '$lib/domain/writing/exercise';

const STREAK_WINDOW_DAYS = 400;

export const load: PageServerLoad = async ({ locals }) => {
	const now = new Date();
	const today = osloDayKey(now);

	const [projects, dayKeys] = await Promise.all([
		listProjects(locals.userId),
		listWritingDayKeys(
			locals.userId,
			new Date(now.getTime() - STREAK_WINDOW_DAYS * 24 * 60 * 60 * 1000)
		)
	]);

	const streakDays = writingStreakDays(dayKeys, today);

	return {
		streak: {
			days: streakDays,
			label: describeStreak(streakDays),
			wroteToday: dayKeys.includes(today)
		},
		projects: projects.map((p) => ({
			id: p.id,
			title: p.title,
			genre: p.genre,
			summary: p.summary,
			status: p.status,
			updatedAt: p.updatedAt.toISOString()
		}))
	};
};
