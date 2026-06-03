import { db } from '$lib/db';
import {
	persons,
	personRelations,
	memories,
	goals,
	sensorEvents,
	conversations,
	tasks,
	themes
} from '$lib/db/schema';
import { and, desc, eq, gte, isNotNull } from 'drizzle-orm';
import { resolveThemeDashboardKind } from '$lib/domain/theme-dashboard-registry';
import { PersonService } from './services/person-service';
import { PersonMentionService } from './services/person-mention-service';
import {
	buildFamilyTree,
	type FamilyTree,
	type PersonNode,
	type RelationEdge
} from '$lib/domains/family/family-tree';
import type { PersonKind, RelationType, RelationSubType } from '$lib/domains/family';

/**
 * Samlet, kronologisk aktivitetsstrøm på tvers av familiemedlemmer.
 * `personIds` peker på hvilke personer elementet gjelder (et element kan nevne flere).
 * `ts` er ISO-streng — feeden er ferdig sortert (nyeste/snarest først) fra serveren.
 */
export type FamilyFeedItem =
	| {
			kind: 'event';
			id: string;
			personIds: string[];
			ts: string;
			title: string;
			groupName: string | null;
			future: boolean;
	  }
	| {
			kind: 'task';
			id: string;
			personIds: string[];
			ts: string;
			title: string;
			status: string;
			source: 'direct' | 'mention';
			confidence: 'explicit' | 'inferred' | null;
	  }
	| {
			kind: 'message-mention';
			id: string;
			personIds: string[];
			ts: string;
			conversationId: string;
			snippet: string;
			role: string;
			confidence: 'explicit' | 'inferred';
	  }
	| {
			kind: 'checklist-mention';
			id: string;
			personIds: string[];
			ts: string;
			text: string;
			checked: boolean;
			confidence: 'explicit' | 'inferred';
	  };

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
	feed: FamilyFeedItem[];
	ferieThemes: Array<{
		id: string;
		name: string;
		emoji: string | null;
		startDate: string | null;
		endDate: string | null;
		note: string | null;
	}>;
}

