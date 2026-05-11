import { pgTable, uuid, text, timestamp, integer, boolean, jsonb, decimal, unique, index, uniqueIndex, date, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';


// Brukertabell
export const users = pgTable('users', {
	id: text('id').primaryKey(), // Custom ID for å støtte 'default-user'
	name: text('name').notNull(),
	email: text('email').unique(),
	isAdmin: boolean('is_admin').default(false).notNull(),
	partnerUserId: text('partner_user_id'),
	partnerConfirmedAt: timestamp('partner_confirmed_at'),
	googleChatWebhook: text('google_chat_webhook'),
	notificationSettings: jsonb('notification_settings').$type<{
		notificationChannels?: {
			googleChat?: Array<{ id: string; name: string; webhook: string; enabled?: boolean }>;
			routing?: {
				dailyCheckIn?: string[];
				dayPlanning?: string[];
				dayClose?: string[];
				relationshipCheckinMorning?: string[];
				digestDay?: string[];
				egenfrekvensCheckin?: string[];
			};
		};
		dailyCheckIn?: { enabled: boolean; time: string }; // format: "09:00"
		dayPlanning?: { enabled: boolean; time: string }; // default "07:00"
		dayClose?: { enabled: boolean; time: string }; // default "21:00"
		relationshipCheckinMorning?: { enabled: boolean; time: string }; // default "08:30"
		egenfrekvensCheckin?: { enabled: boolean; time: string }; // default "09:00"
		nudgeProfile?: {
			weekdayMode?: 'interactive' | 'digest';
			weekendMode?: 'interactive' | 'digest';
			quietHours?: { enabled: boolean; start: string; end: string };
			digestTimeWeekday?: string;
			digestTimeWeekend?: string;
		};
		weeklyReview?: { enabled: boolean; day: string; time: string }; // day: "sunday", time: "18:00"
		milestones?: { enabled: boolean };
		reminders?: { enabled: boolean };
		workoutImports?: { enabled: boolean };
		inactivityAlerts?: { enabled: boolean; daysThreshold: number };
	}>(),
	timezone: text('timezone').default('Europe/Oslo'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
});

export const authAccounts = pgTable('auth_accounts', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id).notNull(),
	provider: text('provider').notNull(),
	providerAccountId: text('provider_account_id').notNull(),
	email: text('email'),
	emailVerified: boolean('email_verified').default(false).notNull(),
	name: text('name'),
	image: text('image'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
	uniqueProviderAccount: unique().on(table.provider, table.providerAccountId),
	uniqueUserProvider: unique().on(table.userId, table.provider)
}));

export const userApiSecrets = pgTable('user_api_secrets', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
	label: text('label').notNull(),
	secretPrefix: text('secret_prefix').notNull(),
	secretHash: text('secret_hash').notNull().unique(),
	lastUsedAt: timestamp('last_used_at'),
	expiresAt: timestamp('expires_at'),
	revokedAt: timestamp('revoked_at'),
	createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => ({
	idxUserActiveSecrets: index('user_api_secrets_user_active_idx').on(table.userId, table.revokedAt, table.createdAt),
	idxUserLastUsed: index('user_api_secrets_user_last_used_idx').on(table.userId, table.lastUsedAt)
}));

export const allowedEmails = pgTable('allowed_emails', {
	id: uuid('id').primaryKey().defaultRandom(),
	email: text('email').notNull().unique(),
	note: text('note'),
	invitedByUserId: text('invited_by_user_id').references(() => users.id),
	lastUsedAt: timestamp('last_used_at'),
	createdAt: timestamp('created_at').defaultNow().notNull()
});

export const marriageInvites = pgTable('marriage_invites', {
	id: uuid('id').primaryKey().defaultRandom(),
	inviterUserId: text('inviter_user_id').references(() => users.id).notNull(),
	inviteeEmail: text('invitee_email').notNull(),
	inviteeUserId: text('invitee_user_id').references(() => users.id),
	status: text('status').notNull().default('pending'),
	token: text('token').notNull().unique(),
	respondedAt: timestamp('responded_at'),
	createdAt: timestamp('created_at').defaultNow().notNull()
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
	conversationId: uuid('conversation_id').references((): AnyPgColumn => conversations.id), // Egen chat per tema
	description: text('description'), // AI-generert eller bruker-definert
	archived: boolean('archived').default(false).notNull(), // For cleanup uten å slette
	tripProfile: jsonb('trip_profile').$type<{
		destination?: string;
		country?: string;
		lat?: number;
		lng?: number;
		startDate?: string;   // ISO 'YYYY-MM-DD'
		endDate?: string;     // ISO 'YYYY-MM-DD'
		accountIds?: string[]; // Optional filter: only include transactions from these accounts
		overnightStays?: Array<{
			id: string;
			name: string;
			checkIn: string;
			checkOut: string;
			refNumber?: string;
			lockCode?: string;
			address?: string;
			notes?: string;
		}>;
	}>(),
	sortOrder: integer('sort_order').default(0).notNull(),
	metricSettings: jsonb('metric_settings').$type<{
		distance?: { goal?: number; thresholdWarn?: number; thresholdSuccess?: number };
		sleep?: { goal?: number; thresholdWarn?: number; thresholdSuccess?: number };
		sleepLag?: { goal?: number; thresholdWarn?: number; thresholdSuccess?: number };
		steps?: { goal?: number; thresholdWarn?: number; thresholdSuccess?: number };
		activeMinutes?: { goal?: number; thresholdWarn?: number; thresholdSuccess?: number };
		weight?: { goal?: number; thresholdWarn?: number; thresholdSuccess?: number };
	}>(),
	instructions: text('instructions'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
});

// Tema-lister: navngitte huskelister, itineraries, aktivitetsforslag osv.
export const themeLists = pgTable('theme_lists', {
	id: uuid('id').primaryKey().defaultRandom(),
	themeId: uuid('theme_id').references(() => themes.id, { onDelete: 'cascade' }).notNull(),
	userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
	title: text('title').notNull(),
	emoji: text('emoji').notNull().default('📝'),
	listType: text('list_type').notNull().default('general'), // 'itinerary'|'activities'|'packing'|'general'
	sortOrder: integer('sort_order').notNull().default(0),
	createdAt: timestamp('created_at').defaultNow().notNull()
});

// Elementer i en tema-liste
export const themeListItems = pgTable('theme_list_items', {
	id: uuid('id').primaryKey().defaultRandom(),
	listId: uuid('list_id').references(() => themeLists.id, { onDelete: 'cascade' }).notNull(),
	userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
	text: text('text').notNull(),
	checked: boolean('checked').notNull().default(false),
	notes: text('notes'),
	itemDate: text('item_date'), // ISO date for itinerary/datedagenda items
	sortOrder: integer('sort_order').notNull().default(0),
	checkedAt: timestamp('checked_at'),
	createdAt: timestamp('created_at').defaultNow().notNull()
});

// Filer knyttet til et tema (bilder, PDF-er, dokumenter)
export const themeFiles = pgTable('theme_files', {
	id: uuid('id').primaryKey().defaultRandom(),
	themeId: uuid('theme_id').references(() => themes.id, { onDelete: 'cascade' }).notNull(),
	userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
	name: text('name').notNull(),
	url: text('url').notNull(), // Cloudinary URL
	fileType: text('file_type'), // 'image'|'pdf'|'document'
	mimeType: text('mime_type'),
	sizeBytes: integer('size_bytes'),
	parsedContent: text('parsed_content'),
	createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => ({
	idxThemeId: index('theme_files_theme_id_idx').on(table.themeId)
}));

// Mål (overordnede målsetninger)
export const goals = pgTable('goals', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id).notNull(),
	categoryId: uuid('category_id').references(() => categories.id),
	themeId: uuid('theme_id').references(() => themes.id), // Ny: kobling til tema (nullable for bakoverkompatibilitet)
	personId: uuid('person_id').references((): AnyPgColumn => persons.id, { onDelete: 'set null' }), // Mål knyttet til en bestemt person
	parentGoalId: uuid('parent_goal_id').references((): AnyPgColumn => goals.id, { onDelete: 'set null' }),
	periodKey: text('period_key'), // '2026' | '2026-Q1' | '2026-04' | null (løpende)
	title: text('title').notNull(),
	description: text('description'),
	targetDate: timestamp('target_date'),
	status: text('status').notNull().default('active'), // active, completed, paused, abandoned, archived
	metadata: jsonb('metadata'), // fleksibel JSON for ekstra data
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
	idxUserId: index('goals_user_id_idx').on(table.userId),
	idxPerson: index('goals_person_idx').on(table.personId),
	idxParent: index('goals_parent_idx').on(table.parentGoalId),
	idxPeriod: index('goals_user_period_idx').on(table.userId, table.periodKey)
}));

// Konkrete oppgaver knyttet til mål
// Generell prosjekttabell — domen-agnostisk primitiv. Brukes av hus-domenet
// (oppussing/vedlikehold/reparasjon) og kan gjenbrukes av reise/event/jobb m.m.
// Hvert prosjekt eier 0..n tasks, checklistItems og categorizedEvents via projectId.
export const projects = pgTable('projects', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id).notNull(),
	domain: text('domain'), // DomainType | null
	themeId: uuid('theme_id').references(() => themes.id, { onDelete: 'set null' }),
	title: text('title').notNull(),
	description: text('description'),
	type: text('type'), // f.eks. 'renovation' | 'maintenance' | 'repair' | 'organize' | 'trip' | 'event'
	status: text('status').notNull().default('planning'), // planning | active | paused | done | cancelled
	budgetNok: integer('budget_nok'),
	startedAt: timestamp('started_at'),
	targetCompletionAt: timestamp('target_completion_at'),
	completedAt: timestamp('completed_at'),
	metadata: jsonb('metadata').default({}).notNull(), // f.eks. { room?: HomeRoom, contractor?: string, phases?: string[] }
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (t) => ({
	idxUser: index('projects_user_idx').on(t.userId),
	idxDomain: index('projects_domain_idx').on(t.userId, t.domain),
	idxStatus: index('projects_status_idx').on(t.status),
	idxTheme: index('projects_theme_idx').on(t.themeId)
}));

