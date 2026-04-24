import { fail } from '@sveltejs/kit';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/db';
import { checklistItems, checklists, goals, memories, themes } from '$lib/db/schema';
import { parseListRepeatCount } from '$lib/server/list-repeat-parser';

// ── Month helpers ────────────────────────────────────────────────────────────

type MonthInfo = {
	year: number;
	month: string; // "04"
	dashedKey: string; // "2026-04"
	compactKey: string; // "2026M04"
	contextKey: string; // "month:2026-04"
	startDate: string; // "2026-04-01"
	endDate: string; // "2026-04-30"
	monthName: string; // "april"
};

export type WeekInMonth = {
	year: number;
	week: string; // "17"
	dashedKey: string; // "2026-W17"
	contextKey: string; // "week:2026-W17"
	startDate: string; // "2026-04-20"
	endDate: string; // "2026-04-26"
	daysInMonth: number; // how many days of this week fall within the month
};

function getMonthInfo(now: Date = new Date()): MonthInfo {
	const year = now.getFullYear();
	const month = now.getMonth() + 1;
	const monthStr = String(month).padStart(2, '0');
	const daysInMonth = new Date(year, month, 0).getDate();
	const endDay = String(daysInMonth).padStart(2, '0');
	const monthName = new Intl.DateTimeFormat('nb-NO', { month: 'long' }).format(new Date(year, month - 1, 1));

	return {
		year,
		month: monthStr,
		dashedKey: `${year}-${monthStr}`,
		compactKey: `${year}M${monthStr}`,
		contextKey: `month:${year}-${monthStr}`,
		startDate: `${year}-${monthStr}-01`,
		endDate: `${year}-${monthStr}-${endDay}`,
		monthName
	};
}

function getMonthInfoFromKey(key: string): MonthInfo | null {
	const match = key.match(/^(\d{4})-(\d{2})$/);
	if (!match) return null;
	const year = parseInt(match[1], 10);
	const month = parseInt(match[2], 10);
	if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
	return getMonthInfo(new Date(year, month - 1, 1));
}

function shiftMonth(month: MonthInfo, delta: number): MonthInfo {
	return getMonthInfo(new Date(month.year, parseInt(month.month, 10) - 1 + delta, 1));
}

// ISO week helpers (same algorithm as ukeplan)
function getIsoWeekFromDate(now: Date) {
	const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
	const dayNum = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - dayNum);
	const year = d.getUTCFullYear();
	const yearStart = new Date(Date.UTC(year, 0, 1));
	const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
	const week = String(weekNo).padStart(2, '0');
	const monday = new Date(d);
	monday.setUTCDate(d.getUTCDate() - 3);
	const sunday = new Date(monday);
	sunday.setUTCDate(monday.getUTCDate() + 6);
	return {
		year,
		week,
		dashedKey: `${year}-W${week}`,
		contextKey: `week:${year}-W${week}`,
		startDate: monday.toISOString().slice(0, 10),
		endDate: sunday.toISOString().slice(0, 10)
	};
}

function getWeeksInMonth(month: MonthInfo): WeekInMonth[] {
	const seen = new Map<string, WeekInMonth>();
	const end = new Date(`${month.endDate}T12:00:00.000Z`);
	let current = new Date(`${month.startDate}T12:00:00.000Z`);

	while (current <= end) {
		const w = getIsoWeekFromDate(current);
		if (!seen.has(w.dashedKey)) {
			let daysInMonth = 0;
			const wStart = new Date(`${w.startDate}T12:00:00.000Z`);
			for (let i = 0; i < 7; i++) {
				const d = new Date(wStart);
				d.setUTCDate(wStart.getUTCDate() + i);
				const iso = d.toISOString().slice(0, 10);
				if (iso >= month.startDate && iso <= month.endDate) daysInMonth++;
			}
			seen.set(w.dashedKey, { ...w, daysInMonth });
		}
		current.setUTCDate(current.getUTCDate() + 1);
	}

	return Array.from(seen.values()).sort((a, b) => a.dashedKey.localeCompare(b.dashedKey));
}

async function upsertMonthNote(userId: string, source: string, content: string) {
	const trimmed = content.trim();
	const existing = await db.query.memories.findFirst({
		columns: { id: true },
		where: and(eq(memories.userId, userId), eq(memories.source, source))
	});

	if (!trimmed) {
		if (existing) await db.delete(memories).where(eq(memories.id, existing.id));
		return;
	}

	if (existing) {
		await db
			.update(memories)
			.set({ content: trimmed, updatedAt: new Date(), lastAccessedAt: new Date() })
			.where(eq(memories.id, existing.id));
		return;
	}

	await db.insert(memories).values({
		userId,
		category: 'other',
		content: trimmed,
		importance: 'medium',
		source
	});
}