function buildSnippet(content: string): string {
	const trimmed = content.trim();
	if (trimmed.length <= 200) return trimmed;
	return trimmed.slice(0, 197) + '…';
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

	// ── Samlet feed på tvers av personer ──────────────────────────────────────
	// Kilder: Spond-hendelser, oppgaver (direkte + nevnt) og mentions (meldinger
	// + sjekklister). Minner/mål/samtaler holdes utenfor — de hører til person-
	// detaljen.
	const knownPersonIds = new Set(personIds);
	// Mentions er en sekundær kilde — la feeden degradere til tom i stedet for å
	// felle hele dashboardet hvis spørringene feiler (samme robusthet som
	// PersonDetailSheet, som henter mentions via et separat API).
	let msgMentionRows: Awaited<ReturnType<typeof PersonMentionService.listMessageMentionsForUser>> = [];
	let taskMentionRows: Awaited<ReturnType<typeof PersonMentionService.listTaskMentionsForUser>> = [];
	let checklistMentionRows: Awaited<ReturnType<typeof PersonMentionService.listChecklistItemMentionsForUser>> = [];
	if (personIds.length) {
		try {
			[msgMentionRows, taskMentionRows, checklistMentionRows] = await Promise.all([
				PersonMentionService.listMessageMentionsForUser(userId, { limit: 100 }),
				PersonMentionService.listTaskMentionsForUser(userId, { limit: 100 }),
				PersonMentionService.listChecklistItemMentionsForUser(userId, { limit: 100 })
			]);
		} catch (err) {
			console.error('[family-dashboard] kunne ikke laste mentions for feed:', err);
		}
	}

	const feed: FamilyFeedItem[] = [];

	// Spond-hendelser (én person per rad i sensorEvents.personId)
	for (const e of upcoming) {
		if (e.timestamp > horizon) continue;
		const pid = e.personId as string;
		if (!knownPersonIds.has(pid)) continue;
		const data =
			(e.data as { name?: string; startTimestamp?: string; groupName?: string } | null) ?? {};
		const ts = data.startTimestamp ? new Date(data.startTimestamp) : e.timestamp;
		feed.push({
			kind: 'event',
			id: e.id,
			personIds: [pid],
			ts: ts.toISOString(),
			title: data.name ?? 'Spond-aktivitet',
			groupName: data.groupName ?? null,
			future: ts.getTime() >= now.getTime()
		});
	}

	// Oppgaver: direkte koblet (tasks.personId) + nevnt (taskPersonMentions).
	// Slå sammen per taskId slik at en oppgave kun vises én gang; samle personIds.
	const taskFeedById = new Map<string, Extract<FamilyFeedItem, { kind: 'task' }>>();
	for (const { task: t } of directTaskRows) {
		const pid = t.personId as string;
		if (!knownPersonIds.has(pid)) continue;
		taskFeedById.set(t.id, {
			kind: 'task',
			id: t.id,
			personIds: [pid],
			ts: t.createdAt.toISOString(),
			title: t.title,
			status: t.status,
			source: 'direct',
			confidence: null
		});
	}
	for (const { mention, task: t } of taskMentionRows) {
		const pid = mention.personId;
		if (!knownPersonIds.has(pid)) continue;
		const existing = taskFeedById.get(t.id);
		if (existing) {
			if (!existing.personIds.includes(pid)) existing.personIds.push(pid);
			continue;
		}
		taskFeedById.set(t.id, {
			kind: 'task',
			id: t.id,
			personIds: [pid],
			ts: t.createdAt.toISOString(),
			title: t.title,
			status: t.status,
			source: 'mention',
			confidence: mention.confidence as 'explicit' | 'inferred'
		});
	}
	for (const item of taskFeedById.values()) feed.push(item);

	// Melding-mentions: grupper per melding, samle personer som er nevnt.
	const msgFeedById = new Map<string, Extract<FamilyFeedItem, { kind: 'message-mention' }>>();
	for (const { mention, message } of msgMentionRows) {
		const pid = mention.personId;
		if (!knownPersonIds.has(pid)) continue;
		const existing = msgFeedById.get(message.id);
		if (existing) {
			if (!existing.personIds.includes(pid)) existing.personIds.push(pid);
			continue;
		}
		msgFeedById.set(message.id, {
			kind: 'message-mention',
			id: message.id,
			personIds: [pid],
			ts: message.createdAt.toISOString(),
			conversationId: message.conversationId,
			snippet: buildSnippet(message.content),
			role: message.role,
			confidence: mention.confidence as 'explicit' | 'inferred'
		});
	}
	for (const item of msgFeedById.values()) feed.push(item);

	// Sjekklist-mentions: grupper per item.
	const checklistFeedById = new Map<
		string,
		Extract<FamilyFeedItem, { kind: 'checklist-mention' }>
	>();
	for (const { mention, item } of checklistMentionRows) {
		const pid = mention.personId;
		if (!knownPersonIds.has(pid)) continue;
		const existing = checklistFeedById.get(item.id);
		if (existing) {
			if (!existing.personIds.includes(pid)) existing.personIds.push(pid);
			continue;
		}
		checklistFeedById.set(item.id, {
			kind: 'checklist-mention',
			id: item.id,
			personIds: [pid],
			ts: item.createdAt.toISOString(),
			text: item.text,
			checked: item.checked,
			confidence: mention.confidence as 'explicit' | 'inferred'
		});
	}
	for (const item of checklistFeedById.values()) feed.push(item);

	// Nyeste/snarest først, kuttet til en håndterbar lengde.
	feed.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
	const trimmedFeed = feed.slice(0, 80);

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

	// Ferie-temaer (oppholdsplaner) — vises i ferie-taben i familie-dashboardet.
	const ferieThemeRows = await db
		.select()
		.from(themes)
		.where(and(eq(themes.userId, userId), eq(themes.archived, false), isNotNull(themes.ferieProfile)));
	const ferieThemes = ferieThemeRows
		.filter((t) => resolveThemeDashboardKind(t.name) === 'ferie')
		.map((t) => {
			const profile = (t.ferieProfile ?? {}) as { startDate?: string; endDate?: string; note?: string };
			return {
				id: t.id,
				name: t.name,
				emoji: t.emoji,
				startDate: profile.startDate ?? null,
				endDate: profile.endDate ?? null,
				note: profile.note ?? null
			};
		})
		.sort((a, b) => (a.startDate ?? '9999').localeCompare(b.startDate ?? '9999'));

	return {
		tree,
		persons: personNodes,
		relations: relationEdges,
		recentMemoriesByPerson,
		openGoalsByPerson,
		upcomingEventsByPerson,
		conversationsByPerson,
		tasksByPerson,
		feed: trimmedFeed,
		ferieThemes
	};
}