export const tasks = pgTable('tasks', {
	id: uuid('id').primaryKey().defaultRandom(),
	goalId: uuid('goal_id').references(() => goals.id), // valgfri — sesong-/prosjekt-tasks trenger ikke mål
	projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
	personId: uuid('person_id').references((): AnyPgColumn => persons.id, { onDelete: 'set null' }), // Oppgave knyttet til en bestemt person
	title: text('title').notNull(),
	description: text('description'),
	frequency: text('frequency'), // daily, weekly, monthly, once
	periodType: text('period_type'), // 'week' | 'month' | 'year' | null (null = løpende)
	periodId: text('period_id'),   // '2026-W14' | '2026-04' | '2026' | null
	targetValue: integer('target_value'), // f.eks. antall repetisjoner
	unit: text('unit'), // f.eks. "ganger per uke", "minutter"
	season: text('season'), // 'spring' | 'summer' | 'autumn' | 'winter' | null — sesong-bundne oppgaver
	recurrenceYearly: boolean('recurrence_yearly').default(false).notNull(),
	metadata: jsonb('metadata').default({}).notNull(), // fleksibel JSON for ekstra data (intentStatus, intentError, etc)
	status: text('status').notNull().default('active'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
	idxPerson: index('tasks_person_idx').on(table.personId),
	idxProject: index('tasks_project_idx').on(table.projectId),
	idxSeason: index('tasks_season_idx').on(table.season)
}));

// Fremdriftsregistreringer
export const progress = pgTable('progress', {
	id: uuid('id').primaryKey().defaultRandom(),
	// DEPRECATED: Legacy kobling til activities-tabellen. Nye registreringer går via sensorEvents.
	activityId: uuid('activity_id').references(() => activities.id),
	taskId: uuid('task_id').references(() => tasks.id).notNull(),
	userId: text('user_id').references(() => users.id).notNull(),
	value: integer('value'), // faktisk verdi registrert
	note: text('note'),
	completedAt: timestamp('completed_at').defaultNow().notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull()
});

// DEPRECATED LEGACY TABLE: activities
// Brukes ikke lenger som primær kilde. Nye aktiviteter skrives til sensorEvents.
// Beholdes midlertidig for bakoverkompatibilitet og kontrollert utfasing.
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
// DEPRECATED LEGACY TABLE: activity_metrics
// Tilhørende legacy-tabell for activities. Nye målinger lagres i sensorEvents.data.
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
	themeId: uuid('theme_id').references((): AnyPgColumn => themes.id, { onDelete: 'set null' }),
	personId: uuid('person_id').references((): AnyPgColumn => persons.id, { onDelete: 'set null' }), // Samtale dedikert til en relasjon (kan kombineres med themeId)
	title: text('title'),
	starred: boolean('starred').default(false).notNull(),
	archived: boolean('archived').default(false).notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
	idxPerson: index('conversations_person_idx').on(table.personId)
}));

// Meldinger i samtaler
export const messages = pgTable('messages', {
	id: uuid('id').primaryKey().defaultRandom(),
	conversationId: uuid('conversation_id').references(() => conversations.id).notNull(),
	role: text('role').notNull(), // user, assistant, system
	content: text('content').notNull(),
	imageUrl: text('image_url'), // Cloudinary URL for bilder
	metadata: jsonb('metadata'), // for ekstra data som tool_calls, etc.
	starred: boolean('starred').default(false).notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => ({
	idxConversationId: index('messages_conversation_id_idx').on(table.conversationId)
}));

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
}, (table) => ({
	idxUserScheduledSent: index('reminders_user_scheduled_sent_idx').on(table.userId, table.scheduledFor, table.sent)
}));

// Nudge effect measurement (sent/opened/flow-started/flow-completed)
export const nudgeEvents = pgTable('nudge_events', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
	channel: text('channel').notNull().default('google_chat'),
	nudgeType: text('nudge_type').notNull(), // 'plan_day' | 'close_day' | 'digest_day' | 'relationship_checkin_morning' | 'family_parent_time_low' | 'family_relation_neglect' | 'family_birthday'
	mode: text('mode'), // 'interactive' | 'digest'
	personId: uuid('person_id').references((): AnyPgColumn => persons.id, { onDelete: 'set null' }), // Hvilken person nudgen handler om
	context: jsonb('context').$type<Record<string, unknown>>(),
	sentAt: timestamp('sent_at'),
	openedAt: timestamp('opened_at'),
	flowStartedAt: timestamp('flow_started_at'),
	flowCompletedAt: timestamp('flow_completed_at'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
	idxNudgeEventsUserCreated: index('nudge_events_user_created_idx').on(table.userId, table.createdAt),
	idxNudgeEventsUserSent: index('nudge_events_user_sent_idx').on(table.userId, table.sentAt)
}));

// Registry of allowed cross-domain signal contracts.
export const signalContracts = pgTable('signal_contracts', {
	id: uuid('id').primaryKey().defaultRandom(),
	signalType: text('signal_type').notNull().unique(),
	ownerDomain: text('owner_domain').notNull(), // 'health' | 'economics' | 'home' | 'relationship'
	allowedConsumerDomains: text('allowed_consumer_domains').array().notNull().default(sql`ARRAY[]::text[]`),
	schemaVersion: integer('schema_version').notNull().default(1),
	status: text('status').notNull().default('active'), // 'active' | 'deprecated'
	description: text('description'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
	idxSignalContractsOwnerStatus: index('signal_contracts_owner_status_idx').on(table.ownerDomain, table.status)
}));

// Materialized derived signals used across domains and user-composed themes.
export const domainSignals = pgTable('domain_signals', {
	id: uuid('id').primaryKey().defaultRandom(),
	signalType: text('signal_type').notNull().references(() => signalContracts.signalType),
	ownerDomain: text('owner_domain').notNull(),
	userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
	relatedUserId: text('related_user_id').references(() => users.id, { onDelete: 'set null' }),
	valueNumber: decimal('value_number'),
	valueText: text('value_text'),
	valueBool: boolean('value_bool'),
	severity: text('severity').notNull().default('info'), // 'info' | 'low' | 'medium' | 'high'
	confidence: decimal('confidence').notNull().default('0.5'),
	windowStart: timestamp('window_start').notNull(),
	windowEnd: timestamp('window_end').notNull(),
	observedAt: timestamp('observed_at').notNull(),
	context: jsonb('context').$type<Record<string, unknown>>().notNull().default({}),
	schemaVersion: integer('schema_version').notNull().default(1),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
	idxDomainSignalsUserObserved: index('domain_signals_user_observed_idx').on(table.userId, table.observedAt),
	idxDomainSignalsTypeObserved: index('domain_signals_type_observed_idx').on(table.signalType, table.observedAt),
	uniqDomainSignalWindow: uniqueIndex('domain_signals_user_type_window_unique').on(table.userId, table.signalType, table.windowEnd)
}));

// Which signals are enabled as input for a user theme.
export const themeSignalLinks = pgTable('theme_signal_links', {
	id: uuid('id').primaryKey().defaultRandom(),
	themeId: uuid('theme_id').references(() => themes.id, { onDelete: 'cascade' }).notNull(),
	userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
	signalType: text('signal_type').notNull().references(() => signalContracts.signalType),
	enabled: boolean('enabled').notNull().default(true),
	config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
	uniqueThemeSignal: unique().on(table.themeId, table.signalType),
	idxThemeSignalLinksTheme: index('theme_signal_links_theme_idx').on(table.themeId, table.enabled),
	idxThemeSignalLinksUser: index('theme_signal_links_user_idx').on(table.userId, table.signalType)
}));

// Brukerdefinerbare widgets til hjemmeskjerm og temasider
// Hvert widget er en dynamisk dataspørring: metrikk × aggregering × periode × range
// themeId er null for hjemmeskjerm-widgets, satt for tema-widgets
export const userWidgets = pgTable('user_widgets', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id).notNull(),
	themeId: uuid('theme_id').references(() => themes.id, { onDelete: 'cascade' }), // null = hjemmeskjerm, uuid = tema-widget
	title: text('title').notNull(),                         // "Snitt søvn siste 7 dager"
	metricType: text('metric_type').notNull(),              // 'weight'|'sleepDuration'|'steps'|'distance'|'amount'|'workoutCount'|'heartrate'|'mood'
	aggregation: text('aggregation').notNull(),             // 'avg'|'sum'|'count'|'latest'
	period: text('period').notNull(),                       // 'day'|'week'|'month'
	range: text('range').notNull(),                         // 'last7'|'last14'|'last30'|'current_week'|'current_month'|'current_year'
	goal: decimal('goal'),                                  // Brukerens målverdi (nullable)
	thresholdWarn: decimal('threshold_warn'),               // Verdi under/over hvilken widgeten viser advarsel
	thresholdSuccess: decimal('threshold_success'),         // Verdi over/under hvilken widgeten viser suksess
	unit: text('unit').notNull(),                           // 'kg'|'h'|'km'|'kr'|'skritt'|'slag/min' etc.
	filterCategory: text('filter_category'),                // Valgfri kategorifilter for amount-metrikk (f.eks. 'dagligvarer', 'kafe_og_restaurant', 'bil_og_transport')
	filterSubcategory: text('filter_subcategory'),          // Valgfri subkategorifilter (f.eks. 'fastfood', 'kafe' under kafe_og_restaurant)
	metricKey: text('metric_key'),                          // Dynamisk metrikkregisternøkkel (f.eks. 'spending_bil_og_transport_drivstoff'). Overstyrer METRIC_CONFIG-path i widget-API.
	color: text('color').notNull().default('#7c8ef5'),      // Hex-farge for widget
	pinned: boolean('pinned').default(false).notNull(),     // Vises på hjemmeskjerm (kun relevant når themeId IS NULL)
	sortOrder: integer('sort_order').default(0).notNull(),  // Rekkefølge innenfor surface (hjemmeskjerm eller tema)
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
});

