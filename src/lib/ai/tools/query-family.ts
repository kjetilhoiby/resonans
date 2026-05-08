import { z } from 'zod';
import { PersonService } from '$lib/server/services/person-service';
import { PersonMentionService } from '$lib/server/services/person-mention-service';
import { db } from '$lib/db';
import { memories, goals, sensorEvents } from '$lib/db/schema';
import { and, eq, desc, isNotNull, gte } from 'drizzle-orm';

export const queryFamilyTool = {
	name: 'query_family',
	description: `Read the user's family/network data: persons, relations, recent memories per person, open goals per person, upcoming Spond events tagged to a person, and chats/tasks where a person is mentioned.

Query types:
- 'persons': List the user's persons (optionally filtered by kind or relationType).
- 'relations': List all relations.
- 'person_detail': Detailed info for one person — recent memories, open goals, upcoming events, mentions in chats/tasks.
- 'find_by_name': Look up a person by name/alias.`,

	parameters: z.object({
		userId: z.string(),
		queryType: z.enum(['persons', 'relations', 'person_detail', 'find_by_name']),
		personId: z.string().optional(),
		name: z.string().optional(),
		kind: z.string().optional(),
		limit: z.number().optional()
	}),

	execute: async (args: {
		userId: string;
		queryType: 'persons' | 'relations' | 'person_detail' | 'find_by_name';
		personId?: string;
		name?: string;
		kind?: string;
		limit?: number;
	}) => {
		switch (args.queryType) {
			case 'persons': {
				const all = await PersonService.listForUser(args.userId);
				return { persons: args.kind ? all.filter((p) => p.kind === args.kind) : all };
			}
			case 'relations': {
				const list = await PersonService.listRelations(args.userId);
				return { relations: list };
			}
			case 'find_by_name': {
				if (!args.name) return { error: 'name is required' };
				const person = await PersonService.findByName(args.userId, args.name);
				return { person };
			}
			case 'person_detail': {
				if (!args.personId) return { error: 'personId is required' };
				const person = await PersonService.getById(args.personId, args.userId);
				if (!person) return { error: 'Person not found' };

				const horizon = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
				const [recentMemories, openGoals, upcomingEvents, messageMentions, taskMentions] =
					await Promise.all([
						db
							.select()
							.from(memories)
							.where(
								and(
									eq(memories.userId, args.userId),
									eq(memories.personId, args.personId),
									gte(memories.createdAt, horizon)
								)
							)
							.orderBy(desc(memories.createdAt))
							.limit(args.limit ?? 20),
						db
							.select()
							.from(goals)
							.where(
								and(
									eq(goals.userId, args.userId),
									eq(goals.personId, args.personId),
									eq(goals.status, 'active')
								)
							)
							.orderBy(desc(goals.createdAt)),
						db
							.select()
							.from(sensorEvents)
							.where(
								and(
									eq(sensorEvents.userId, args.userId),
									eq(sensorEvents.personId, args.personId),
									eq(sensorEvents.dataType, 'spond_event'),
									gte(sensorEvents.timestamp, new Date())
								)
							)
							.orderBy(sensorEvents.timestamp)
							.limit(10),
						PersonMentionService.listMessageMentionsForPerson(args.userId, args.personId, {
							limit: 20
						}),
						PersonMentionService.listTaskMentionsForPerson(args.userId, args.personId, {
							limit: 20
						})
					]);

				return {
					person,
					recentMemories,
					openGoals,
					upcomingEvents,
					messageMentionsCount: messageMentions.length,
					taskMentionsCount: taskMentions.length,
					recentMessageMentions: messageMentions.slice(0, 5).map((r) => ({
						messageId: r.message.id,
						conversationId: r.message.conversationId,
						snippet: r.message.content.slice(0, 200),
						createdAt: r.message.createdAt
					}))
				};
			}
		}
	}
};
