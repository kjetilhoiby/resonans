import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { checklistItems } from '$lib/db/schema';
import { and, eq, asc } from 'drizzle-orm';
import { openai } from '$lib/server/openai';
import { requireTheme, ensureProjectChecklist, mapTaskItem } from '$lib/server/project-tasks';

interface GeneratedTask {
	text: string;
	estimateMinutes?: number;
	offsetDays?: number;
	dependsOn?: number[];
}

function toISODate(d: Date): string {
	return d.toISOString().slice(0, 10);
}

// Bryter ned et prosjekt (eller en enkeltoppgave) i underoppgaver med estimat,
// foreslåtte frister og avhengigheter via LLM, og setter dem inn som checklist_items.
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	const theme = await requireTheme(userId, params.id);

	const body = await request.json().catch(() => null);
	const parentId = typeof body?.parentId === 'string' ? body.parentId : null;
	const instruction = typeof body?.instruction === 'string' ? body.instruction.trim() : '';

	// Kontekst: prosjektnavn, profil og eksisterende oppgaver.
	const profile = (theme.projectProfile ?? {}) as Record<string, unknown>;
	const existing = await db
		.select({ text: checklistItems.text, parentId: checklistItems.parentId })
		.from(checklistItems)
		.where(eq(checklistItems.themeId, params.id))
		.orderBy(asc(checklistItems.sortOrder));

	let parentText = '';
	if (parentId) {
		const parentItem = await db.query.checklistItems.findFirst({
			where: and(eq(checklistItems.id, parentId), eq(checklistItems.themeId, params.id))
		});
		if (!parentItem) throw error(404, 'Oppgave ikke funnet');
		parentText = parentItem.text;
	}

	const target = parentId
		? `oppgaven «${parentText}»`
		: `prosjektet «${theme.name}»${profile.room ? ` (${profile.room})` : ''}`;

	const existingList = existing.length
		? `Eksisterende oppgaver (ikke dupliser):\n${existing.map((e) => `- ${e.text}`).join('\n')}`
		: 'Ingen oppgaver finnes ennå.';

	const prompt = `Du planlegger ${target} i en personlig hjem-prosjekt-app.
${instruction ? `Brukerens føring: ${instruction}\n` : ''}${existingList}
${profile.startDate ? `Prosjektstart: ${profile.startDate}. ` : ''}${profile.targetDate ? `Ønsket ferdig: ${profile.targetDate}.` : ''}

Bryt ned i 4–8 konkrete, rekkefølge-fornuftige underoppgaver. For hver:
- "text": kort handling på norsk (imperativ, f.eks. "Grav ut og komprimer grunn")
- "estimateMinutes": grovt tidsestimat (60=time, 480=halv dag, 2880=flere dager)
- "offsetDays": antall dager etter prosjektstart oppgaven bør være ferdig (heltall, økende)
- "dependsOn": array med indekser (0-basert) av oppgaver i denne lista som må gjøres først

Svar BARE med gyldig JSON: { "tasks": [ { "text": "...", "estimateMinutes": 120, "offsetDays": 0, "dependsOn": [] } ] }`;

	let generated: GeneratedTask[] = [];
	try {
		const response = await openai.chat.completions.create({
			model: 'gpt-4o',
			messages: [
				{ role: 'system', content: 'Du er en erfaren prosjektplanlegger. Svar alltid med gyldig JSON.' },
				{ role: 'user', content: prompt }
			],
			temperature: 0.4,
			response_format: { type: 'json_object' }
		});
		const parsed = JSON.parse(response.choices[0].message.content || '{}');
		if (Array.isArray(parsed.tasks)) generated = parsed.tasks;
	} catch (err) {
		console.error('[tasks/breakdown]', err);
		throw error(502, 'AI-nedbryting feilet');
	}

	const clean = generated
		.filter((t) => typeof t.text === 'string' && t.text.trim())
		.slice(0, 12);
	if (clean.length === 0) throw error(502, 'AI returnerte ingen oppgaver');

	const checklistId = await ensureProjectChecklist(userId, params.id, theme.name);
	const baseDate = profile.startDate ? new Date(String(profile.startDate)) : new Date();

	// Neste sortOrder blant søsken (under parentId, eller topp-nivå).
	const siblings = existing.filter((e) => (e.parentId ?? null) === parentId);
	let nextOrder = siblings.length;

	// Pass 1: sett inn oppgavene, hold styr på indeks → ny id for avhengigheter.
	const idByIndex: string[] = [];
	for (let i = 0; i < clean.length; i++) {
		const t = clean[i];
		const dueDate =
			typeof t.offsetDays === 'number' && Number.isFinite(t.offsetDays)
				? toISODate(new Date(baseDate.getTime() + t.offsetDays * 86_400_000))
				: null;
		const [created] = await db
			.insert(checklistItems)
			.values({
				checklistId,
				userId,
				themeId: params.id,
				parentId,
				text: t.text.trim(),
				dueDate,
				estimateMinutes: Number.isInteger(t.estimateMinutes) ? t.estimateMinutes! : null,
				sortOrder: nextOrder++,
				metadata: { hasBreakdown: false }
			})
			.returning({ id: checklistItems.id });
		idByIndex[i] = created.id;
	}

	// Pass 2: oversett dependsOn-indekser til blockedBy med ekte ids.
	for (let i = 0; i < clean.length; i++) {
		const deps = clean[i].dependsOn;
		if (!Array.isArray(deps) || deps.length === 0) continue;
		const blockedBy = deps
			.map((idx) => idByIndex[idx])
			.filter((id): id is string => Boolean(id) && id !== idByIndex[i]);
		if (blockedBy.length === 0) continue;
		await db
			.update(checklistItems)
			.set({ metadata: { blockedBy } })
			.where(eq(checklistItems.id, idByIndex[i]));
	}

	// Marker forelderen som nedbrutt.
	if (parentId) {
		await db
			.update(checklistItems)
			.set({ metadata: { hasBreakdown: true, breakdownGeneratedAt: new Date().toISOString() } })
			.where(eq(checklistItems.id, parentId));
	}

	const items = await db
		.select()
		.from(checklistItems)
		.where(eq(checklistItems.themeId, params.id))
		.orderBy(asc(checklistItems.sortOrder), asc(checklistItems.createdAt));

	return json({ items: items.map(mapTaskItem) });
};