// Sjekklister — tidsavgrensede lister (pakkelister, forberedelser, etc.)
export const checklists = pgTable('checklists', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
	title: text('title').notNull(),                  // "Forberede tur til Bergen"
	emoji: text('emoji').notNull().default('✅'),     // "✈️", "🎒", "🚗"
	context: text('context'),                         // 'tur', 'pakkeliste', 'event', etc.
	completedAt: timestamp('completed_at'),           // satt når alle punkter er avkrysset
	planConversationId: uuid('plan_conversation_id').references((): AnyPgColumn => conversations.id, { onDelete: 'set null' }),
	createdAt: timestamp('created_at').defaultNow().notNull()
});

// Enkeltpunkter i en sjekkliste
export const checklistItems = pgTable('checklist_items', {
	id: uuid('id').primaryKey().defaultRandom(),
	checklistId: uuid('checklist_id').references(() => checklists.id, { onDelete: 'cascade' }).notNull(),
	userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
	projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }), // Knytt item til prosjekt for burn-up
	parentId: uuid('parent_id').references((): AnyPgColumn => checklistItems.id, { onDelete: 'cascade' }), // For subtasks/hierarchical structure
	text: text('text').notNull(),
	checked: boolean('checked').notNull().default(false),
	sortOrder: integer('sort_order').notNull().default(0),
	checkedAt: timestamp('checked_at'),
	skippedAt: timestamp('skipped_at'),
	snoozedToDate: date('snoozed_to_date'),
	startDate: date('start_date'), // When the task should start (optional)
	endDate: date('end_date'), // When the task should be completed by (optional)
	metadata: jsonb('metadata').default({}).notNull().$type<{
		// Intent linking
		linkedTaskId?: string;
		linkedTaskTitle?: string;
		activityType?: string;
		durationMinutes?: number;
		distanceKm?: number;
		// Wake-time intent
		wakeTargetHour?: number;
		wakeTargetMinute?: number;
		// Tracking state
		autoChecked?: boolean;
		autoCheckedAt?: string;
		progressRecordId?: string;
		wakeHour?: number;
		wakeMinute?: number;
		// Breakdown metadata
		breakdownPrompt?: string; // The prompt used to generate breakdown
		breakdownModel?: string; // The model used for breakdown
		// Snooze tracking — id of the copy created when user snoozed this item
		snoozedToItemId?: string;
		// Email import metadata
		source?: string;
		label?: string;
		gmailMessageId?: string;
		gmailThreadId?: string;
		from?: string;
	}>(),
	createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => ({
	idxProject: index('checklist_items_project_idx').on(table.projectId)
}));

// ─── Food Domain ───────────────────────────────────────────────
// Oppskrifter — gjenbrukbare matretter med ingredienser, instruksjoner og valgfri næringsestimat
export const recipes = pgTable('recipes', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
	title: text('title').notNull(),
	description: text('description'),
	ingredients: jsonb('ingredients').$type<Array<{
		name: string;
		quantity?: number | null;
		unit?: string | null;
		optional?: boolean;
	}>>().notNull().default([]),
	instructions: text('instructions').array().notNull().default(sql`ARRAY[]::text[]`),
	prepTimeMin: integer('prep_time_min'),
	cookTimeMin: integer('cook_time_min'),
	servings: integer('servings').default(2).notNull(),
	tags: text('tags').array().notNull().default(sql`ARRAY[]::text[]`),
	imageUrl: text('image_url'), // Cloudinary-URL fra felles bilde-pipeline
	sourceUrl: text('source_url'),
	nutritionEstimate: jsonb('nutrition_estimate').$type<{
		kcal?: number;
		proteinG?: number;
		carbsG?: number;
		fatG?: number;
		confidence?: number; // 0-1
		source: 'vision' | 'manual' | 'recipe-derived';
	} | null>(),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
	idxRecipesUser: index('recipes_user_idx').on(table.userId, table.createdAt)
}));

// Måltidsplaner — koblingen mellom dato/måltidstype og oppskrift eller fri tekst
export const mealPlans = pgTable('meal_plans', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
	weekContext: text('week_context').notNull(), // f.eks. '2026-W17'
	date: date('date').notNull(),
	mealType: text('meal_type').notNull(), // 'breakfast' | 'lunch' | 'dinner' | 'snack'
	recipeId: uuid('recipe_id').references((): AnyPgColumn => recipes.id, { onDelete: 'set null' }),
	customTitle: text('custom_title'),
	notes: text('notes'),
	servings: integer('servings').default(2).notNull(),
	photoUrl: text('photo_url'), // Cloudinary-URL for "what we ate"
	createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => ({
	idxMealPlansUserWeek: index('meal_plans_user_week_idx').on(table.userId, table.weekContext),
	idxMealPlansUserDate: index('meal_plans_user_date_idx').on(table.userId, table.date)
}));

// Pantry-items — lett oversikt over innhold i skap, kjøleskap og fryser
export const pantryItems = pgTable('pantry_items', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
	name: text('name').notNull(),
	location: text('location').notNull(), // 'pantry' | 'fridge' | 'freezer'
	quantity: decimal('quantity'),
	unit: text('unit'),
	expiresAt: date('expires_at'),
	addedAt: timestamp('added_at').defaultNow().notNull(),
	lastUsedAt: timestamp('last_used_at'),
	notes: text('notes')
}, (table) => ({
	idxPantryUserLocation: index('pantry_items_user_location_idx').on(table.userId, table.location),
	idxPantryUserExpires: index('pantry_items_user_expires_idx').on(table.userId, table.expiresAt)
}));

// Memories - Stabile, kuraterte fakta om brukeren som AI husker.
// MERK: Denne tabellen er for langtidsfakta (preferanser, verdier, relasjoner, helsebakgrunn).
// Tidsstemplede refleksjoner -> reflections, planartefakter -> plan_artifacts,
// LLM-synteser -> dreams, goal-tracks -> goal_tracks, theme-instruksjoner -> themes.instructions,
// parsed fil-innhold -> theme_files.parsed_content.
export const memories = pgTable('memories', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id).notNull(),
	themeId: uuid('theme_id').references(() => themes.id),
	personId: uuid('person_id').references((): AnyPgColumn => persons.id, { onDelete: 'set null' }),
	category: text('category').notNull(), // 'personal' | 'relationship' | 'fitness' | 'mental_health' | 'preferences' | 'values' | 'health_baseline' | 'other'
	content: text('content').notNull(),
	importance: text('importance').notNull().default('medium'), // 'high' | 'medium' | 'low'
	confidence: text('confidence').notNull().default('user_confirmed'), // 'user_confirmed' | 'llm_inferred' | 'imported'
	source: text('source'),
	sourceRef: jsonb('source_ref').$type<{ kind: string; id?: string }>(), // Strukturert sporbarhet, f.eks. { kind: 'reflection', id: '…' }
	supersededBy: uuid('superseded_by'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
	lastAccessedAt: timestamp('last_accessed_at').defaultNow().notNull()
}, (table) => ({
	idxUserId: index('memories_user_id_idx').on(table.userId),
	idxPerson: index('memories_person_idx').on(table.personId)
}));

// Reflections - Tidsstemplede refleksjoner (egenfrekvens-snapshot, day_close, salary_report,
// uke-/månedsrefleksjon o.l.). Skal være lett å hente i tidsserie for DreamService.
export const reflections = pgTable('reflections', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
	themeId: uuid('theme_id').references(() => themes.id, { onDelete: 'set null' }),
	personId: uuid('person_id').references((): AnyPgColumn => persons.id, { onDelete: 'set null' }),
	kind: text('kind').notNull(), // 'day_close' | 'week_review' | 'month_review' | 'salary_report' | 'goal_check' | 'ad_hoc'
	periodKey: text('period_key'), // '2026-05-09' | '2026-W19' | '2026-05' | null for ad-hoc
	content: text('content').notNull(),
	scores: jsonb('scores').$type<{
		mood?: number;
		energy?: number;
		focus?: number;
		[key: string]: unknown;
	}>(),
	flowRunId: text('flow_run_id'),
	createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => ({
	idxReflectionsUserCreated: index('reflections_user_created_idx').on(table.userId, table.createdAt),
	idxReflectionsUserKindPeriod: index('reflections_user_kind_period_idx').on(table.userId, table.kind, table.periodKey)
}));

// Plan artifacts - Strukturerte planer fra dag/uke/måned-ritualer.
// Én rad per (userId, kind, periodKey) med valgfrie tekstfelter.
export const planArtifacts = pgTable('plan_artifacts', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
	themeId: uuid('theme_id').references(() => themes.id, { onDelete: 'set null' }),
	kind: text('kind').notNull(), // 'day' | 'week' | 'month'
	periodKey: text('period_key').notNull(), // '2026-05-09' | '2026-W19' | '2026-05'
	parentPeriodKey: text('parent_period_key'), // For 'day': '2026-W19' (uke); for 'week': '2026-05' (måned)
	headline: text('headline'),
	note: text('note'),
	reflection: text('reflection'),
	vision: text('vision'),
	goalRefs: jsonb('goal_refs').$type<string[]>(),
	status: text('status').notNull().default('active'), // 'active' | 'closed' | 'archived'
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
	closedAt: timestamp('closed_at')
}, (table) => ({
	uqPlanArtifactPeriod: uniqueIndex('plan_artifacts_user_kind_period_uq').on(table.userId, table.kind, table.periodKey),
	idxPlanArtifactsParent: index('plan_artifacts_user_parent_idx').on(table.userId, table.parentPeriodKey)
}));

