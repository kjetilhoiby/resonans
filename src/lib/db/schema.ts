import { pgTable, uuid, text, timestamp, integer, boolean, jsonb, decimal } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';


// Brukertabell
export const users = pgTable('users', {
	id: text('id').primaryKey(), // Custom ID for å støtte 'default-user'
	name: text('name').notNull(),
	email: text('email').unique(),
	googleChatWebhook: text('google_chat_webhook'),
	notificationSettings: jsonb('notification_settings').$type<{
		dailyCheckIn?: { enabled: boolean; time: string }; // format: "09:00"
		weeklyReview?: { enabled: boolean; day: string; time: string }; // day: "sunday", time: "18:00"
		milestones?: { enabled: boolean };
		reminders?: { enabled: boolean };
		inactivityAlerts?: { enabled: boolean; daysThreshold: number };
	}>(),
	timezone: text('timezone').default('Europe/Oslo'),
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

// Tema - AI-styrte, fleksible grupperinger av mål med egen chat-kontekst
export const themes = pgTable('themes', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id).notNull(),
	name: text('name').notNull(), // "Vennskap", "Løping", "Foreldre-rolle"
	emoji: text('emoji'), // 🤝, 🏃‍♂️, 👶
	parentTheme: text('parent_theme'), // "Samliv", "Helse", "Foreldreliv" - kan være null
	aiSuggested: boolean('ai_suggested').default(false).notNull(), // AI foreslo vs bruker opprettet
	conversationId: uuid('conversation_id').references(() => conversations.id), // Egen chat per tema
	description: text('description'), // AI-generert eller bruker-definert
	archived: boolean('archived').default(false).notNull(), // For cleanup uten å slette
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
});

// Mål (overordnede målsetninger)
export const goals = pgTable('goals', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id).notNull(),
	categoryId: uuid('category_id').references(() => categories.id),
	themeId: uuid('theme_id').references(() => themes.id), // Ny: kobling til tema (nullable for bakoverkompatibilitet)
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
	activityId: uuid('activity_id').references(() => activities.id), // NY: kobling til aktivitet
	taskId: uuid('task_id').references(() => tasks.id).notNull(),
	userId: text('user_id').references(() => users.id).notNull(),
	value: integer('value'), // faktisk verdi registrert
	note: text('note'),
	completedAt: timestamp('completed_at').defaultNow().notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull()
});

// Aktiviteter - Selve hendelsen/aktiviteten
export const activities = pgTable('activities', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id).notNull(),
	type: text('type').notNull(), // 'workout_run', 'relationship_date', 'mental_mood_check', etc.
	completedAt: timestamp('completed_at').notNull(),
	duration: integer('duration'), // minutter (hvis relevant)
	note: text('note'),
	metadata: jsonb('metadata'), // Fleksibel data per type
	createdAt: timestamp('created_at').defaultNow().notNull()
});

// Målbare verdier fra aktiviteten
export const activityMetrics = pgTable('activity_metrics', {
	id: uuid('id').primaryKey().defaultRandom(),
	activityId: uuid('activity_id').references(() => activities.id).notNull(),
	metricType: text('metric_type').notNull(), // 'distance', 'quality_rating', 'mood_score', etc.
	value: decimal('value').notNull(), // Bruker decimal for presisjon
	unit: text('unit'), // 'km', 'rating_1_10', 'minutes', etc.
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
	imageUrl: text('image_url'), // Cloudinary URL for bilder
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

// Memories - Viktig informasjon om brukeren som AI husker
export const memories = pgTable('memories', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id).notNull(),
	themeId: uuid('theme_id').references(() => themes.id), // Ny: memories kan være tema-spesifikke
	category: text('category').notNull(), // 'personal', 'relationship', 'fitness', 'mental_health', 'preferences'
	content: text('content').notNull(),
	importance: text('importance').notNull().default('medium'), // 'high', 'medium', 'low'
	source: text('source'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
	lastAccessedAt: timestamp('last_accessed_at').defaultNow().notNull()
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
	goals: many(goals),
	conversations: many(conversations),
	activities: many(activities),
	memories: many(memories),
	themes: many(themes),
	sensors: many(sensors),
	sensorEvents: many(sensorEvents),
	sensorAggregates: many(sensorAggregates)
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
	goals: many(goals)
}));

