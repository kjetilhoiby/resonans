import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { mealPlans, meals, pantryItems, foodSettings } from '$lib/db/schema';
import { and, eq, gte, sql } from 'drizzle-orm';
import { openai } from '$lib/server/openai';
import { addDaysIso, datesForIsoWeek, isoWeekKeyForDate, osloTodayIso } from '$lib/server/iso-week';

// POST /api/food/week-session/ai-suggest — GPT-forslag for hele uka.
// Supplement til den regelbaserte motoren: tar hensyn til hva familien faktisk
// spiste de siste ukene, hva som ligger i lageret, og variasjon på tvers av uka.
// Body: { weekContext?: string, note?: string } (note = fritekst-føring, f.eks.
// «lettvint uke, vi er slitne»).
export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	const body = await request.json().catch(() => ({}));

	const today = osloTodayIso();
	const weekContext: string = body.weekContext ?? isoWeekKeyForDate(addDaysIso(today, 7));
	const days = datesForIsoWeek(weekContext);
	if (days.length === 0) return json({ error: 'Ugyldig weekContext' }, { status: 400 });

	const catalog = await db
		.select({
			id: meals.id,
			title: meals.title,
			tags: meals.tags,
			prepTimeMin: meals.prepTimeMin,
			cookTimeMin: meals.cookTimeMin
		})
		.from(meals)
		.where(eq(meals.userId, userId));

	if (catalog.length === 0) {
		return json({ error: 'Kartoteket er tomt — legg inn noen retter først.' }, { status: 400 });
	}

	// Siste 4 ukers middager (hva familien faktisk spiste)
	const fourWeeksAgo = addDaysIso(today, -28);
	const recent = await db
		.select({ date: mealPlans.date, mealId: mealPlans.mealId })
		.from(mealPlans)
		.where(
			and(
				eq(mealPlans.userId, userId),
				eq(mealPlans.mealType, 'dinner'),
				gte(mealPlans.date, fourWeeksAgo)
			)
		)
		.orderBy(sql`${mealPlans.date} asc`);
	const titleById = new Map(catalog.map((m) => [m.id, m.title]));
	const recentLines = recent
		.map((r) => `${r.date}: ${r.mealId ? titleById.get(r.mealId) ?? '?' : '?'}`)
		.join('\n');

	const pantry = await db
		.select({ name: pantryItems.name, location: pantryItems.location, expiresAt: pantryItems.expiresAt, quantity: pantryItems.quantity })
		.from(pantryItems)
		.where(eq(pantryItems.userId, userId));
	const inStock = pantry
		.filter((p) => !(p.quantity != null && Number(p.quantity) === 0))
		.map((p) => `${p.name} (${p.location}${p.expiresAt ? `, går ut ${p.expiresAt}` : ''})`)
		.join(', ');

	const catalogLines = catalog
		.map((m) => {
			const time = (m.prepTimeMin ?? 0) + (m.cookTimeMin ?? 0);
			return `- ${m.id} | ${m.title}${m.tags.length ? ` [${m.tags.join(', ')}]` : ''}${time ? ` (${time} min)` : ''}`;
		})
		.join('\n');

	// Familiens faste ukerytme/føringer (onboarding) — gjelder alltid, i tillegg
	// til en eventuell engangs-note for denne uka.
	const settings = await db.query.foodSettings.findFirst({
		where: eq(foodSettings.userId, userId)
	});
	const weekRhythmNote = settings?.weekRhythmNote?.trim();

	const systemPrompt = `Du planlegger ukemiddager for en norsk familie: 2 voksne og 3 barn med varierende smak.
Familien vil ha variasjon, bruke det som ligger i lageret (særlig det som går ut på dato), og unngå retter de nylig har spist.
Hverdager bør være enklere/raskere; helg kan være mer ambisiøs. Velg PRIMÆRT fra kartoteket (bruk id).
Foreslå maks 1-2 nye retter utenfor kartoteket i løpet av uka (da med "mealId": null og et beskrivende norsk navn).

Returner KUN gyldig JSON:
{
  "days": [
    { "date": "YYYY-MM-DD", "mealId": "uuid fra kartoteket eller null", "title": "rettens navn", "reason": "kort norsk begrunnelse" }
  ]
}
Én rett per dag, alle 7 dager. Ikke gjenta samme rett i uka.`;

	const userPrompt = [
		`Uke: ${weekContext} (${days[0]} til ${days[6]})`,
		'',
		'KARTOTEK (id | navn [tags] (tid)):',
		catalogLines,
		'',
		'MIDDAGER SISTE 4 UKER:',
		recentLines || '(ingen registrert)',
		'',
		'LAGER:',
		inStock || '(tomt)',
		...(weekRhythmNote ? ['', `FAMILIENS UKERYTME (gjelder alltid): ${weekRhythmNote}`] : []),
		...(body.note ? ['', `FØRING FOR DENNE UKA: ${String(body.note).slice(0, 500)}`] : [])
	].join('\n');

	const completion = await openai.chat.completions.create({
		model: 'gpt-4o-mini',
		messages: [
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: userPrompt }
		],
		response_format: { type: 'json_object' },
		temperature: 0.6,
		max_tokens: 1500
	});

	const raw = completion.choices[0]?.message?.content ?? '{}';
	let parsed: { days?: Array<{ date?: string; mealId?: string | null; title?: string; reason?: string }> };
	try {
		parsed = JSON.parse(raw);
	} catch {
		return json({ error: 'AI-svaret kunne ikke tolkes. Prøv igjen.' }, { status: 502 });
	}

	const validIds = new Set(catalog.map((m) => m.id));
	const byDate = new Map(
		(parsed.days ?? [])
			.filter((d) => d?.date && d?.title)
			.map((d) => [
				d.date!,
				{
					mealId: d.mealId && validIds.has(d.mealId) ? d.mealId : null,
					title: String(d.title).trim(),
					reason: String(d.reason ?? 'AI-forslag').trim()
				}
			])
	);

	return json({
		weekContext,
		days: days.map((date) => ({ date, suggestion: byDate.get(date) ?? null }))
	});
};
