import { db } from '$lib/db';
import { userWidgets } from '$lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';

export type WidgetDraft = {
	title: string;
	metricType: 'weight' | 'sleepDuration' | 'steps' | 'distance' | 'workoutCount' | 'heartrate' | 'mood' | 'screenTime' | 'amount';
	aggregation: 'avg' | 'sum' | 'count' | 'latest';
	period: 'day' | 'week' | 'month';
	range: 'last7' | 'last14' | 'last30' | 'current_week' | 'current_month' | 'current_year';
	filterCategory: string | null;
	unit: string;
	goal: number | null;
	color: string;
};

export const proposeWidgetTool = {
	name: 'propose_widget',
	description: `Foreslå en widget til brukeren UTEN å opprette den i databasen.
Brukes ALLTID FØR create_widget. Returnerer et widget-draft som brukeren kan bekrefte, konfigurere eller forkaste.

Bruk når bruker sier ting som:
- "Lag en widget for dagligvareforbruk"
- "Vis meg søvn per dag siste 30 dager"
- "Jeg vil følge med på løpedistansen min"

Aldri opprett widget direkte uten at bruker har sett og bekreftet forslaget.`,

	execute: async (args: {
		userId: string;
		title: string;
		metricType: string;
		aggregation: string;
		period: string;
		range: string;
		filterCategory?: string | null;
		unit: string;
		goal?: number | null;
		color?: string | null;
	}) => {
		const { userId, title, metricType, aggregation, period, range, filterCategory, unit, goal, color } = args;

		// Sjekk om det finnes en tilsvarende widget allerede
		const existing = await db
			.select({ id: userWidgets.id, title: userWidgets.title })
			.from(userWidgets)
			.where(
				and(
					eq(userWidgets.userId, userId),
					eq(userWidgets.metricType, metricType as WidgetDraft['metricType']),
					eq(userWidgets.range, range as WidgetDraft['range']),
					filterCategory
						? eq(userWidgets.filterCategory, filterCategory)
						: sql`filter_category IS NULL`
				)
			)
			.limit(1);

		const draft: WidgetDraft = {
			title: title.trim().slice(0, 80),
			metricType: metricType as WidgetDraft['metricType'],
			aggregation: aggregation as WidgetDraft['aggregation'],
			period: period as WidgetDraft['period'],
			range: range as WidgetDraft['range'],
			filterCategory: filterCategory ?? null,
			unit: unit.slice(0, 20),
			goal: goal ?? null,
			color: color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#7c8ef5',
		};

		const duplicate = existing.length > 0 ? { id: existing[0].id, title: existing[0].title } : null;

		return {
			success: true,
			draft,
			duplicate,
			message: duplicate
				? `En lignende widget "${duplicate.title}" finnes allerede. Vil du opprette en ny også, eller oppdatere den eksisterende?`
				: `Widget-forslag klart: "${draft.title}". Brukeren ser nå et forslagskort og kan bekrefte, konfigurere eller forkaste.`,
		};
	},
};
