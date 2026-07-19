import { z } from 'zod';
import { db } from '$lib/db';
import { foodSettings } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const manageFoodSettingsTool = {
	name: 'manage_food_settings',
	description: `Familiens matinnstillinger på husholdningsnivå (ikke per barn — bruk manage_lunchbox til barnas preferanser).

Actions:
- get: les gjeldende ukerytme-føringer og ukebudsjett
- set: oppdater weekRhythmNote (fritekst om faste ukemønstre og myke føringer — «fredag er tacodag», «onsdag handler vi Oda», «mandager holder vi det enkelt», «unngå fisk to dager på rad») og/eller groceryBudgetWeekly (kr/uke)

weekRhythmNote leses av middagsforslagene (onsdagsøkta) og oppskriftssøket. Bygg videre på eksisterende tekst i stedet for å overskrive den når brukeren legger til én ting — kall get først.`,

	parameters: z.object({
		userId: z.string(),
		action: z.enum(['get', 'set']),
		weekRhythmNote: z.string().optional().describe('Full ny ukerytme-tekst (erstatter eksisterende)'),
		groceryBudgetWeekly: z.number().nullable().optional().describe('Ukebudsjett i kr, eller null for å fjerne')
	}),

	execute: async (args: {
		userId: string;
		action: 'get' | 'set';
		weekRhythmNote?: string;
		groceryBudgetWeekly?: number | null;
	}) => {
		if (args.action === 'get') {
			const settings = await db.query.foodSettings.findFirst({
				where: eq(foodSettings.userId, args.userId)
			});
			return {
				weekRhythmNote: settings?.weekRhythmNote ?? null,
				groceryBudgetWeekly:
					settings?.groceryBudgetWeekly != null ? Number(settings.groceryBudgetWeekly) : null
			};
		}

		const updates: Record<string, unknown> = { updatedAt: new Date() };
		if (args.weekRhythmNote !== undefined) {
			updates.weekRhythmNote = args.weekRhythmNote.trim().slice(0, 2000) || null;
		}
		if (args.groceryBudgetWeekly !== undefined) {
			updates.groceryBudgetWeekly =
				args.groceryBudgetWeekly != null ? String(args.groceryBudgetWeekly) : null;
		}

		const [updated] = await db
			.update(foodSettings)
			.set(updates)
			.where(eq(foodSettings.userId, args.userId))
			.returning();
		if (updated) {
			return {
				updated: true,
				weekRhythmNote: updated.weekRhythmNote,
				groceryBudgetWeekly:
					updated.groceryBudgetWeekly != null ? Number(updated.groceryBudgetWeekly) : null
			};
		}

		const [created] = await db
			.insert(foodSettings)
			.values({
				userId: args.userId,
				weekRhythmNote: (updates.weekRhythmNote as string | null) ?? null,
				groceryBudgetWeekly: (updates.groceryBudgetWeekly as string | null) ?? null
			})
			.returning();
		return {
			updated: true,
			weekRhythmNote: created.weekRhythmNote,
			groceryBudgetWeekly:
				created.groceryBudgetWeekly != null ? Number(created.groceryBudgetWeekly) : null
		};
	}
};