export const themesRelations = relations(themes, ({ one, many }) => ({
	user: one(users, {
		fields: [themes.userId],
		references: [users.id]
	}),
	conversation: one(conversations, {
		fields: [themes.conversationId],
		references: [conversations.id]
	}),
	goals: many(goals),
	memories: many(memories)
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
	theme: one(themes, {
		fields: [goals.themeId],
		references: [themes.id]
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

export const progressRelations = relations(progress, ({ one }) => ({
	task: one(tasks, {
		fields: [progress.taskId],
		references: [tasks.id]
	}),
	user: one(users, {
		fields: [progress.userId],
		references: [users.id]
	}),
	activity: one(activities, {
		fields: [progress.activityId],
		references: [activities.id]
	})
}));

export const activitiesRelations = relations(activities, ({ one, many }) => ({
	user: one(users, {
		fields: [activities.userId],
		references: [users.id]
	}),
	metrics: many(activityMetrics),
	progress: many(progress)
}));

export const activityMetricsRelations = relations(activityMetrics, ({ one }) => ({
	activity: one(activities, {
		fields: [activityMetrics.activityId],
		references: [activities.id]
	})
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

export const memoriesRelations = relations(memories, ({ one }) => ({
	user: one(users, {
		fields: [memories.userId],
		references: [users.id]
	}),
	theme: one(themes, {
		fields: [memories.themeId],
		references: [themes.id]
	})
}));

// ============================================
// SENSOR SYSTEM - Generic sensor integrations
// ============================================

// Sensor connections (Withings, TP-Link, ESP32, etc.)
export const sensors = pgTable('sensors', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id).notNull(),
	provider: text('provider').notNull(), // 'withings', 'tplink', 'esp32', 'manual'
	type: text('type').notNull(), // 'health_tracker', 'smart_plug', 'iot_sensor', 'manual_log'
	subtype: text('subtype'), // 'scale', 'watch', 'washer', 'vacuum', etc.
	name: text('name').notNull(), // User-friendly name: "Vaskemaskinen", "Withings Scale"
	credentials: text('credentials'), // Encrypted JSON: access_token, refresh_token, api_key, etc.
	config: jsonb('config').$type<{
		// Withings
		userId?: string;
		expiresAt?: number;
		// TP-Link
		ip?: string;
		mac?: string;
		thresholdWatts?: number;
		// ESP32
		apiKey?: string;
		endpoint?: string;
		// Generic
		[key: string]: any;
	}>(),
	isActive: boolean('is_active').default(true).notNull(),
	lastSync: timestamp('last_sync'),
	lastError: text('last_error'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
});

// Raw sensor events (unified event stream)
export const sensorEvents = pgTable('sensor_events', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id).notNull(),
	sensorId: uuid('sensor_id').references(() => sensors.id).notNull(),
	eventType: text('event_type').notNull(), // 'measurement', 'activity', 'state_change'
	timestamp: timestamp('timestamp').notNull(), // When the event happened (sensor time)
	data: jsonb('data').$type<{
		// Withings measurements
		weight?: number;
		fatMass?: number;
		muscleMass?: number;
		steps?: number;
		distance?: number;
		calories?: number;
		sleepDuration?: number;
		sleepDeep?: number;
		sleepLight?: number;
		sleepRem?: number;
		vo2max?: number;
		heartRate?: number;
		// Activity data
		duration?: number;
		intensity?: string;
		// IoT data
		powerWatts?: number;
		state?: 'on' | 'off' | 'running';
		runDuration?: number;
		// Generic
		[key: string]: any;
	}>(),
	metadata: jsonb('metadata').$type<{
		source?: string; // API version, device model, etc.
		quality?: number; // Data quality score
		rawResponse?: any; // Original API response for debugging
		[key: string]: any;
	}>(),
	createdAt: timestamp('created_at').defaultNow().notNull() // When we received it
});

// Pre-aggregated data for performance (weekly, monthly, yearly)
export const sensorAggregates = pgTable('sensor_aggregates', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id).notNull(),
	period: text('period').notNull(), // 'week', 'month', 'year'
	periodKey: text('period_key').notNull(), // '2025W43', '2025M10', '2025'
	startDate: timestamp('start_date').notNull(),
	endDate: timestamp('end_date').notNull(),
	metrics: jsonb('metrics').$type<{
		// Health metrics (avg, min, max, sum)
		weight?: { avg?: number; min?: number; max?: number; change?: number };
		steps?: { sum?: number; avg?: number; max?: number };
		sleep?: { avg?: number; min?: number; max?: number };
		vo2max?: { avg?: number; latest?: number };
		// Activity metrics
		workouts?: { count?: number; totalDuration?: number; types?: Record<string, number> };
		intenseMinutes?: { sum?: number; avg?: number };
		// Household metrics
		laundry?: { count?: number; avgDuration?: number };
		dishes?: { count?: number };
		vacuum?: { count?: number; totalDuration?: number };
		// Custom metrics (from your ninthlife app)
		sleepLag?: number; // (100 - % awake 22-00) or similar
		earlyWake?: number; // % asleep 06-08
		// Generic
		[key: string]: any;
	}>(),
	eventCount: integer('event_count').notNull().default(0), // How many raw events
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
});

// Sensor-connected goals (auto-updating progress)
export const sensorGoals = pgTable('sensor_goals', {
	id: uuid('id').primaryKey().defaultRandom(),
	goalId: uuid('goal_id').references(() => goals.id).notNull(),
	metricType: text('metric_type').notNull(), // 'weight', 'steps', 'sleep', etc.
	targetValue: decimal('target_value'),
	targetChange: decimal('target_change'), // e.g., -5 for "lose 5kg"
	currentValue: decimal('current_value'),
	baselineValue: decimal('baseline_value'),
	unit: text('unit'), // 'kg', 'steps/day', 'hours', etc.
	autoUpdate: boolean('auto_update').default(true).notNull(),
	lastUpdated: timestamp('last_updated'),
	createdAt: timestamp('created_at').defaultNow().notNull()
});

// Relations for sensors
export const sensorsRelations = relations(sensors, ({ one, many }) => ({
	user: one(users, {
		fields: [sensors.userId],
		references: [users.id]
	}),
	events: many(sensorEvents)
}));

export const sensorEventsRelations = relations(sensorEvents, ({ one }) => ({
	user: one(users, {
		fields: [sensorEvents.userId],
		references: [users.id]
	}),
	sensor: one(sensors, {
		fields: [sensorEvents.sensorId],
		references: [sensors.id]
	})
}));

export const sensorAggregatesRelations = relations(sensorAggregates, ({ one }) => ({
	user: one(users, {
		fields: [sensorAggregates.userId],
		references: [users.id]
	})
}));

export const sensorGoalsRelations = relations(sensorGoals, ({ one }) => ({
	goal: one(goals, {
		fields: [sensorGoals.goalId],
		references: [goals.id]
	})
}));
