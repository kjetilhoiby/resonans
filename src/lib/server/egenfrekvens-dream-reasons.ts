import { DreamService, type DreamHighlights } from '$lib/server/services/dream-service';
import { db } from '$lib/db';
import { goals, projects } from '$lib/db/schema';
import { and, eq, desc } from 'drizzle-orm';

export interface DreamReason {
	value: string;
	label: string;
	source: 'dream_win' | 'dream_friction' | 'goal' | 'project';
}

export interface DreamReasonsByDimension {
	actions: DreamReason[];
	balance: DreamReason[];
	thoughts: DreamReason[];
	feelings: DreamReason[];
}

function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-zæøå0-9]+/gi, '_')
		.replace(/^_|_$/g, '')
		.slice(0, 40);
}

function truncLabel(text: string, max = 24): string {
	if (text.length <= max) return text;
	return text.slice(0, max - 1) + '…';
}

function reasonsFromHighlights(highlights: DreamHighlights): DreamReasonsByDimension {
	const result: DreamReasonsByDimension = { actions: [], balance: [], thoughts: [], feelings: [] };

	for (const win of (highlights.wins ?? []).slice(0, 4)) {
		const r: DreamReason = { value: `win:${slugify(win)}`, label: truncLabel(win), source: 'dream_win' };
		result.actions.push(r);
		result.balance.push(r);
		result.feelings.push(r);
	}

	for (const friction of (highlights.frictions ?? []).slice(0, 4)) {
		const r: DreamReason = { value: `friction:${slugify(friction)}`, label: truncLabel(friction), source: 'dream_friction' };
		result.balance.push(r);
		result.thoughts.push(r);
	}

	return result;
}

function reasonsFromGoals(activeGoals: Array<{ title: string }>): DreamReasonsByDimension {
	const result: DreamReasonsByDimension = { actions: [], balance: [], thoughts: [], feelings: [] };

	for (const goal of activeGoals.slice(0, 3)) {
		const r: DreamReason = { value: `goal:${slugify(goal.title)}`, label: truncLabel(goal.title), source: 'goal' };
		result.thoughts.push(r);
	}

	return result;
}

function reasonsFromProjects(activeProjects: Array<{ title: string }>): DreamReasonsByDimension {
	const result: DreamReasonsByDimension = { actions: [], balance: [], thoughts: [], feelings: [] };

	for (const project of activeProjects.slice(0, 2)) {
		const r: DreamReason = { value: `project:${slugify(project.title)}`, label: truncLabel(project.title), source: 'project' };
		result.thoughts.push(r);
	}

	return result;
}

function merge(...sets: DreamReasonsByDimension[]): DreamReasonsByDimension {
	const result: DreamReasonsByDimension = { actions: [], balance: [], thoughts: [], feelings: [] };
	const seen: Record<string, Set<string>> = { balance: new Set(), thoughts: new Set(), feelings: new Set() };

	for (const set of sets) {
		for (const dim of ['balance', 'thoughts', 'feelings'] as const) {
			for (const r of set[dim]) {
				if (!seen[dim].has(r.value)) {
					seen[dim].add(r.value);
					result[dim].push(r);
				}
			}
		}
	}

	return result;
}

export async function buildDreamReasons(userId: string): Promise<DreamReasonsByDimension> {
	const now = new Date();

	const [activeDream, activeGoals, activeProjects] = await Promise.all([
		DreamService.getActiveDream(userId, now),
		db.query.goals.findMany({
			where: and(eq(goals.userId, userId), eq(goals.status, 'active')),
			columns: { title: true },
			orderBy: [desc(goals.updatedAt)],
			limit: 5
		}),
		db
			.select({ title: projects.title })
			.from(projects)
			.where(and(eq(projects.userId, userId), eq(projects.status, 'active')))
			.limit(4)
	]);

	const dreamSet = activeDream?.highlights
		? reasonsFromHighlights(activeDream.highlights as unknown as DreamHighlights)
		: { actions: [], balance: [], thoughts: [], feelings: [] };

	const goalSet = reasonsFromGoals(activeGoals);
	const projectSet = reasonsFromProjects(activeProjects);

	return merge(dreamSet, goalSet, projectSet);
}