// ── Load ─────────────────────────────────────────────────────────────────────

export const load: PageServerLoad = async ({ locals, url }) => {
	const userId = locals.userId;
	const requestedMonth = url.searchParams.get('month');
	const month = requestedMonth ? (getMonthInfoFromKey(requestedMonth) ?? getMonthInfo()) : getMonthInfo();
	const previousMonth = shiftMonth(month, -1);
	const nextMonth = shiftMonth(month, 1);
	const weeksInMonth = getWeeksInMonth(month);
	const weekContextKeys = weeksInMonth.map((w) => w.contextKey);

	const [
		monthChecklist,
		monthNote,
		reflectionNote,
		visionNote,
		longTermGoals,
		weekChecklists,
		prevMonthNote,
		prevMonthReflection
	] = await Promise.all([
		db.query.checklists.findFirst({
			where: and(eq(checklists.userId, userId), eq(checklists.context, month.contextKey)),
			with: {
				items: {
					orderBy: (items, { asc: a }) => [a(items.sortOrder), a(items.createdAt)]
				}
			},
			orderBy: (c, { desc: d }) => [d(c.createdAt)]
		}),
		db.query.memories.findFirst({
			columns: { content: true },
			where: and(eq(memories.userId, userId), eq(memories.source, `month-plan:${month.compactKey}:note`))
		}),
		db.query.memories.findFirst({
			columns: { content: true },
			where: and(eq(memories.userId, userId), eq(memories.source, `month-plan:${month.compactKey}:reflection`))
		}),
		db.query.memories.findFirst({
			columns: { content: true },
			where: and(eq(memories.userId, userId), eq(memories.source, `month-plan:${month.compactKey}:vision`))
		}),
		db.query.goals.findMany({
			where: and(eq(goals.userId, userId), eq(goals.status, 'active')),
			columns: { id: true, title: true, targetDate: true, createdAt: true },
			orderBy: (g, { asc: a }) => [a(g.targetDate), a(g.createdAt)],
			limit: 6
		}),
		weekContextKeys.length > 0
			? db.query.checklists.findMany({
					where: and(eq(checklists.userId, userId), inArray(checklists.context, weekContextKeys)),
					with: {
						items: {
							orderBy: (items, { asc: a }) => [a(items.sortOrder), a(items.createdAt)]
						}
					}
			  })
			: Promise.resolve([]),
		db.query.memories.findFirst({
			columns: { content: true },
			where: and(
				eq(memories.userId, userId),
				eq(memories.source, `month-plan:${previousMonth.compactKey}:note`)
			)
		}),
		db.query.memories.findFirst({
			columns: { content: true },
			where: and(
				eq(memories.userId, userId),
				eq(memories.source, `month-plan:${previousMonth.compactKey}:reflection`)
			)
		})
	]);

	const weekChecklistMap = Object.fromEntries(
		weekChecklists.map((cl) => {
			const weekKey = cl.context?.replace('week:', '') ?? cl.id;
			return [
				weekKey,
				{
					id: cl.id,
					title: cl.title,
					completedAt: cl.completedAt?.toISOString() ?? null,
					items: cl.items.map((i) => ({
						id: i.id,
						text: i.text,
						checked: i.checked
					}))
				}
			];
		})
	);

	return {
		month,
		monthNav: {
			previousMonthKey: previousMonth.dashedKey,
			nextMonthKey: nextMonth.dashedKey,
			isCurrentMonth: month.dashedKey === getMonthInfo().dashedKey
		},
		monthChecklist: monthChecklist
			? {
					id: monthChecklist.id,
					title: monthChecklist.title,
					emoji: monthChecklist.emoji,
					completedAt: monthChecklist.completedAt?.toISOString() ?? null,
					items: monthChecklist.items.map((i) => ({
						id: i.id,
						text: i.text,
						checked: i.checked
					}))
			  }
			: null,
		monthNote: monthNote?.content ?? '',
		reflection: reflectionNote?.content ?? '',
		vision: visionNote?.content ?? '',
		weeksInMonth,
		weekChecklists: weekChecklistMap,
		longTermGoals: longTermGoals.map((g) => ({
			id: g.id,
			title: g.title,
			targetDate: g.targetDate?.toISOString() ?? null
		})),
		previousMonthSummary: {
			monthKey: previousMonth.dashedKey,
			monthName: previousMonth.monthName,
			note: prevMonthNote?.content ?? '',
			reflection: prevMonthReflection?.content ?? ''
		}
	};
};

// ── Actions ───────────────────────────────────────────────────────────────────

