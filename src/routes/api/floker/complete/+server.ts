import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { checklists, checklistItems, projects } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { buildChecklistItemFields } from '$lib/server/checklist-item-builder';
import { addInboxItems } from '$lib/server/inbox';
import { createReflection } from '$lib/server/reflections';

/**
 * Persistering av hodedump-flyten («Tøm hodet»). Alt får en plass:
 *  - rå dump + triage → reflection kind 'hodedump' (append-only, «samtalen er data»)
 *  - valgt floke → aktivt prosjekt med første steg som checklist-items (projectId
 *    kobler dem til /prosjekt/[id]-fremdriften)
 *  - øvrige floker → prosjekter i planning (synlige på /prosjekter)
 *  - «i dag» → dagens dagsplan-sjekkliste (finn-eller-opprett, som /api/day-plan)
 *  - parkert → innboksen (synlig i quick-win-widgeten)
 *  - sluppet → kun i refleksjonen
 */

interface CompleteBody {
	dump?: string;
	placements?: { floker?: string[]; idag?: string[]; parkert?: string[]; sluppet?: string[] };
	valgtFloke?: string | null;
	flokeSteg?: string[];
	refleksjon?: string | null;
}

function getIsoWeekDashedFromIsoDate(isoDate: string): string | null {
	const [yearRaw, monthRaw, dayRaw] = isoDate.split('-');
	const year = Number.parseInt(yearRaw ?? '', 10);
	const month = Number.parseInt(monthRaw ?? '', 10);
	const day = Number.parseInt(dayRaw ?? '', 10);
	if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
	const date = new Date(Date.UTC(year, month - 1, day));
	const dayOfWeek = (date.getUTCDay() + 6) % 7;
	date.setUTCDate(date.getUTCDate() - dayOfWeek + 3);
	const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
	const weekNumber =
		1 +
		Math.round(
			((date.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7
		);
	return `${date.getUTCFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
}

const clean = (arr: unknown): string[] =>
	Array.isArray(arr)
		? arr.filter((t): t is string => typeof t === 'string').map((t) => t.trim()).filter(Boolean)
		: [];

export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = (await request.json()) as CompleteBody;
	const dump = typeof body.dump === 'string' ? body.dump.trim() : '';
	const floker = clean(body.placements?.floker);
	const idag = clean(body.placements?.idag);
	const parkert = clean(body.placements?.parkert);
	const sluppet = clean(body.placements?.sluppet);
	const valgtFloke =
		typeof body.valgtFloke === 'string' && body.valgtFloke.trim() ? body.valgtFloke.trim() : null;
	const flokeSteg = clean(body.flokeSteg);
	const dayIso = new Date().toISOString().slice(0, 10);

	// 1) Floker → prosjekter. Den valgte blir aktiv med steg; resten planning.
	let activeProjectId: string | null = null;
	for (const flokeTitle of floker) {
		const isChosen = valgtFloke !== null && flokeTitle === valgtFloke;
		const [project] = await db
			.insert(projects)
			.values({
				userId,
				title: flokeTitle,
				description: `Floke fra hodedump ${dayIso}`,
				status: isChosen ? 'active' : 'planning',
				startedAt: isChosen ? new Date() : null,
				metadata: { emoji: '🪢', source: 'hodedump', dumpDay: dayIso }
			})
			.returning();
		if (isChosen) activeProjectId = project.id;
	}

	// 2) Første steg for valgt floke → checklist med projectId-koblede items
	if (activeProjectId && flokeSteg.length > 0) {
		const [stepList] = await db
			.insert(checklists)
			.values({
				userId,
				title: valgtFloke ?? 'Floke',
				emoji: '🪢',
				context: `floke:${activeProjectId}`
			})
			.returning();
		await db.insert(checklistItems).values(
			flokeSteg.map((text, i) => ({
				checklistId: stepList.id,
				userId,
				projectId: activeProjectId,
				text,
				sortOrder: i,
				metadata: { source: 'hodedump' }
			}))
		);
	}

	// 3) «I dag» → dagens dagsplan-sjekkliste (samme finn-eller-opprett som /api/day-plan)
	if (idag.length > 0) {
		const weekDashedKey = getIsoWeekDashedFromIsoDate(dayIso);
		if (weekDashedKey) {
			const dayContext = `week:${weekDashedKey}:day:${dayIso}`;
			let dayChecklist = await db.query.checklists.findFirst({
				where: and(eq(checklists.userId, userId), eq(checklists.context, dayContext)),
				with: { items: true }
			});
			if (!dayChecklist) {
				const [created] = await db
					.insert(checklists)
					.values({ userId, title: `Dag ${dayIso}`, emoji: '☑️', context: dayContext })
					.returning();
				dayChecklist = { ...created, items: [] };
			}
			const existingTexts = new Set((dayChecklist.items ?? []).map((i) => i.text.trim().toLowerCase()));
			const toAdd = idag.filter((t) => !existingTexts.has(t.toLowerCase()));
			if (toAdd.length > 0) {
				const nextOrder = (dayChecklist.items ?? []).reduce((m, i) => Math.max(m, i.sortOrder), -1) + 1;
				const built = await Promise.all(
					toAdd.map((text) =>
						buildChecklistItemFields({ userId, context: dayContext, text, allowTaskCreation: false })
					)
				);
				await db.insert(checklistItems).values(
					built.map((fields, i) => ({
						checklistId: dayChecklist!.id,
						userId,
						text: fields.text,
						startDate: fields.startDate,
						sortOrder: nextOrder + i,
						...(Object.keys(fields.metadata).length > 0 ? { metadata: fields.metadata } : {})
					}))
				);
			}
		}
	}

	// 4) Parkert → innboksen (gjenfinnbar plass — hodet kan slippe taket)
	if (parkert.length > 0) {
		await addInboxItems(userId, parkert);
	}

	// 5) Rå dump + triage → append-only refleksjon (samtalen er data)
	const sections: string[] = [`## Dump\n${dump || '(tom)'}`];
	const placementLines: string[] = [];
	for (const t of floker) placementLines.push(`- 🪢 ${t}${t === valgtFloke ? ' (valgt å løsne nå)' : ''}`);
	for (const t of idag) placementLines.push(`- ☑️ ${t} → i dag`);
	for (const t of parkert) placementLines.push(`- 📥 ${t} → innboksen`);
	for (const t of sluppet) placementLines.push(`- 🕊️ ${t} → sluppet`);
	if (placementLines.length > 0) sections.push(`## Plasseringer\n${placementLines.join('\n')}`);
	if (flokeSteg.length > 0) {
		sections.push(`## Første steg («${valgtFloke}»)\n${flokeSteg.map((s) => `- ${s}`).join('\n')}`);
	}
	if (body.refleksjon?.trim()) sections.push(`## Landing\n${body.refleksjon.trim()}`);

	await createReflection({
		userId,
		kind: 'hodedump',
		periodKey: dayIso,
		content: sections.join('\n\n')
	});

	return json({
		ok: true,
		summary: {
			floker: floker.length,
			idag: idag.length,
			parkert: parkert.length,
			sluppet: sluppet.length,
			flokeSteg: flokeSteg.length
		}
	});
};
