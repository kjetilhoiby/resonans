import { z } from 'zod';
import { upsertMealPlan, deleteMealPlan } from '$lib/server/services/meal-plan-sync';
import { osloTodayIso } from '$lib/server/iso-week';
import { db } from '$lib/db';
import { mealPlans } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { MEAL_PLAN_STATUSES, validateStatusForDate, type MealPlanStatus } from '$lib/domains/food/meal-log';

export const manageMealPlanTool = {
	name: 'manage_meal_plan',
	description: `Legg til, endre eller fjern et måltid på en dato — både PLANEN (hva vi skal spise) og HISTORIKKEN (hva vi faktisk spiste). Det er samme rad; status skiller dem.

status:
- 'planned' (standard): planlagt, ikke spist ennå.
- 'eaten': spist. Bruk ved etterregistrering («på tirsdag hadde vi taco»), og når en plan ble fulgt («vi spiste ramen i går» → update status='eaten'). Ikke lov på framtidige datoer.
- 'skipped': planen ble droppet. Ble den erstattet av noe annet, sett den gamle til 'skipped' og opprett det de faktisk spiste med status='eaten' — da står både planen og historikken riktig.
Skriv ALDRI «Spist» i notes; det er hva status er til. Statusen speiles mot avkryssingen av «middag: …»-punktet i ukeplanen (avkrysset = spist, hoppet over = droppet), begge veier.

Takeaway, restaurant og ferdigmat: sett takeaway=true. Retten tagges da som takeaway, telles i historikken, men foreslås aldri som noe å lage og gir ingen handleliste.

Rett: knytt til et lagret måltid via mealId, eller send mealName — eksakt navn-treff gjenbruker retten, ellers opprettes en ny med bare navnet (oppskrift legges på senere via manage_recipe). Sjekk query_food (meals) først så du ikke lager «Ramen» ved siden av «ramen med egg».

weekContext utledes av date og kan utelates. Endringer speiles til dagens sjekkliste i ukeplanen som «middag: …».`,

	parameters: z.object({
		userId: z.string(),
		action: z.enum(['create', 'update', 'delete']),
		id: z.string().uuid().optional().describe('Planradens id (fra query_food) — påkrevd for update/delete'),
		date: z.string().optional().describe('YYYY-MM-DD — påkrevd for create'),
		mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).optional().describe('Standard dinner ved create'),
		status: z.enum(MEAL_PLAN_STATUSES).optional().describe("'planned' | 'eaten' | 'skipped' — se beskrivelsen"),
		mealId: z.string().uuid().nullable().optional().describe('Kobling til en lagret rett'),
		mealName: z.string().optional().describe('Rettens navn; gjenbruker eksakt treff, ellers opprettes en ny rett'),
		takeaway: z.boolean().optional().describe('true for takeaway/restaurant/ferdigmat'),
		notes: z.string().optional().describe('Fritekst om akkurat denne middagen (f.eks. «doblet porsjonen»), ikke status'),
		servings: z.number().optional(),
		photoUrl: z.string().optional(),
		weekContext: z.string().optional().describe('ISO-uke, f.eks. "2026-W17". Utledes av date hvis utelatt.')
	}),

	execute: async (args: {
		userId: string;
		action: 'create' | 'update' | 'delete';
		id?: string;
		weekContext?: string;
		date?: string;
		mealType?: 'breakfast' | 'lunch' | 'dinner' | 'snack';
		status?: MealPlanStatus;
		mealId?: string | null;
		mealName?: string;
		takeaway?: boolean;
		notes?: string;
		servings?: number;
		photoUrl?: string;
	}) => {
		const today = osloTodayIso();

		if (args.action === 'create') {
			if (!args.date) return { error: 'date (YYYY-MM-DD) er påkrevd for create' };
			if (!args.mealId && !args.mealName?.trim()) {
				return { error: 'Oppgi mealId eller mealName — en middag uten rett kan ikke leses tilbake.' };
			}
			if (args.status) {
				const invalid = validateStatusForDate(args.status, args.date, today);
				if (invalid) return { error: invalid };
			}
			const created = await upsertMealPlan(args.userId, {
				weekContext: args.weekContext,
				date: args.date,
				mealType: args.mealType ?? 'dinner',
				status: args.status,
				mealId: args.mealId,
				mealName: args.mealName,
				takeaway: args.takeaway,
				notes: args.notes,
				servings: args.servings,
				photoUrl: args.photoUrl
			});
			return created ? { mealPlan: created } : { error: 'Kunne ikke opprette planraden' };
		}

		if (args.action === 'update') {
			if (!args.id) return { error: 'id er påkrevd for update' };
			if (args.status === 'eaten') {
				// Datoen kan komme fra raden selv — sjekk mot den som vil gjelde ETTER endringen.
				const existing = await db.query.mealPlans.findFirst({
					where: and(eq(mealPlans.id, args.id), eq(mealPlans.userId, args.userId)),
					columns: { date: true }
				});
				if (!existing) return { error: 'Fant ikke planraden' };
				const invalid = validateStatusForDate('eaten', args.date ?? existing.date, today);
				if (invalid) return { error: invalid };
			}
			const updated = await upsertMealPlan(args.userId, {
				id: args.id,
				weekContext: args.weekContext,
				date: args.date,
				mealType: args.mealType,
				status: args.status,
				mealId: args.mealId,
				mealName: args.mealName,
				takeaway: args.takeaway,
				notes: args.notes,
				servings: args.servings,
				photoUrl: args.photoUrl
			});
			if (!updated) return { error: 'Fant ikke planraden' };
			return { mealPlan: updated };
		}

		if (args.action === 'delete') {
			if (!args.id) return { error: 'id er påkrevd for delete' };
			const deleted = await deleteMealPlan(args.userId, args.id);
			return { deleted };
		}

		return { error: `Ukjent action: ${args.action}` };
	}
};