// Dreams - LLM-syntetisert kontekst som chat plukker ferdig-komprimert.
// Bærer den doble betydningen: tilbakeblikk ("natt-drøm") og retning ("våken drøm").
//   kind = '{daily|weekly|monthly|yearly}_dream'  → tilbakeblikk på en periode
//   kind = 'vision_{5year|yearly|quarterly|themed}' → langsiktig retning / ønske
// inputs.previousBriefId kjeder synteser; supersededBy peker til ny versjon når
// en drøm regenereres (f.eks. fordi en sen refleksjon kom inn).
// originKind forteller hvordan drømmen ble til; confidence styrer hvor mye
// chat-promptet skal stole på den.
export const dreams = pgTable('dreams', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
	kind: text('kind').notNull(),
	scopeStart: timestamp('scope_start').notNull(),
	scopeEnd: timestamp('scope_end').notNull(),
	summary: text('summary').notNull(),
	highlights: jsonb('highlights').$type<{
		mode?: 'least_effort' | 'steady' | 'push';
		rationale?: string;
		wins?: string[];
		frictions?: string[];
		signals?: Array<{ type: string; value: unknown; note?: string }>;
		alignment?: { yearGoal?: string; quarterGoal?: string; monthGoal?: string };
		[key: string]: unknown;
	}>(),
	inputs: jsonb('inputs').$type<{
		reflectionIds?: string[];
		planArtifactIds?: string[];
		signalIds?: string[];
		aggregateIds?: string[];
		goalIds?: string[];
		themeIds?: string[];
		previousBriefId?: string;
		childBriefIds?: string[];
		memoryIds?: string[];
	}>(),
	goalIds: uuid('goal_ids').array(),
	themeIds: uuid('theme_ids').array(),
	model: text('model'),
	promptVersion: text('prompt_version'),
	relevanceUntil: timestamp('relevance_until'),
	supersededBy: uuid('superseded_by'),
	confidence: text('confidence').notNull().default('user_confirmed'),
	originKind: text('origin_kind'),
	createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => ({
	idxDreamsUserKindCreated: index('dreams_user_kind_created_idx').on(table.userId, table.kind, table.createdAt),
	idxDreamsUserRelevance: index('dreams_user_relevance_idx').on(table.userId, table.relevanceUntil)
}));

// Goal tracks - Per-metric-konfigurasjon av mål-spor (erstatter goal_tracks_v1 i memories).
export const goalTracks = pgTable('goal_tracks', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
	metricId: text('metric_id').notNull(),
	tracks: jsonb('tracks').notNull().default(sql`'[]'::jsonb`),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => ({
	uqGoalTracksUserMetric: uniqueIndex('goal_tracks_user_metric_uq').on(table.userId, table.metricId)
}));

// ─── Family / Network Domain ────────────────────────────────────
// Personer i brukerens nettverk: barn, partner, foreldre, svigerfamilie, venner, kolleger.
export const persons = pgTable('persons', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
	name: text('name').notNull(),                                // visningsnavn ("Nils")
	fullName: text('full_name'),                                  // valgfritt fullt navn
	nickname: text('nickname'),
	birthDate: date('birth_date'),
	kind: text('kind').notNull().default('other'),                // 'child' | 'partner' | 'parent' | 'sibling' | 'in_law' | 'extended_family' | 'friend' | 'colleague' | 'self' | 'other'
	avatarEmoji: text('avatar_emoji'),
	photoUrl: text('photo_url'),                                  // Cloudinary-URL — vises i stedet for emoji når satt
	notes: text('notes'),
	spondGroupIds: text('spond_group_ids').array().notNull().default(sql`ARRAY[]::text[]`),
	emailAddresses: text('email_addresses').array().notNull().default(sql`ARRAY[]::text[]`),
	aliases: text('aliases').array().notNull().default(sql`ARRAY[]::text[]`), // ekstra navn/varianter for navne-match
	archived: boolean('archived').notNull().default(false),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
	idxUserKind: index('persons_user_kind_idx').on(table.userId, table.kind),
	idxUserActive: index('persons_user_active_idx').on(table.userId, table.archived)
}));

// Relasjoner mellom personer (eller mellom self og person når fromPersonId er null).
// NB: kalles `personRelations` i koden for å ikke kollidere med drizzle-orm sin `relations()`-helper.
export const personRelations = pgTable('person_relations', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
	fromPersonId: uuid('from_person_id').references((): AnyPgColumn => persons.id, { onDelete: 'cascade' }), // null = self
	toPersonId: uuid('to_person_id').references((): AnyPgColumn => persons.id, { onDelete: 'cascade' }).notNull(),
	relationType: text('relation_type').notNull(),               // 'family' | 'friend' | 'work'
	subType: text('sub_type'),                                    // 'parent_of' | 'child_of' | 'married_to' | 'sibling_of' | 'in_law_of' | 'friend_of' | 'colleague_of'
	closeness: integer('closeness'),                              // 1-5 (subjektiv nærhet)
	notes: text('notes'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
	uniqRelation: uniqueIndex('person_relations_user_from_to_subtype_unique').on(table.userId, table.fromPersonId, table.toPersonId, table.subType),
	idxFrom: index('person_relations_from_idx').on(table.fromPersonId),
	idxTo: index('person_relations_to_idx').on(table.toPersonId),
	idxUserType: index('person_relations_user_type_idx').on(table.userId, table.relationType)
}));

// Indeks over hvilke personer som er nevnt i en gitt melding (eksplisitt eller utledet).
export const messagePersonMentions = pgTable('message_person_mentions', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
	messageId: uuid('message_id').references(() => messages.id, { onDelete: 'cascade' }).notNull(),
	personId: uuid('person_id').references((): AnyPgColumn => persons.id, { onDelete: 'cascade' }).notNull(),
	confidence: text('confidence').notNull().default('inferred'), // 'explicit' | 'inferred'
	createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => ({
	uniqMention: uniqueIndex('message_person_mentions_msg_person_unique').on(table.messageId, table.personId),
	idxPersonCreated: index('message_person_mentions_person_created_idx').on(table.personId, table.createdAt),
	idxUserCreated: index('message_person_mentions_user_created_idx').on(table.userId, table.createdAt)
}));

// Indeks over hvilke personer som er nevnt i en task.
export const taskPersonMentions = pgTable('task_person_mentions', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
	taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }).notNull(),
	personId: uuid('person_id').references((): AnyPgColumn => persons.id, { onDelete: 'cascade' }).notNull(),
	confidence: text('confidence').notNull().default('inferred'), // 'explicit' | 'inferred'
	createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => ({
	uniqMention: uniqueIndex('task_person_mentions_task_person_unique').on(table.taskId, table.personId),
	idxPersonCreated: index('task_person_mentions_person_created_idx').on(table.personId, table.createdAt)
}));

// Web push subscriptions for PWA notifications
export const webPushSubscriptions = pgTable('web_push_subscriptions', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
	endpoint: text('endpoint').notNull(),
	p256dh: text('p256dh').notNull(),
	auth: text('auth').notNull(),
	userAgent: text('user_agent'),
	disabled: boolean('disabled').default(false).notNull(),
	lastSuccessAt: timestamp('last_success_at'),
	lastFailureAt: timestamp('last_failure_at'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
	uniqueEndpoint: unique().on(table.endpoint),
	idxUserId: index('web_push_subscriptions_user_id_idx').on(table.userId)
}));

// Definisjon av registrerbare typer (global katalog)
export const recordTypeDefinitions = pgTable('record_type_definitions', {
	id: uuid('id').primaryKey().defaultRandom(),
	key: text('key').notNull().unique(), // f.eks. 'micro_yoga', 'screen_time'
	label: text('label').notNull(),
	description: text('description'),
	kind: text('kind').notNull().default('activity'), // 'activity' | 'measurement'
	defaultEventType: text('default_event_type').notNull().default('activity'),
	defaultDataType: text('default_data_type').notNull(),
	defaultParentTheme: text('default_parent_theme'),
	measurementSchema: jsonb('measurement_schema').$type<{
		fields?: Array<{
			key: string;
			label?: string;
			type?: 'number' | 'boolean' | 'string';
			unit?: string;
			required?: boolean;
		}>;
	}>(),
	matchingHints: jsonb('matching_hints').$type<{
		keywords?: string[];
		visualTokens?: string[];
		appNames?: string[];
	}>(),
	dedupePolicy: text('dedupe_policy').notNull().default('none'), // 'none' | 'one_per_day' | 'one_per_hour'
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
});

// Bruker-spesifikk serie for en registreringsflyt (f.eks. daglig mikroyoga)
export const trackingSeries = pgTable('tracking_series', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
	recordTypeId: uuid('record_type_id').references(() => recordTypeDefinitions.id).notNull(),
	themeId: uuid('theme_id').references(() => themes.id, { onDelete: 'set null' }),
	taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
	createdFromConversationId: uuid('created_from_conversation_id').references(() => conversations.id, {
		onDelete: 'set null'
	}),
	title: text('title').notNull(),
	status: text('status').notNull().default('active'), // 'active' | 'paused' | 'archived'
	autoRegister: boolean('auto_register').notNull().default(false),
	confirmationPolicy: text('confirmation_policy').notNull().default('low_confidence_only'), // 'always'|'low_confidence_only'|'never'
	captureHints: jsonb('capture_hints').$type<{
		sources?: string[];
		notes?: string;
	}>(),
	promptHints: text('prompt_hints'),
	signatureProfile: jsonb('signature_profile').$type<{
		layoutPatterns?: string[];
		dominantColors?: string[];
		markerTokens?: string[];
		lastFingerprint?: string;
	}>(),
	lastUsedAt: timestamp('last_used_at'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
	idxUserStatus: index('tracking_series_user_status_idx').on(table.userId, table.status),
	idxRecordType: index('tracking_series_record_type_idx').on(table.recordTypeId)
}));

