import { and, asc, desc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { tasks, projects } from '$lib/db/schema';
import { isActiveOn } from './yearly-window';

export type PoolCandidateFilter = {
	userId: string;
	availableMinutes?: number;
	effort?: 'low' | 'medium' | 'high';
	contextTags?: string[];
	projectId?: string;
	limit?: number;
	includeStubs?: boolean; // tasks uten estimat
	needsClarificationOnly?: boolean;
};

export type PoolCandidate = {
	id: string;
	title: string;
	description: string | null;
	estimatedMinutes: number | null;
	effort: string | null;
	dueDate: string | null;
	availableFrom: string | null;
	availableTo: string | null;
	yearlyWindow: string | null;
	contextTags: string[] | null;
	poolPriority: number;
	projectId: string | null;
	projectTitle: string | null;
	lastSurfacedAt: Date | null;
	reason?: string;
};

function todayIso(): string {
	return new Date().toISOString().slice(0, 10);
}

function daysUntil(iso: string | null): number | null {
	if (!iso) return null;
	const target = new Date(`${iso}T00:00:00Z`).getTime();
	const today = new Date(`${todayIso()}T00:00:00Z`).getTime();
	return Math.round((target - today) / 86400000);
}

export async function findPoolCandidates(filter: PoolCandidateFilter): Promise<PoolCandidate[]> {
	const today = todayIso();

	const conditions = [
		eq(tasks.userId, filter.userId),
		eq(tasks.isPool, true),
		eq(tasks.status, 'active')
	];

	if (filter.projectId) {
		conditions.push(eq(tasks.projectId, filter.projectId));
	}

	if (filter.effort) {
		conditions.push(eq(tasks.effort, filter.effort));
	}

	// availableFrom-vindu: enten ikke satt, eller startet
	conditions.push(
		or(isNull(tasks.availableFrom), lte(tasks.availableFrom, today))!
	);

	const rows = await db
		.select({
			id: tasks.id,
			title: tasks.title,
			description: tasks.description,
			estimatedMinutes: tasks.estimatedMinutes,
			effort: tasks.effort,
			dueDate: tasks.dueDate,
			availableFrom: tasks.availableFrom,
			availableTo: tasks.availableTo,
			yearlyWindow: tasks.yearlyWindow,
			contextTags: tasks.contextTags,
			poolPriority: tasks.poolPriority,
			projectId: tasks.projectId,
			projectTitle: projects.title,
			lastSurfacedAt: tasks.lastSurfacedAt
		})
		.from(tasks)
		.leftJoin(projects, eq(tasks.projectId, projects.id))
		.where(and(...conditions));

	const now = new Date();

	let filtered = rows.filter((row) => {
		// availableTo (vindu-slutt) hvis satt: ikke vis hvis vinduet er forbi
		if (row.availableTo && row.availableTo < today) return false;
		// yearlyWindow: må være aktiv akkurat nå hvis satt
		if (row.yearlyWindow && !isActiveOn(row.yearlyWindow, now)) return false;
		// Tilgjengelig tid: hvis brukeren oppga, filtrer estimat <= available
		if (typeof filter.availableMinutes === 'number') {
			if (row.estimatedMinutes !== null && row.estimatedMinutes > filter.availableMinutes) return false;
			if (row.estimatedMinutes === null && !filter.includeStubs) return false;
		}
		// Kontekst-tag overlapp
		if (filter.contextTags && filter.contextTags.length > 0) {
			if (!row.contextTags || row.contextTags.length === 0) return false;
			const overlap = filter.contextTags.some((t) => row.contextTags!.includes(t));
			if (!overlap) return false;
		}
		if (filter.needsClarificationOnly) {
			const needs = row.estimatedMinutes === null && !row.dueDate;
			if (!needs) return false;
		}
		return true;
	});

	// Sortering: dueDate-nærhet > yearlyWindow aktiv nå > poolPriority desc > lastSurfacedAt asc
	filtered.sort((a, b) => {
		const aDue = daysUntil(a.dueDate);
		const bDue = daysUntil(b.dueDate);
		if (aDue !== null && bDue !== null) {
			if (aDue !== bDue) return aDue - bDue;
		} else if (aDue !== null) {
			return -1;
		} else if (bDue !== null) {
			return 1;
		}

		const aYearly = a.yearlyWindow && isActiveOn(a.yearlyWindow, now) ? 1 : 0;
		const bYearly = b.yearlyWindow && isActiveOn(b.yearlyWindow, now) ? 1 : 0;
		if (aYearly !== bYearly) return bYearly - aYearly;

		if (a.poolPriority !== b.poolPriority) return b.poolPriority - a.poolPriority;

		const aSurfaced = a.lastSurfacedAt ? a.lastSurfacedAt.getTime() : 0;
		const bSurfaced = b.lastSurfacedAt ? b.lastSurfacedAt.getTime() : 0;
		return aSurfaced - bSurfaced;
	});

	const candidates: PoolCandidate[] = filtered.map((row) => {
		const reasons: string[] = [];
		const due = daysUntil(row.dueDate);
		if (due !== null && due <= 7) reasons.push(due <= 0 ? 'forfalt' : `frist om ${due}d`);
		if (row.yearlyWindow && isActiveOn(row.yearlyWindow, now)) reasons.push('sesong nå');
		if (typeof filter.availableMinutes === 'number' && row.estimatedMinutes !== null) {
			reasons.push(`passer ${row.estimatedMinutes} min`);
		}
		return {
			id: row.id,
			title: row.title,
			description: row.description,
			estimatedMinutes: row.estimatedMinutes,
			effort: row.effort,
			dueDate: row.dueDate,
			availableFrom: row.availableFrom,
			availableTo: row.availableTo,
			yearlyWindow: row.yearlyWindow,
			contextTags: row.contextTags,
			poolPriority: row.poolPriority,
			projectId: row.projectId,
			projectTitle: row.projectTitle,
			lastSurfacedAt: row.lastSurfacedAt,
			reason: reasons.length > 0 ? reasons.join(', ') : undefined
		};
	});

	if (typeof filter.limit === 'number' && filter.limit > 0) {
		return candidates.slice(0, filter.limit);
	}
	return candidates;
}

export async function markSurfaced(taskIds: string[]) {
	if (taskIds.length === 0) return;
	await db
		.update(tasks)
		.set({ lastSurfacedAt: new Date() })
		.where(sql`${tasks.id} = ANY(${taskIds})`);
}
