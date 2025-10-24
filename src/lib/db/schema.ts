import { pgTable, uuid, text, timestamp, integer, boolean, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';


// Brukertabell
export const users = pgTable('users', {
	id: text('id').primaryKey(), // Custom ID for å støtte 'default-user'
	name: text('name').notNull(),
	email: text('email').unique(),
	googleChatWebhook: text('google_chat_webhook'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
});

// Kategorier for mål (f.eks. parforhold, trening, mental helse)
export const categories = pgTable('categories', {
	id: uuid('id').primaryKey().defaultRandom(),
	name: text('name').notNull(),
	description: text('description'),
	icon: text('icon'), // emoji eller ikon-navn
	createdAt: timestamp('created_at').defaultNow().notNull()
});

// Mål (overordnede målsetninger)
export const goals = pgTable('goals', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id).notNull(),
	categoryId: uuid('category_id').references(() => categories.id),
	title: text('title').notNull(),
	description: text('description'),
	targetDate: timestamp('target_date'),
	status: text('status').notNull().default('active'), // active, completed, paused, abandoned
	metadata: jsonb('metadata'), // fleksibel JSON for ekstra data
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
});

// Konkrete oppgaver knyttet til mål
export const tasks = pgTable('tasks', {
	id: uuid('id').primaryKey().defaultRandom(),
	goalId: uuid('goal_id').references(() => goals.id).notNull(),
	title: text('title').notNull(),
	description: text('description'),
	frequency: text('frequency'), // daily, weekly, monthly, once
	targetValue: integer('target_value'), // f.eks. antall repetisjoner
	unit: text('unit'), // f.eks. "ganger per uke", "minutter"
	status: text('status').notNull().default('active'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
});

// Fremdriftsregistreringer
export const progress = pgTable('progress', {
	id: uuid('id').primaryKey().defaultRandom(),
	taskId: uuid('task_id').references(() => tasks.id).notNull(),
	userId: text('user_id').references(() => users.id).notNull(),
	value: integer('value'), // faktisk verdi registrert
	note: text('note'),
	completedAt: timestamp('completed_at').defaultNow().notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull()
});

// Samtaler med LLM
export const conversations = pgTable('conversations', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id).notNull(),
	title: text('title'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
});

// Meldinger i samtaler
export const messages = pgTable('messages', {
	id: uuid('id').primaryKey().defaultRandom(),
	conversationId: uuid('conversation_id').references(() => conversations.id).notNull(),
	role: text('role').notNull(), // user, assistant, system
	content: text('content').notNull(),
	metadata: jsonb('metadata'), // for ekstra data som tool_calls, etc.
	createdAt: timestamp('created_at').defaultNow().notNull()
});

// Planlagte påminnelser/check-ins
export const reminders = pgTable('reminders', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id).notNull(),
	taskId: uuid('task_id').references(() => tasks.id),
	message: text('message').notNull(),
	scheduledFor: timestamp('scheduled_for').notNull(),
	sent: boolean('sent').default(false).notNull(),
	sentAt: timestamp('sent_at'),
	createdAt: timestamp('created_at').defaultNow().notNull()
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
	goals: many(goals),
	conversations: many(conversations)
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
	goals: many(goals)
}));

export const goalsRelations = relations(goals, ({ one, many }) => ({
	user: one(users, {
		fields: [goals.userId],
		references: [users.id]
	}),
	category: one(categories, {
		fields: [goals.categoryId],
		references: [categories.id]
	}),
	tasks: many(tasks)
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
	goal: one(goals, {
		fields: [tasks.goalId],
		references: [goals.id]
	}),
	progress: many(progress)
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
	user: one(users, {
		fields: [conversations.userId],
		references: [users.id]
	}),
	messages: many(messages)
}));

export const messagesRelations = relations(messages, ({ one }) => ({
	conversation: one(conversations, {
		fields: [messages.conversationId],
		references: [conversations.id]
	})
}));

