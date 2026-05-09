import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { DreamService } from '$lib/server/services/dream-service';

type SynthesisKind = 'daily_dream' | 'weekly_dream' | 'monthly_dream' | 'yearly_dream';

const SYNTHESIS_KINDS: SynthesisKind[] = ['daily_dream', 'weekly_dream', 'monthly_dream', 'yearly_dream'];

export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = (await request.json()) as { kind?: string; key?: string };
	const kind = body.kind as SynthesisKind | undefined;

	if (!kind || !SYNTHESIS_KINDS.includes(kind)) {
		return json({ error: 'Invalid kind' }, { status: 400 });
	}

	let created;
	switch (kind) {
		case 'daily_dream':
			created = await DreamService.runDaily(userId);
			break;
		case 'weekly_dream':
			created = await DreamService.runWeekly(userId, body.key ?? currentIsoWeekKey());
			break;
		case 'monthly_dream':
			created = await DreamService.runMonthly(userId, body.key ?? currentMonthKey());
			break;
		case 'yearly_dream':
			created = await DreamService.runYearly(userId, body.key ?? currentYearKey());
			break;
	}

	return json({ ok: true, dream: created });
};

function currentIsoWeekKey(date = new Date()): string {
	const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
	const day = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - day);
	const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
	const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
	return `${d.getUTCFullYear()}W${String(weekNo).padStart(2, '0')}`;
}

function currentMonthKey(date = new Date()): string {
	return `${date.getFullYear()}M${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function currentYearKey(date = new Date()): string {
	return String(date.getFullYear());
}
