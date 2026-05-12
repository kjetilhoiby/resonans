import { json, type RequestHandler } from '@sveltejs/kit';
import { ensureUser } from '$lib/server/users';
import { db } from '$lib/db';
import { tasks } from '$lib/db/schema';
import { findPoolCandidates, markSurfaced } from '$lib/server/pool/query';
import { parseYearlyWindow } from '$lib/server/pool/yearly-window';

function parseEffort(v: unknown): 'low' | 'medium' | 'high' | undefined {
	if (v === 'low' || v === 'medium' || v === 'high') return v;
	return undefined;
}

function parseIsoDate(v: unknown): string | null {
	if (typeof v !== 'string') return null;
	const trimmed = v.trim();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
	return trimmed;
}

export const GET: RequestHandler = async ({ locals, url }) => {
	await ensureUser(locals.userId);
	const userId = locals.userId;

	const availableParam = url.searchParams.get('available');
	const availableMinutes = availableParam ? Number(availableParam) : undefined;
	const effort = parseEffort(url.searchParams.get('effort'));
	const contextTagsRaw = url.searchParams.get('context');
	const contextTags = contextTagsRaw
		? contextTagsRaw.split(',').map((s) => s.trim()).filter(Boolean)
		: undefined;
	const projectId = url.searchParams.get('projectId') || undefined;
	const limitParam = url.searchParams.get('limit');
	const limit = limitParam ? Math.max(1, Math.min(50, Number(limitParam))) : 5;
	const includeStubs = url.searchParams.get('includeStubs') === 'true';
	const needsClarificationOnly = url.searchParams.get('needsClarification') === 'true';

	const candidates = await findPoolCandidates({
		userId,
		availableMinutes: Number.isFinite(availableMinutes) ? availableMinutes : undefined,
		effort,
		contextTags,
		projectId,
		limit,
		includeStubs: includeStubs || typeof availableMinutes !== 'number',
		needsClarificationOnly
	});

	if (typeof availableMinutes === 'number' && candidates.length > 0) {
		await markSurfaced(candidates.map((c) => c.id));
	}

	return json({ tasks: candidates });
};

type BulkAddItem = {
	title?: unknown;
	description?: unknown;
	projectId?: unknown;
	estimatedMinutes?: unknown;
	effort?: unknown;
	dueDate?: unknown;
	availableFrom?: unknown;
	availableTo?: unknown;
	yearlyWindow?: unknown;
	contextTags?: unknown;
	poolPriority?: unknown;
};

export const POST: RequestHandler = async ({ locals, request }) => {
	await ensureUser(locals.userId);
	const userId = locals.userId;

	const body = (await request.json().catch(() => ({}))) as { items?: unknown };
	const items = Array.isArray(body.items) ? (body.items as BulkAddItem[]) : [];
	if (items.length === 0) return json({ error: 'items er påkrevd' }, { status: 400 });

	const created: Array<{ id: string; title: string; needsClarification: boolean }> = [];
	const skipped: Array<{ title: string; reason: string }> = [];

	for (const item of items) {
		const title = typeof item.title === 'string' ? item.title.trim() : '';
		if (!title) {
			skipped.push({ title: '', reason: 'tom tittel' });
			continue;
		}

		const yearlyWindow = typeof item.yearlyWindow === 'string' ? item.yearlyWindow.trim() : null;
		if (yearlyWindow && !parseYearlyWindow(yearlyWindow)) {
			skipped.push({ title, reason: `ugyldig yearlyWindow '${yearlyWindow}'` });
			continue;
		}

		const dueDate = parseIsoDate(item.dueDate);
		const availableFrom = parseIsoDate(item.availableFrom);
		const availableTo = parseIsoDate(item.availableTo);

		if (dueDate && (availableFrom || availableTo)) {
			skipped.push({ title, reason: 'dueDate og available-vindu er gjensidig utelukkende' });
			continue;
		}

		const estimatedMinutes =
			typeof item.estimatedMinutes === 'number' && Number.isFinite(item.estimatedMinutes)
				? Math.round(item.estimatedMinutes)
				: null;
		const effort = parseEffort(item.effort) ?? null;
		const contextTags = Array.isArray(item.contextTags)
			? (item.contextTags as unknown[]).filter((v): v is string => typeof v === 'string' && v.length > 0)
			: null;
		const poolPriority =
			typeof item.poolPriority === 'number' && Number.isFinite(item.poolPriority)
				? Math.round(item.poolPriority)
				: 0;
		const projectId = typeof item.projectId === 'string' && item.projectId ? item.projectId : null;
		const description = typeof item.description === 'string' ? item.description.trim() || null : null;

		const [row] = await db
			.insert(tasks)
			.values({
				userId,
				title,
				description,
				projectId,
				isPool: true,
				dueDate: dueDate ?? null,
				availableFrom: availableFrom ?? null,
				availableTo: availableTo ?? null,
				yearlyWindow: yearlyWindow ?? null,
				estimatedMinutes,
				effort,
				contextTags,
				poolPriority,
				recurrenceYearly: yearlyWindow ? true : false
			})
			.returning({ id: tasks.id, title: tasks.title });

		const needsClarification = estimatedMinutes === null && !dueDate;
		created.push({ id: row.id, title: row.title, needsClarification });
	}

	return json({ created, skipped }, { status: 201 });
};