// Bekreftede vedleggseksempler/signaturer for matching neste gang
export const trackingSeriesExamples = pgTable('tracking_series_examples', {
	id: uuid('id').primaryKey().defaultRandom(),
	trackingSeriesId: uuid('tracking_series_id').references(() => trackingSeries.id, {
		onDelete: 'cascade'
	}).notNull(),
	userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
	attachmentUrl: text('attachment_url').notNull(),
	attachmentKind: text('attachment_kind').notNull().default('image'),
	imageSignature: jsonb('image_signature').$type<{
		version?: number;
		byteHash?: string;
		layoutPattern?: string;
		dominantColors?: string[];
		markerDensity?: 'low' | 'medium' | 'high';
		structuralTokens?: string[];
		sparseSemantics?: boolean;
	}>(),
	parsedPayload: jsonb('parsed_payload').$type<Record<string, unknown>>(),
	confirmed: boolean('confirmed').notNull().default(true),
	createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => ({
	idxSeriesCreated: index('tracking_series_examples_series_created_idx').on(table.trackingSeriesId, table.createdAt)
}));

// Relations
export const usersRelations = relations(users, ({ many }) => ({
	goals: many(goals),
	conversations: many(conversations),
	activities: many(activities),
	memories: many(memories),
	reflections: many(reflections),
	planArtifacts: many(planArtifacts),
	dreams: many(dreams),
	goalTracks: many(goalTracks),
	userWidgets: many(userWidgets),
	themes: many(themes),
	authAccounts: many(authAccounts),
	allowedEmails: many(allowedEmails),
	sentMarriageInvites: many(marriageInvites),
	sensors: many(sensors),
	sensorEvents: many(sensorEvents),
	sensorAggregates: many(sensorAggregates),
	canonicalWorkouts: many(canonicalWorkouts),
	workoutDailyAggregates: many(workoutDailyAggregates),
	checklists: many(checklists),
	webPushSubscriptions: many(webPushSubscriptions),
	backgroundJobs: many(backgroundJobs),
	themeLists: many(themeLists),
	themeFiles: many(themeFiles),
	trackingSeries: many(trackingSeries),
	trackingSeriesExamples: many(trackingSeriesExamples),
	nudgeEvents: many(nudgeEvents),
	apiSecrets: many(userApiSecrets),
	persons: many(persons),
	personRelations: many(personRelations),
	messagePersonMentions: many(messagePersonMentions),
	taskPersonMentions: many(taskPersonMentions)
}));

export const authAccountsRelations = relations(authAccounts, ({ one }) => ({
	user: one(users, {
		fields: [authAccounts.userId],
		references: [users.id]
	})
}));

export const userApiSecretsRelations = relations(userApiSecrets, ({ one }) => ({
	user: one(users, {
		fields: [userApiSecrets.userId],
		references: [users.id]
	})
}));

export const allowedEmailsRelations = relations(allowedEmails, ({ one }) => ({
	invitedByUser: one(users, {
		fields: [allowedEmails.invitedByUserId],
		references: [users.id]
	})
}));

export const marriageInvitesRelations = relations(marriageInvites, ({ one }) => ({
	inviterUser: one(users, {
		fields: [marriageInvites.inviterUserId],
		references: [users.id]
	}),
	inviteeUser: one(users, {
		fields: [marriageInvites.inviteeUserId],
		references: [users.id]
	})
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
	memories: many(memories),
	reflections: many(reflections),
	planArtifacts: many(planArtifacts),
	lists: many(themeLists),
	files: many(themeFiles),
	trackingSeries: many(trackingSeries),
	books: many(books)
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
	person: one(persons, {
		fields: [goals.personId],
		references: [persons.id]
	}),
	parentGoal: one(goals, {
		fields: [goals.parentGoalId],
		references: [goals.id],
		relationName: 'goal_hierarchy'
	}),
	childGoals: many(goals, { relationName: 'goal_hierarchy' }),
	tasks: many(tasks)
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
	goal: one(goals, {
		fields: [tasks.goalId],
		references: [goals.id]
	}),
	project: one(projects, {
		fields: [tasks.projectId],
		references: [projects.id]
	}),
	person: one(persons, {
		fields: [tasks.personId],
		references: [persons.id]
	}),
	progress: many(progress),
	trackingSeries: many(trackingSeries),
	personMentions: many(taskPersonMentions)
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
	user: one(users, {
		fields: [projects.userId],
		references: [users.id]
	}),
	theme: one(themes, {
		fields: [projects.themeId],
		references: [themes.id]
	}),
	tasks: many(tasks),
	checklistItems: many(checklistItems),
	categorizedEvents: many(categorizedEvents)
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
	theme: one(themes, {
		fields: [conversations.themeId],
		references: [themes.id]
	}),
	person: one(persons, {
		fields: [conversations.personId],
		references: [persons.id]
	}),
	messages: many(messages),
	trackingSeries: many(trackingSeries)
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
	conversation: one(conversations, {
		fields: [messages.conversationId],
		references: [conversations.id]
	}),
	personMentions: many(messagePersonMentions)
}));

export const memoriesRelations = relations(memories, ({ one }) => ({
	user: one(users, {
		fields: [memories.userId],
		references: [users.id]
	}),
	theme: one(themes, {
		fields: [memories.themeId],
		references: [themes.id]
	}),
	person: one(persons, {
		fields: [memories.personId],
		references: [persons.id]
	})
}));

export const reflectionsRelations = relations(reflections, ({ one }) => ({
	user: one(users, { fields: [reflections.userId], references: [users.id] }),
	theme: one(themes, { fields: [reflections.themeId], references: [themes.id] }),
	person: one(persons, { fields: [reflections.personId], references: [persons.id] })
}));

export const planArtifactsRelations = relations(planArtifacts, ({ one }) => ({
	user: one(users, { fields: [planArtifacts.userId], references: [users.id] }),
	theme: one(themes, { fields: [planArtifacts.themeId], references: [themes.id] })
}));

export const dreamsRelations = relations(dreams, ({ one }) => ({
	user: one(users, { fields: [dreams.userId], references: [users.id] })
}));

export const goalTracksRelations = relations(goalTracks, ({ one }) => ({
	user: one(users, { fields: [goalTracks.userId], references: [users.id] })
}));

// Persons + relations + mention relations
export const personsRelations = relations(persons, ({ one, many }) => ({
	user: one(users, {
		fields: [persons.userId],
		references: [users.id]
	}),
	memories: many(memories),
	reflections: many(reflections),
	goals: many(goals),
	tasks: many(tasks),
	conversations: many(conversations),
	sensorEvents: many(sensorEvents),
	outgoingRelations: many(personRelations, { relationName: 'person_relations_from' }),
	incomingRelations: many(personRelations, { relationName: 'person_relations_to' }),
	messageMentions: many(messagePersonMentions),
	taskMentions: many(taskPersonMentions)
}));

export const personRelationsRelations = relations(personRelations, ({ one }) => ({
	user: one(users, {
		fields: [personRelations.userId],
		references: [users.id]
	}),
	fromPerson: one(persons, {
		fields: [personRelations.fromPersonId],
		references: [persons.id],
		relationName: 'person_relations_from'
	}),
	toPerson: one(persons, {
		fields: [personRelations.toPersonId],
		references: [persons.id],
		relationName: 'person_relations_to'
	})
}));

export const messagePersonMentionsRelations = relations(messagePersonMentions, ({ one }) => ({
	user: one(users, {
		fields: [messagePersonMentions.userId],
		references: [users.id]
	}),
	message: one(messages, {
		fields: [messagePersonMentions.messageId],
		references: [messages.id]
	}),
	person: one(persons, {
		fields: [messagePersonMentions.personId],
		references: [persons.id]
	})
}));

export const taskPersonMentionsRelations = relations(taskPersonMentions, ({ one }) => ({
	user: one(users, {
		fields: [taskPersonMentions.userId],
		references: [users.id]
	}),
	task: one(tasks, {
		fields: [taskPersonMentions.taskId],
		references: [tasks.id]
	}),
	person: one(persons, {
		fields: [taskPersonMentions.personId],
		references: [persons.id]
	})
}));

export const webPushSubscriptionsRelations = relations(webPushSubscriptions, ({ one }) => ({
	user: one(users, {
		fields: [webPushSubscriptions.userId],
		references: [users.id]
	})
}));

export const nudgeEventsRelations = relations(nudgeEvents, ({ one }) => ({
	user: one(users, {
		fields: [nudgeEvents.userId],
		references: [users.id]
	}),
	person: one(persons, {
		fields: [nudgeEvents.personId],
		references: [persons.id]
	})
}));

export const signalContractsRelations = relations(signalContracts, ({ many }) => ({
	links: many(themeSignalLinks),
	signals: many(domainSignals)
}));

export const domainSignalsRelations = relations(domainSignals, ({ one }) => ({
	contract: one(signalContracts, {
		fields: [domainSignals.signalType],
		references: [signalContracts.signalType]
	}),
	user: one(users, {
		fields: [domainSignals.userId],
		references: [users.id]
	}),
	relatedUser: one(users, {
		fields: [domainSignals.relatedUserId],
		references: [users.id],
		relationName: 'domain_signals_related_user'
	})
}));

export const themeSignalLinksRelations = relations(themeSignalLinks, ({ one }) => ({
	theme: one(themes, {
		fields: [themeSignalLinks.themeId],
		references: [themes.id]
	}),
	user: one(users, {
		fields: [themeSignalLinks.userId],
		references: [users.id]
	}),
	contract: one(signalContracts, {
		fields: [themeSignalLinks.signalType],
		references: [signalContracts.signalType]
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
	personId: uuid('person_id').references((): AnyPgColumn => persons.id, { onDelete: 'set null' }), // Event tagget med person (f.eks. Spond-event for et bestemt barn)
	eventType: text('event_type').notNull(), // 'measurement', 'activity', 'state_change'
	dataType: text('data_type'), // 'weight', 'sleep', 'activity', 'workout', 'heartrate', etc. (for easier filtering)
	timestamp: timestamp('timestamp').notNull(), // When the event happened (sensor time)
	data: jsonb('data').$type<{
		// Withings measurements
		weight?: number;
		fatMass?: number;
		muscleMass?: number;
		steps?: number;
		distance?: number;
		calories?: number;
		// Sleep data
		sleepDuration?: number;
		sleepDeep?: number;
		sleepLight?: number;
		sleepRem?: number;
		wakeupDuration?: number;
		sleepScore?: number;
		// Heart/breathing data (from sleep or measurements)
		hr_average?: number; // Average heart rate (often from sleep)
		rr_average?: number; // Average respiratory rate
		heartRate?: number; // Spot heart rate measurement
		avgHeartRate?: number; // Workout average heart rate
		maxHeartRate?: number; // Workout max heart rate
		minHeartRate?: number; // Workout min heart rate
		vo2max?: number;
		spo2Average?: number; // Workout average SpO2
		// Activity data (daily steps/activity summary)
		duration?: number;
		intensity?: string;
		intense?: number; // Intense activity minutes
		moderate?: number; // Moderate activity minutes
		// Workout data (specific exercise sessions)
		sportType?: string; // 'running', 'cycling', 'swimming', etc.
		elevation?: number; // Total elevation gain
		elevationMax?: number;
		elevationMin?: number;
		strokes?: number; // Swimming strokes
		poolLaps?: number; // Swimming pool laps
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
}, (table) => ({
	idxUserDataTypeTimestamp: index('sensor_events_user_data_type_timestamp_idx').on(table.userId, table.dataType, table.timestamp),
	idxPersonTimestamp: index('sensor_events_person_timestamp_idx').on(table.personId, table.timestamp),
	// Partial unique index for non-bank events (excludes bank_balance and bank_transaction)
	// Bank transactions use semantic deduplication (accountId+date+desc+amount) instead
	uniqSensorDatatypeTimestamp: uniqueIndex('sensor_events_sensor_datatype_timestamp_unique').on(table.sensorId, table.dataType, table.timestamp).where(sql`data_type NOT IN ('bank_balance', 'bank_transaction')`),
	// Partial unique index for bank_balance events — includes accountId so multiple
	// accounts can share the same sensor + timestamp without violating uniqueness
	uniqBankBalance: uniqueIndex('sensor_events_bank_balance_unique').on(table.sensorId, table.dataType, table.timestamp, sql`(data->>'accountId')`).where(sql`data_type = 'bank_balance'`)
}));

// Raw observed bank-transaction versions from providers (append-only evidence stream).
export const rawBankTransactionVersions = pgTable('raw_bank_transaction_versions', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id).notNull(),
	sensorId: uuid('sensor_id').references(() => sensors.id).notNull(),
	accountId: text('account_id').notNull(),
	externalTransactionId: text('external_transaction_id'),
	bookingStatus: text('booking_status'),
	statusRank: integer('status_rank').notNull().default(0),
	transactionDate: date('transaction_date').notNull(),
	postedAt: timestamp('posted_at').notNull(),
	amount: decimal('amount').notNull(),
	currency: text('currency').notNull().default('NOK'),
	descriptionRaw: text('description_raw'),
	descriptionNormalized: text('description_normalized').notNull(),
	merchantKey: text('merchant_key').notNull(),
	typeText: text('type_text'),
	payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
	rawFingerprint: text('raw_fingerprint').notNull(),
	firstSeenAt: timestamp('first_seen_at').defaultNow().notNull(),
	lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
	seenCount: integer('seen_count').notNull().default(1),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
	uniqRawFingerprint: uniqueIndex('raw_bank_tx_versions_fingerprint_unique').on(table.rawFingerprint),
	idxRawUserDate: index('raw_bank_tx_versions_user_date_idx').on(table.userId, table.transactionDate),
	idxRawSensorExternalId: index('raw_bank_tx_versions_sensor_external_id_idx').on(table.sensorId, table.externalTransactionId)
}));

// Canonical current view: one logical transaction row used by product queries.
export const canonicalBankTransactions = pgTable('canonical_bank_transactions', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id).notNull(),
	sensorId: uuid('sensor_id').references(() => sensors.id).notNull(),
	accountId: text('account_id').notNull(),
	canonicalDate: date('canonical_date').notNull(),
	amount: decimal('amount').notNull(),
	currency: text('currency').notNull().default('NOK'),
	merchantKey: text('merchant_key').notNull(),
	descriptionDisplay: text('description_display'),
	latestBookingStatus: text('latest_booking_status'),
	statusRank: integer('status_rank').notNull().default(0),
	latestPostedAt: timestamp('latest_posted_at').notNull(),
	firstSeenAt: timestamp('first_seen_at').defaultNow().notNull(),
	lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
	evidenceCount: integer('evidence_count').notNull().default(1),
	isActive: boolean('is_active').notNull().default(true),
	paycheckType: text('paycheck_type').$type<'main' | 'supplementary'>(),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
	uniqCanonicalLogical: uniqueIndex('canonical_bank_tx_logical_unique').on(
		table.sensorId,
		table.accountId,
		table.canonicalDate,
		table.amount,
		table.merchantKey
	),
	idxCanonicalUserDate: index('canonical_bank_tx_user_date_idx').on(table.userId, table.canonicalDate),
	idxCanonicalUserStatusDate: index('canonical_bank_tx_user_status_date_idx').on(table.userId, table.latestBookingStatus, table.canonicalDate)
}));

