import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './schema';

/**
 * Memories - Viktig informasjon om brukeren som AI-en skal huske
 * 
 * Dette erstatter "siste N meldinger" med et smartere system der AI-en
 * ekstraherer og lagrer viktig informasjon fra samtaler.
 * 
 * Eksempler:
 * - "Brukeren heter Kjetil"
 * - "Brukeren er i et forhold med Emma"
 * - "Brukeren liker å løpe langs vannet"
 * - "Brukeren føler seg ofte sliten på kvelden"
 */
export const memories = pgTable('memories', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id).notNull(),
	category: text('category').notNull(), // 'personal', 'relationship', 'fitness', 'mental_health', 'preferences'
	content: text('content').notNull(), // Selve minnet
	importance: text('importance').notNull().default('medium'), // 'high', 'medium', 'low'
	source: text('source'), // Hvor kom dette minnet fra? (conversation_id eller manual)
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
	lastAccessedAt: timestamp('last_accessed_at').defaultNow().notNull() // For å vite hvilke memories som brukes mest
});

export const memoriesRelations = relations(memories, ({ one }) => ({
	user: one(users, {
		fields: [memories.userId],
		references: [users.id]
	})
}));
