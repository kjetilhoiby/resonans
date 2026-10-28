import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/db';
import { checklists } from '$lib/db/schema';
import { listRoutineDefinitions } from '$lib/server/services/routine-service';
import { addDaysIso, osloTodayIso } from '$lib/server/iso-week';
import { datesInRange } from '$lib/domain/plan-items';
import { computeRoutineStats } from '$lib/domain/routine-stats';

const MAX_PERIOD_DAYS = 90;

/**
 * Rutinene med alle punktene, og — når det finnes — hvor ofte hvert punkt blir
 * gjort. Lesesiden til `manage_routine`. Se docs/mcp.md og routine-stats.ts.
 */
export const queryRoutinesTool = {
	name: 'query_routines',
	description: `Les brukerens rutiner (morgen, kveld, lørdagsvask …) med ALLE punktene: tekst, rekkefølge, estimert tid, ukedager (0=søndag..6=lørdag), slot og om rutinen er aktiv. Med includeCompletionStats også hvor ofte hvert punkt faktisk ble gjort i perioden.

Bruk denne når brukeren vil vurdere, forenkle eller kutte i en rutine («er morgenrutinen realistisk?», «hva bør jeg kutte?»). Endre etterpå med manage_routine action='update' og samme id — ikke lag en ny rutine.

Om gjennomføringen:
- Den måles bare på dager rutinen ble ÅPNET i appen. scheduledDays er dagene den skulle gått, daysOpened de som er målt. En dag som ikke er åpnet er UKJENT, ikke «ikke gjort» — si det, og ikke trekk konklusjoner av få målte dager.
- Per punkt: done, skipped (hoppet over), notDone (åpnet, men ikke gjort) og doneRate (andel av målte dager, null uten målinger).
- estimatedMinutes er summen av punktenes estimater; punkter uten estimat er ikke med.`,
	parameters: z.object({
		userId: z.string(),
		includeInactive: z.boolean().optional().describe('Ta med deaktiverte rutiner. Standard false.'),
		includeCompletionStats: z.boolean().optional().describe('Regn ut gjennomføring per punkt. Standard true.'),
		periodDays: z.number().int().optional().describe(`Antall dager bakover for statistikken, 7–${MAX_PERIOD_DAYS}. Standard 30.`)
	}),
	execute: async (args: {
		userId: string;
		includeInactive?: boolean;
		includeCompletionStats?: boolean;
		periodDays?: number;
	}) => {
		const defs = await listRoutineDefinitions(args.userId, { includeInactive: args.includeInactive === true });
		const periodDays = Math.max(7, Math.min(MAX_PERIOD_DAYS, Math.trunc(args.periodDays ?? 30)));
		const today = osloTodayIso();
		const dates = datesInRange(addDaysIso(today, -(periodDays - 1)), today);
		const withStats = args.includeCompletionStats !== false;

		const contexts = withStats ? defs.flatMap((def) => dates.map((date) => `routine:${def.id}:${date}`)) : [];
		const instances = contexts.length
			? await db.query.checklists.findMany({
					where: and(eq(checklists.userId, args.userId), inArray(checklists.context, contexts)),
					with: { items: { columns: { text: true, checked: true, skippedAt: true, parentId: true } } }
				})
			: [];

		const slotOrder: Record<string, number> = { morning: 0, afternoon: 1, evening: 2, flex: 3 };
		const routines = defs
			.sort((a, b) => (slotOrder[a.slot] ?? 9) - (slotOrder[b.slot] ?? 9) || a.sortOrder - b.sortOrder)
			.map((def) => {
				const estimates = def.items.map((i) => i.estimateMinutes).filter((m): m is number => typeof m === 'number');
				const base = {
					id: def.id,
					title: def.title,
					emoji: def.emoji,
					slot: def.slot,
					daysOfWeek: def.daysOfWeek,
					active: def.active,
					estimatedMinutes: estimates.length ? estimates.reduce((a, b) => a + b, 0) : null,
					itemsWithoutEstimate: def.items.length - estimates.length,
					items: def.items.map((item, index) => ({
						text: item.text,
						sortOrder: item.sortOrder ?? index,
						estimateMinutes: item.estimateMinutes ?? null
					}))
				};
				if (!withStats) return base;
				const prefix = `routine:${def.id}:`;
				const own = instances
					.filter((i) => i.context?.startsWith(prefix))
					.map((i) => ({
						date: i.context!.slice(prefix.length),
						items: i.items
							.filter((it) => !it.parentId)
							.map((it) => ({ text: it.text, checked: it.checked, skipped: !!it.skippedAt }))
					}));
				return { ...base, completion: computeRoutineStats(def, dates, own) };
			});

		return {
			period: withStats ? { from: dates[0], to: today, days: periodDays } : undefined,
			routines
		};
	}
};