// Salary profile derived from historical paycheck detection.
// One active row per user; deactivated (active=false) when employer changes.
export const userSalaryProfiles = pgTable('user_salary_profiles', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id).notNull(),
	sourceAccountId: text('source_account_id').notNull(),
	// Normalised payer text (first 3 significant words, digits stripped)
	descriptionFingerprint: text('description_fingerprint').notNull(),
	amountMin: decimal('amount_min').notNull(),
	amountMax: decimal('amount_max').notNull(),
	typicalDom: integer('typical_dom').notNull(),
	typicalDow: integer('typical_dow').notNull(),
	active: boolean('active').notNull().default(true),
	derivedAt: timestamp('derived_at').defaultNow().notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
	idxSalaryProfilesUser: index('idx_salary_profiles_user').on(table.userId, table.active)
}));

// Alias map from provider transaction id to canonical row.
export const canonicalBankTransactionAliases = pgTable('canonical_bank_transaction_aliases', {
	id: uuid('id').primaryKey().defaultRandom(),
	canonicalId: uuid('canonical_id').references(() => canonicalBankTransactions.id, { onDelete: 'cascade' }).notNull(),
	sensorId: uuid('sensor_id').references(() => sensors.id).notNull(),
	externalTransactionId: text('external_transaction_id').notNull(),
	firstSeenAt: timestamp('first_seen_at').defaultNow().notNull(),
	lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
	seenCount: integer('seen_count').notNull().default(1),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
	uniqCanonicalAlias: uniqueIndex('canonical_bank_tx_alias_sensor_external_unique').on(table.sensorId, table.externalTransactionId),
	idxCanonicalAliasCanonical: index('canonical_bank_tx_alias_canonical_idx').on(table.canonicalId)
}));

// Materialized transaction projection used by chat/widgets/dashboard queries.
export const categorizedEvents = pgTable('categorized_events', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id).notNull(),
	sensorEventId: uuid('sensor_event_id').references(() => sensorEvents.id).notNull(),
	projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }), // Knytt transaksjon til prosjekt for kost-vs-budsjett
	timestamp: timestamp('timestamp').notNull(),
	accountId: text('account_id'),
	amount: decimal('amount').notNull(),
	description: text('description'),
	typeText: text('type_text'),
	resolvedCategory: text('resolved_category').notNull(),
	resolvedSubcategory: text('resolved_subcategory'),
	resolvedLabel: text('resolved_label'),
	resolvedEmoji: text('resolved_emoji'),
	isFixed: boolean('is_fixed').notNull().default(false),
	source: text('source').notNull().default('pipeline'),
	classifierVersion: integer('classifier_version').notNull().default(1),
	categorizedAt: timestamp('categorized_at').defaultNow().notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
	uniqueSensorEvent: unique().on(table.sensorEventId),
	idxUserTimestamp: index('categorized_events_user_timestamp_idx').on(table.userId, table.timestamp),
	idxUserCategoryTimestamp: index('categorized_events_user_category_timestamp_idx').on(table.userId, table.resolvedCategory, table.timestamp),
	idxUserAccountTimestamp: index('categorized_events_user_account_timestamp_idx').on(table.userId, table.accountId, table.timestamp),
	idxUserProjectTimestamp: index('categorized_events_user_project_timestamp_idx').on(table.userId, table.projectId, table.timestamp)
}));

// Bøker knyttet til et litteratur-tema
export const books = pgTable('books', {
	id: uuid('id').primaryKey().defaultRandom(),
	themeId: uuid('theme_id').references(() => themes.id, { onDelete: 'cascade' }).notNull(),
	userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
	title: text('title').notNull(),
	author: text('author'),
	coverUrl: text('cover_url'),
	format: text('format').notNull().default('print'), // 'print'|'audio'|'both'
	totalPages: integer('total_pages'),
	currentPage: integer('current_page').notNull().default(0),
	totalMinutes: integer('total_minutes'), // Total lydboklengde i minutter
	currentMinutes: integer('current_minutes').notNull().default(0), // Nåværende lydboktid i minutter
	status: text('status').notNull().default('not_started'), // 'not_started'|'reading'|'completed'|'paused'
	conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
	contextStatus: text('context_status').notNull().default('none'), // 'none'|'pending'|'partial'|'ready'
	contextPack: jsonb('context_pack').$type<{
		metadata?: { year?: number; genre?: string };
		authorContext?: { bio?: string; themes?: string[]; howBookFits?: string };
		themes?: string[];
		reception?: { critics?: string; readers?: string; patterns?: string[] };
		relatedWorks?: string[];
		conversationHints?: string[];
	} | null>(),
	startedAt: timestamp('started_at'),
	finishedAt: timestamp('finished_at'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
	idxBooksThemeId: index('books_theme_id_idx').on(table.themeId),
	idxBooksUserId: index('books_user_id_idx').on(table.userId)
}));