function resolveMonthFromFormData(formData: FormData) {
	const key = String(formData.get('monthKey') || '').trim();
	return getMonthInfoFromKey(key) ?? getMonthInfo();
}

export const actions = {
	createChecklist: async ({ locals, request }) => {
		const userId = locals.userId;
		const data = await request.formData();
		const month = resolveMonthFromFormData(data);

		const existing = await db.query.checklists.findFirst({
			where: and(eq(checklists.userId, userId), eq(checklists.context, month.contextKey))
		});

		if (!existing) {
			await db.insert(checklists).values({
				userId,
				title: `${month.monthName.charAt(0).toUpperCase() + month.monthName.slice(1)} ${month.year}`,
				emoji: '📅',
				context: month.contextKey
			});
		}

		return { success: true };
	},

	addItem: async ({ request, locals }) => {
		const userId = locals.userId;
		const data = await request.formData();
		const checklistId = String(data.get('checklistId') || '');
		const text = String(data.get('text') || '').trim();

		if (!checklistId || !text) return fail(400, { error: 'Mangler checklistId eller tekst.' });

		const checklist = await db.query.checklists.findFirst({
			where: and(eq(checklists.id, checklistId), eq(checklists.userId, userId))
		});
		if (!checklist) return fail(404, { error: 'Fant ikke listen.' });

		const existingItems = await db.query.checklistItems.findMany({
			where: eq(checklistItems.checklistId, checklistId),
			columns: { id: true }
		});

		const parsed = parseListRepeatCount(text, 1, 12);
		await db.insert(checklistItems).values(
			Array.from({ length: parsed.repeatCount }, (_, i) => ({
				checklistId,
				userId,
				text: parsed.repeatCount > 1 ? `${parsed.label} (${i + 1}/${parsed.repeatCount})` : parsed.label,
				sortOrder: existingItems.length + i
			}))
		);

		if (checklist.completedAt) {
			await db.update(checklists).set({ completedAt: null }).where(eq(checklists.id, checklistId));
		}

		return { success: true };
	},

	toggleItem: async ({ request, locals }) => {
		const userId = locals.userId;
		const data = await request.formData();
		const checklistId = String(data.get('checklistId') || '');
		const itemId = String(data.get('itemId') || '');
		const nextChecked = String(data.get('nextChecked') || 'false') === 'true';

		if (!checklistId || !itemId) return fail(400, { error: 'Mangler itemId eller checklistId.' });

		const item = await db.query.checklistItems.findFirst({
			where: and(eq(checklistItems.id, itemId), eq(checklistItems.userId, userId))
		});
		if (!item) return fail(404, { error: 'Fant ikke punktet.' });

		await db
			.update(checklistItems)
			.set({ checked: nextChecked, checkedAt: nextChecked ? new Date() : null })
			.where(eq(checklistItems.id, itemId));

		if (!nextChecked) {
			await db.update(checklists).set({ completedAt: null }).where(eq(checklists.id, checklistId));
			return { success: true };
		}

		const remaining = await db.query.checklistItems.findMany({
			where: and(eq(checklistItems.checklistId, checklistId), eq(checklistItems.checked, false)),
			columns: { id: true }
		});

		if (remaining.length === 0) {
			await db.update(checklists).set({ completedAt: new Date() }).where(eq(checklists.id, checklistId));
		}

		return { success: true };
	},

	saveMonthNote: async ({ request, locals }) => {
		const userId = locals.userId;
		const data = await request.formData();
		const month = resolveMonthFromFormData(data);
		const note = String(data.get('monthNote') || '');
		await upsertMonthNote(userId, `month-plan:${month.compactKey}:note`, note);
		return { success: true };
	},

	saveNotes: async ({ request, locals }) => {
		const userId = locals.userId;
		const data = await request.formData();
		const month = resolveMonthFromFormData(data);
		const reflection = String(data.get('reflection') || '');
		const vision = String(data.get('vision') || '');

		await Promise.all([
			upsertMonthNote(userId, `month-plan:${month.compactKey}:reflection`, reflection),
			upsertMonthNote(userId, `month-plan:${month.compactKey}:vision`, vision)
		]);

		return { success: true };
	},

	deleteItem: async ({ request, locals }) => {
		const userId = locals.userId;
		const data = await request.formData();
		const itemId = String(data.get('itemId') || '');
		if (!itemId) return fail(400, { error: 'Mangler itemId.' });

		const item = await db.query.checklistItems.findFirst({
			where: and(eq(checklistItems.id, itemId), eq(checklistItems.userId, userId))
		});
		if (!item) return fail(404, { error: 'Fant ikke punktet.' });

		await db.delete(checklistItems).where(eq(checklistItems.id, itemId));
		return { success: true };
	}
} satisfies Actions;
