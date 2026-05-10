import { db } from '$lib/db';
import {
	persons,
	personRelations,
	memories,
	goals,
	sensorEvents,
	conversations,
	tasks
} from '$lib/db/schema';
import { and, desc, eq, gte, isNotNull } from 'drizzle-orm';
import { PersonService } from './services/person-service';
import {
	buildFamilyTree,
	type FamilyTree,
	type PersonNode,
	type RelationEdge
} from '$lib/domains/family/family-tree';
import type { PersonKind, RelationType, RelationSubType } from '$lib/domains/family';

export interface FamilyDashboardData {
	tree: FamilyTree;
	persons: PersonNode[];
	relations: RelationEdge[];
	recentMemoriesByPerson: Record<string, Array<{
		id: string;
		content: string;
		category: string;
		importance: string;
		createdAt: Date;
	}>>;
	openGoalsByPerson: Record<string, Array<{
		id: string;
		title: string;
		description: string | null;
		targetDate: Date | null;
		createdAt: Date;
	}>>;
	upcomingEventsByPerson: Record<string, Array<{
		id: string;
		title: string;
		startTimestamp: string | null;
		groupName: string | null;
	}>>;
	conversationsByPerson: Record<string, Array<{
		id: string;
		title: string | null;
		updatedAt: Date;
	}>>;
	tasksByPerson: Record<string, Array<{
		id: string;
		title: string;
		status: string;
		frequency: string | null;
		createdAt: Date;
	}>>;
}

export async function loadFamilyDashboardData(userId: string): Promise<FamilyDashboardData> {
	const [allPersons, allRelations] = await Promise.all([
		PersonService.listForUser(userId),
		PersonService.listRelations(userId)
	]);

	const personIds = allPersons.map((p) => p.id);

	// Memories siste 90 dager per person
	const memoryHorizon = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
	const recentMemories = personIds.length
		? await db
				.select()
				.from(memories)
				.where(
					and(
						eq(memories.userId, userId),
						isNotNull(memories.personId),
						gte(memories.createdAt, memoryHorizon)
					)
				)
				.orderBy(desc(memories.createdAt))
		: [];

	const recentMemoriesByPerson: FamilyDashboardData['recentMemoriesByPerson'] = {};
	for (const m of recentMemories) {
		const pid = m.personId as string;
		(recentMemoriesByPerson[pid] ??= []).push({
			id: m.id,
			content: m.content,
			category: m.category,
			importance: m.importance,
			createdAt: m.createdAt
		});
	}

	// Åpne mål per person
	const openGoals = personIds.length
		? await db
				.select()
				.from(goals)
				.where(
					and(
						eq(goals.userId, userId),
						eq(goals.status, 'active'),
						isNotNull(goals.personId)
					)
				)
				.orderBy(desc(goals.createdAt))
		: [];
	const openGoalsByPerson: FamilyDashboardData['openGoalsByPerson'] = {};
	for (const g of openGoals) {
		const pid = g.personId as string;
		(openGoalsByPerson[pid] ??= []).push({
			id: g.id,
			title: g.title,
			description: g.description,
			targetDate: g.targetDate,
			createdAt: g.createdAt
		});
	}

	// Kommende Spond-events per person (nå → 30 dager)
	const now = new Date();
	const horizon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
	const upcoming = personIds.length
		? await db
				.select()
				.from(sensorEvents)
				.where(
					and(
						eq(sensorEvents.userId, userId),
						eq(sensorEvents.dataType, 'spond_event'),
						isNotNull(sensorEvents.personId),
						gte(sensorEvents.timestamp, now)
					)
				)
				.orderBy(sensorEvents.timestamp)
		: [];
	const upcomingEventsByPerson: FamilyDashboardData['upcomingEventsByPerson'] = {};
	for (const e of upcoming) {
		if (e.timestamp > horizon) continue;
		const pid = e.personId as string;
		const data = (e.data as { name?: string; startTimestamp?: string; groupName?: string } | null) ?? {};
		(upcomingEventsByPerson[pid] ??= []).push({
			id: e.id,
			title: data.name ?? 'Spond-aktivitet',
			startTimestamp: data.startTimestamp ?? null,
			groupName: data.groupName ?? null
		});
	}

	// Samtaler per person
	const personScopedConvs = personIds.length
		? await db
				.select()
				.from(conversations)
				.where(
					and(
						eq(conversations.userId, userId),
						eq(conversations.archived, false),
						isNotNull(conversations.personId)
					)
				)
				.orderBy(desc(conversations.updatedAt))
		: [];
	const conversationsByPerson: FamilyDashboardData['conversationsByPerson'] = {};
	for (const c of personScopedConvs) {
		const pid = c.personId as string;
		(conversationsByPerson[pid] ??= []).push({
			id: c.id,
			title: c.title,
			updatedAt: c.updatedAt
		});
	}

	// Aktive oppgaver direkte koblet til person via tasks.personId.
	// tasks har ikke userId direkte — vi joiner via goals.userId.
	const directTaskRows = personIds.length
		? await db
				.select({ task: tasks })
				.from(tasks)
				.innerJoin(goals, eq(tasks.goalId, goals.id))
				.where(
					and(
						eq(goals.userId, userId),
						eq(tasks.status, 'active'),
						isNotNull(tasks.personId)
					)
				)
				.orderBy(desc(tasks.createdAt))
		: [];
	const tasksByPerson: FamilyDashboardData['tasksByPerson'] = {};
	for (const { task: t } of directTaskRows) {
		const pid = t.personId as string;
		(tasksByPerson[pid] ??= []).push({
			id: t.id,
			title: t.title,
			status: t.status,
			frequency: t.frequency,
			createdAt: t.createdAt
		});
	}

	const personNodes: PersonNode[] = allPersons.map((p) => ({
		id: p.id,
		name: p.name,
		kind: p.kind as PersonKind,
		avatarEmoji: p.avatarEmoji,
		photoUrl: p.photoUrl,
		birthDate: p.birthDate,
		archived: p.archived
	}));

	const relationEdges: RelationEdge[] = allRelations.map((r) => ({
		id: r.id,
		fromPersonId: r.fromPersonId,
		toPersonId: r.toPersonId,
		relationType: r.relationType as RelationType,
		subType: r.subType as RelationSubType | null,
		closeness: r.closeness
	}));

	const tree = buildFamilyTree(personNodes, relationEdges);

	return {
		tree,
		persons: personNodes,
		relations: relationEdges,
		recentMemoriesByPerson,
		openGoalsByPerson,
		upcomingEventsByPerson,
		conversationsByPerson,
		tasksByPerson
	};
}