// Klipp/sitater fra bøker — passasjer, refleksjoner, lydbokmomenter
export const bookClips = pgTable('book_clips', {
	id: uuid('id').primaryKey().defaultRandom(),
	bookId: uuid('book_id').references(() => books.id, { onDelete: 'cascade' }).notNull(),
	userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
	text: text('text').notNull(), // Sitert passasje eller notat
	page: integer('page'), // Sidetall (valgfritt)
	position: text('position'), // Tidsstempel for lydbøker (f.eks. "1:24:35")
	note: text('note'), // Brukerens refleksjon
	source: text('source'), // 'manual'|'screenshot'|'audio_clip'
	audioUrl: text('audio_url'), // URL til lydklipp (hvis fra skjermopptak)
	// Word-level timestamps from Whisper: [{word, start, end}]
	words: jsonb('words').$type<Array<{ word: string; start: number; end: number }>>(),
	// People/characters mentioned in this clip
	characters: text('characters').array(),
	createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => ({
	idxBookClipsBookId: index('book_clips_book_id_idx').on(table.bookId)
}));

// Fremdriftslogg — én rad per lagring, brukes til graf og prediksjon
export const bookProgressLog = pgTable('book_progress_log', {
	id: uuid('id').primaryKey().defaultRandom(),
	bookId: uuid('book_id').references(() => books.id, { onDelete: 'cascade' }).notNull(),
	userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
	currentPage: integer('current_page'),
	currentMinutes: integer('current_minutes'),
	loggedAt: timestamp('logged_at').defaultNow().notNull()
}, (table) => ({
	idxProgressLogBookId: index('book_progress_log_book_id_idx').on(table.bookId),
	idxProgressLogLoggedAt: index('book_progress_log_logged_at_idx').on(table.loggedAt)
}));

export const booksRelations = relations(books, ({ one, many }) => ({
	theme: one(themes, {
		fields: [books.themeId],
		references: [themes.id]
	}),
	user: one(users, {
		fields: [books.userId],
		references: [users.id]
	}),
	conversation: one(conversations, {
		fields: [books.conversationId],
		references: [conversations.id]
	}),
	clips: many(bookClips),
	progressLog: many(bookProgressLog)
}));

export const bookProgressLogRelations = relations(bookProgressLog, ({ one }) => ({
	book: one(books, {
		fields: [bookProgressLog.bookId],
		references: [books.id]
	}),
	user: one(users, {
		fields: [bookProgressLog.userId],
		references: [users.id]
	})
}));

export const bookClipsRelations = relations(bookClips, ({ one }) => ({
	book: one(books, {
		fields: [bookClips.bookId],
		references: [books.id]
	}),
	user: one(users, {
		fields: [bookClips.userId],
		references: [users.id]
	})
}));

// Generic background job queue for long-running operations (sync, transcription, imports, etc.)
export const backgroundJobs = pgTable('background_jobs', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id),
	type: text('type').notNull(),
	status: text('status').notNull().default('queued'), // queued|running|retry|completed|failed|canceled
	payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
	result: jsonb('result').$type<Record<string, unknown> | null>(),
	error: text('error'),
	attempts: integer('attempts').notNull().default(0),
	maxAttempts: integer('max_attempts').notNull().default(3),
	priority: integer('priority').notNull().default(0),
	runAt: timestamp('run_at').notNull().defaultNow(),
	lockedAt: timestamp('locked_at'),
	lockedBy: text('locked_by'),
	startedAt: timestamp('started_at'),
	finishedAt: timestamp('finished_at'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
	idxBackgroundJobsDue: index('background_jobs_due_idx').on(table.status, table.runAt, table.priority, table.createdAt),
	idxBackgroundJobsUserCreated: index('background_jobs_user_created_idx').on(table.userId, table.createdAt)
}));

// Pre-aggregated data for performance (weekly, monthly, yearly)
export const sensorAggregates = pgTable('sensor_aggregates', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id).notNull(),
	period: text('period').notNull(), // 'week', 'month', 'year'
	periodKey: text('period_key').notNull(), // '2025W43', '2025M10', '2025'
	year: integer('year').notNull(), // For easy filtering
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
}, (table) => ({
	// Unique constraint for upsert operations
	uniquePeriod: unique().on(table.userId, table.period, table.periodKey)
}));

// Canonical deduplicated workouts (materialized projection from sensor_events)
export const canonicalWorkouts = pgTable('canonical_workouts', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id).notNull(),
	startTime: timestamp('start_time').notNull(),
	sportType: text('sport_type').notNull(),
	sportFamily: text('sport_family').notNull(),
	distanceMeters: decimal('distance_meters'),
	durationSeconds: decimal('duration_seconds'),
	avgHeartRate: decimal('avg_heart_rate'),
	maxHeartRate: decimal('max_heart_rate'),
	sourceCount: integer('source_count').notNull().default(1),
	sourceProviders: text('source_providers').array().notNull().default(sql`ARRAY[]::text[]`),
	evidence: jsonb('evidence').$type<
		Array<{
			eventId: string;
			sensorId: string;
			provider: string;
			sensorType: string;
			timestamp: string;
		}>
	>(),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
	idxCanonicalWorkoutsUserStart: index('canonical_workouts_user_start_idx').on(table.userId, table.startTime),
	idxCanonicalWorkoutsUserSportStart: index('canonical_workouts_user_sport_start_idx').on(table.userId, table.sportFamily, table.startTime),
	uniqCanonicalWorkout: unique().on(table.userId, table.startTime, table.sportFamily)
}));

// Daily aggregates derived from canonical_workouts (fast sums/counts/averages)
export const workoutDailyAggregates = pgTable('workout_daily_aggregates', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id).notNull(),
	date: timestamp('date').notNull(),
	sportFamily: text('sport_family').notNull(),
	count: integer('count').notNull().default(0),
	distanceMetersSum: decimal('distance_meters_sum').notNull().default('0'),
	durationSecondsSum: decimal('duration_seconds_sum').notNull().default('0'),
	avgHeartRateAvg: decimal('avg_heart_rate_avg'),
	maxHeartRateMax: decimal('max_heart_rate_max'),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => ({
	idxWorkoutDailyUserDate: index('workout_daily_aggregates_user_date_idx').on(table.userId, table.date),
	idxWorkoutDailyUserSportDate: index('workout_daily_aggregates_user_sport_date_idx').on(table.userId, table.sportFamily, table.date),
	uniqWorkoutDaily: unique().on(table.userId, table.date, table.sportFamily)
}));

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

/**
 * Per-user merchant → category mappings generated by the spending analyzer.
 * Once populated, these override the rule-based categorizer for that user.
 */
export const merchantMappings = pgTable('merchant_mappings', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id).notNull(),
	/** Normalized description key (lowercase, trimmed) */
	merchantKey: text('merchant_key').notNull(),
	/** Top-level category id matching CategoryId */
	category: text('category').notNull(),
	/** Sub-category e.g. 'huslån', 'barnehage', 'aks', 'kollektivtransport' */
	subcategory: text('subcategory'),
	/** Human-readable label e.g. "Ruter – kollektivtransport" */
	label: text('label').notNull(),
	emoji: text('emoji'),
	isFixed: boolean('is_fixed').notNull().default(false),
	/** How many transactions matched this merchant in history */
	txCount: integer('tx_count').notNull().default(0),
	avgMonthlyAmount: decimal('avg_monthly_amount'),
	/** How many different months this merchant appeared in */
	monthsActive: integer('months_active').notNull().default(0),
	/** 'ai' = LLM classified, 'rule' = from RULES fallback, 'manual' = user override */
	source: text('source').notNull().default('ai'),
	analyzedAt: timestamp('analyzed_at').defaultNow().notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
	uniqueUserMerchant: unique().on(table.userId, table.merchantKey),
	idxUserId: index('merchant_mappings_user_id_idx').on(table.userId)
}));

/**
 * Per-user manual overrides that should take precedence over heuristic classification.
 * Used for both transaction and task-domain categorization.
 */
export const classificationOverrides = pgTable('classification_overrides', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id).notNull(),
	/** Domain for the override: 'transaction' | 'task' */
	domain: text('domain').notNull(),
	/** Stable normalized key for input sample (e.g. merchant/signature or activity signature) */
	fingerprint: text('fingerprint').notNull(),
	/** User-corrected category to enforce for the matching fingerprint */
	correctedCategory: text('corrected_category').notNull(),
	/** Optional subcategory override (e.g. 'skatt' under 'diverse') */
	correctedSubcategory: text('corrected_subcategory'),
	/** How many times this override has been confirmed by the user */
	weight: integer('weight').notNull().default(1),
	/** optional source descriptor ('manual_ui', etc.) */
	source: text('source').notNull().default('manual_ui'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
	uniqueUserDomainFingerprint: unique().on(table.userId, table.domain, table.fingerprint),
	idxUserDomain: index('classification_overrides_user_domain_idx').on(table.userId, table.domain)
}));

/**
 * Task classification rules - global keyword-based matching rules for activity → task category mapping.
 * Replaces hardcoded TASK_MATCH_RULES array from activities.ts
 */
export const taskClassificationRules = pgTable('task_classification_rules', {
	id: uuid('id').primaryKey().defaultRandom(),
	/** Category identifier (e.g. 'workout', 'relationship', 'mental') */
	category: text('category').notNull(),
	/** Keywords to match against (e.g. ['trening', 'løp', 'km', 'workout']) */
	keywords: text('keywords').array().notNull(),
	/** Priority/weight for matching (default: 2 per keyword match) */
	priority: integer('priority').notNull().default(2),
	/** Whether this rule is active */
	active: boolean('active').notNull().default(true),
	/** Optional description for admin UI */
	description: text('description'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
	idxCategory: index('task_classification_rules_category_idx').on(table.category),
	idxActive: index('task_classification_rules_active_idx').on(table.active)
}));

/**
 * Transaction matching rules - global keyword-based matching rules for transaction categorization.
 * Replaces hardcoded RULES array from transaction-categories.ts
 */
export const transactionMatchingRules = pgTable('transaction_matching_rules', {
	id: uuid('id').primaryKey().defaultRandom(),
	/** Category identifier (e.g. 'faste_boutgifter', 'dagligvarer', 'kafe_og_restaurant') */
	category: text('category').notNull(),
	/** Keywords to match against transaction description/typeText */
	keywords: text('keywords').array().notNull(),
	/** Whether this category should be marked as fixed expense (overrides category defaultFixed) */
	fixed: boolean('fixed'),
	/** Whether this rule is active */
	active: boolean('active').notNull().default(true),
	/** Optional description for admin UI */
	description: text('description'),
	/** Display order (lower = higher priority in UI) */
	displayOrder: integer('display_order').notNull().default(0),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
	idxCategory: index('transaction_matching_rules_category_idx').on(table.category),
	idxActive: index('transaction_matching_rules_active_idx').on(table.active)
}));

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
	}),
	person: one(persons, {
		fields: [sensorEvents.personId],
		references: [persons.id]
	})
}));

export const categorizedEventsRelations = relations(categorizedEvents, ({ one }) => ({
	user: one(users, {
		fields: [categorizedEvents.userId],
		references: [users.id]
	}),
	sensorEvent: one(sensorEvents, {
		fields: [categorizedEvents.sensorEventId],
		references: [sensorEvents.id]
	}),
	project: one(projects, {
		fields: [categorizedEvents.projectId],
		references: [projects.id]
	})
}));

export const backgroundJobsRelations = relations(backgroundJobs, ({ one }) => ({
	user: one(users, {
		fields: [backgroundJobs.userId],
		references: [users.id]
	})
}));

export const sensorAggregatesRelations = relations(sensorAggregates, ({ one }) => ({
	user: one(users, {
		fields: [sensorAggregates.userId],
		references: [users.id]
	})
}));

export const canonicalWorkoutsRelations = relations(canonicalWorkouts, ({ one }) => ({
	user: one(users, {
		fields: [canonicalWorkouts.userId],
		references: [users.id]
	})
}));

export const workoutDailyAggregatesRelations = relations(workoutDailyAggregates, ({ one }) => ({
	user: one(users, {
		fields: [workoutDailyAggregates.userId],
		references: [users.id]
	})
}));

export const sensorGoalsRelations = relations(sensorGoals, ({ one }) => ({
	goal: one(goals, {
		fields: [sensorGoals.goalId],
		references: [goals.id]
	})
}));

export const recordTypeDefinitionsRelations = relations(recordTypeDefinitions, ({ many }) => ({
	series: many(trackingSeries)
}));

export const trackingSeriesRelations = relations(trackingSeries, ({ one, many }) => ({
	user: one(users, {
		fields: [trackingSeries.userId],
		references: [users.id]
	}),
	recordType: one(recordTypeDefinitions, {
		fields: [trackingSeries.recordTypeId],
		references: [recordTypeDefinitions.id]
	}),
	theme: one(themes, {
		fields: [trackingSeries.themeId],
		references: [themes.id]
	}),
	task: one(tasks, {
		fields: [trackingSeries.taskId],
		references: [tasks.id]
	}),
	createdFromConversation: one(conversations, {
		fields: [trackingSeries.createdFromConversationId],
		references: [conversations.id]
	}),
	examples: many(trackingSeriesExamples)
}));

export const trackingSeriesExamplesRelations = relations(trackingSeriesExamples, ({ one }) => ({
	series: one(trackingSeries, {
		fields: [trackingSeriesExamples.trackingSeriesId],
		references: [trackingSeries.id]
	}),
	user: one(users, {
		fields: [trackingSeriesExamples.userId],
		references: [users.id]
	})
}));

// Checklist relations
export const checklistsRelations = relations(checklists, ({ one, many }) => ({
	user: one(users, {
		fields: [checklists.userId],
		references: [users.id]
	}),
	items: many(checklistItems)
}));

export const checklistItemsRelations = relations(checklistItems, ({ one, many }) => ({
	checklist: one(checklists, {
		fields: [checklistItems.checklistId],
		references: [checklists.id]
	}),
	user: one(users, {
		fields: [checklistItems.userId],
		references: [users.id]
	}),
	project: one(projects, {
		fields: [checklistItems.projectId],
		references: [projects.id]
	}),
	parent: one(checklistItems, {
		fields: [checklistItems.parentId],
		references: [checklistItems.id]
	}),
	children: many(checklistItems)
}));

// ThemeList relations
export const themeListsRelations = relations(themeLists, ({ one, many }) => ({
	theme: one(themes, {
		fields: [themeLists.themeId],
		references: [themes.id]
	}),
	user: one(users, {
		fields: [themeLists.userId],
		references: [users.id]
	}),
	items: many(themeListItems)
}));

export const themeListItemsRelations = relations(themeListItems, ({ one }) => ({
	list: one(themeLists, {
		fields: [themeListItems.listId],
		references: [themeLists.id]
	}),
	user: one(users, {
		fields: [themeListItems.userId],
		references: [users.id]
	})
}));

export const themeFilesRelations = relations(themeFiles, ({ one }) => ({
	theme: one(themes, {
		fields: [themeFiles.themeId],
		references: [themes.id]
	}),
	user: one(users, {
		fields: [themeFiles.userId],
		references: [users.id]
	})
}));

// Dynamisk metrikkregister — innebygde metrikker er code-first (se MetricDefinitionService).
// Tabellen brukes kun for bruker-definerte overstyringer og fremtidige tillegg.
export const metricDefinitions = pgTable('metric_definitions', {
	id: uuid('id').primaryKey().defaultRandom(),
	key: text('key').notNull().unique(),           // 'spending_bil_og_transport_drivstoff'
	domain: text('domain').notNull(),              // 'health' | 'spending' | 'income'
	label: text('label').notNull(),                // 'Drivstoff og elbil-lading'
	description: text('description'),
	filterCategory: text('filter_category'),       // 'bil_og_transport'
	filterSubcategory: text('filter_subcategory'), // 'drivstoff'
	dataType: text('data_type').notNull(),          // 'bank_transaction' | 'weight' | ...
	defaultAggregation: text('default_aggregation').notNull(), // 'sum' | 'avg' | 'count' | 'latest'
	defaultUnit: text('default_unit').notNull(),   // 'kr' | 'kg' | 'timer'
	defaultColor: text('default_color'),
	direction: text('direction').notNull().default('lower_is_better'),
	searchAliases: text('search_aliases').array().notNull().default(sql`ARRAY[]::text[]`),
	tags: text('tags').array().notNull().default(sql`ARRAY[]::text[]`),
	isBuiltin: boolean('is_builtin').notNull().default(false),
	isActive: boolean('is_active').notNull().default(true),
	userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
	idxDomain: index('metric_definitions_domain_idx').on(table.domain, table.isActive),
	idxUserDomain: index('metric_definitions_user_domain_idx').on(table.userId, table.domain),
}));

// Cache for pre-beregnede aggregerte metrikkverdier (uke/måned/år).
// Brukes av widget-API-et for å unngå live re-beregning fra rådata.
export const metricAggregateCache = pgTable('metric_aggregate_cache', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
	metricKey: text('metric_key').notNull(),        // ref til metric_definitions.key (built-in eller DB)
	period: text('period').notNull(),               // 'week' | 'month' | 'year'
	periodKey: text('period_key').notNull(),        // '2026W18' | '2026M05' | '2026'
	startDate: date('start_date').notNull(),
	endDate: date('end_date').notNull(),
	valueSum: decimal('value_sum'),
	valueAvg: decimal('value_avg'),
	valueMin: decimal('value_min'),
	valueMax: decimal('value_max'),
	valueCount: integer('value_count').notNull().default(0),
	valueLatest: decimal('value_latest'),
	// Forhåndsberegnet sparkline: [{date:'2026-05-01', value:450}, ...]
	dailyBuckets: jsonb('daily_buckets').$type<Array<{ date: string; value: number }>>(),
	// MD5-hash for staleness-sjekk: COUNT(*) || '|' || MAX(updated_at) fra kildedata
	dataHash: text('data_hash'),
	computedAt: timestamp('computed_at').defaultNow().notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
	uniqUserMetricPeriod: unique('metric_cache_unique').on(table.userId, table.metricKey, table.period, table.periodKey),
	idxUserMetricKey: index('metric_cache_user_metric_idx').on(table.userId, table.metricKey),
	idxUserPeriod: index('metric_cache_user_period_idx').on(table.userId, table.period, table.periodKey),
}));

// ============================================
// EMAIL RULES - Configurable email processing
// ============================================

export const emailRules = pgTable('email_rules', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
	name: text('name').notNull(),
	labelPattern: text('label_pattern'), // exact or glob match on Gmail label e.g. 'resonans/oda', 'resonans/*'
	senderPattern: text('sender_pattern'), // glob pattern e.g. '*@oda.com', 'noreply@spond.com'
	subjectPattern: text('subject_pattern'), // substring match e.g. 'Ordrebekreftelse', 'Ukeplan'
	processingType: text('processing_type').notNull(), // 'workout_files', 'ai_extraction', 'raw_store', 'library'
	extractionPrompt: text('extraction_prompt'), // custom prompt for AI extraction (optional)
	eventType: text('event_type').notNull().default('email_content'), // sensor event type to create
	dataType: text('data_type').notNull().default('email'), // sensor event data type
	isActive: boolean('is_active').default(true).notNull(),
	lastMatchedAt: timestamp('last_matched_at'),
	matchCount: integer('match_count').default(0).notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
	idxUserActive: index('email_rules_user_active_idx').on(table.userId, table.isActive),
}));

export const emailRulesRelations = relations(emailRules, ({ one }) => ({
	user: one(users, {
		fields: [emailRules.userId],
		references: [users.id]
	})
}));
