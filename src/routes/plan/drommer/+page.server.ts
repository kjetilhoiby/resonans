import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { dreams, goals, memories } from '$lib/db/schema';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { getLatestReflection } from '$lib/server/reflections';
import { read10kBest, readMonthlySavings, readWeightProgress } from '$lib/server/goal-progress';
import { formatLongTermValue } from '$lib/components/domain/plan/helpers.js';

export type LangtidsmaalView = {
	id: string;
	title: string;
	horizon: string;
	metricId: string | null;
	targetLabel: string | null;
	currentLabel: string | null;
	targetYear: number | null;
	pct: number | null;
};

/** Langtidsmål med visionHorizon + målt nåverdi per metrikk (recompute ved lasting). */
async function loadLangtidsmaal(userId: string): Promise<LangtidsmaalView[]> {
	const rows = await db.query.goals.findMany({
		where: and(
			eq(goals.userId, userId),
			eq(goals.status, 'active'),
			sql`${goals.metadata}->>'visionHorizon' IS NOT NULL`
		),
		orderBy: [desc(goals.createdAt)]
	});

	const views: LangtidsmaalView[] = [];
	for (const goal of rows) {
		const meta = goal.metadata as any;
		const metricId: string | null = meta?.metricId ?? null;
		const targetValue: number | null = meta?.goalTrack?.targetValue ?? null;
		const unit: string | null = meta?.goalTrack?.unit ?? null;
		const targetYear = goal.targetDate ? new Date(goal.targetDate).getFullYear() : null;

		let currentLabel: string | null = null;
		let targetLabel: string | null = null;
		let pct: number | null = null;

		try {
			if (metricId === 'weight_change' && typeof meta?.startValue === 'number' && targetValue !== null) {
				const progress = await readWeightProgress(userId, {
					startDate: meta?.startDate ? new Date(meta.startDate) : new Date(goal.createdAt),
					endDate: goal.targetDate ? new Date(goal.targetDate) : new Date(),
					startWeight: meta.startValue,
					targetDelta: targetValue
				});
				if (progress) {
					currentLabel = formatLongTermValue(metricId, progress.currentWeight);
					targetLabel = formatLongTermValue(metricId, progress.targetWeight);
					pct = progress.pct;
				}
			} else if (metricId === 'running_10k_time' && targetValue !== null) {
				const best = await read10kBest(userId);
				targetLabel = formatLongTermValue(metricId, targetValue);
				if (best) currentLabel = formatLongTermValue(metricId, best.bestSeconds);
			} else if (metricId === 'monthly_savings' && targetValue !== null) {
				const savings = await readMonthlySavings(userId);
				targetLabel = `${formatLongTermValue(metricId, targetValue)}/mnd`;
				if (savings) currentLabel = `${formatLongTermValue(metricId, savings.threeMonthAvg)}/mnd (3-mnd-snitt)`;
			} else if (targetValue !== null) {
				targetLabel = formatLongTermValue(metricId, targetValue, unit);
			}
		} catch (err) {
			console.warn('[retning] progressberegning feilet for mål', goal.id, err);
		}

		views.push({
			id: goal.id,
			title: goal.title,
			horizon: meta.visionHorizon,
			metricId,
			targetLabel,
			currentLabel,
			targetYear,
			pct
		});
	}
	return views;
}

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.userId;
	if (!userId) throw redirect(303, '/auth');

	const [all, valueMemories, intervjuTranskript, langtidsmaal] = await Promise.all([
		db.query.dreams.findMany({
			where: eq(dreams.userId, userId),
			orderBy: [desc(dreams.createdAt)],
			limit: 100
		}),
		db.query.memories.findMany({
			where: and(
				eq(memories.userId, userId),
				eq(memories.category, 'values'),
				isNull(memories.supersededBy)
			),
			orderBy: [desc(memories.importance), desc(memories.createdAt)],
			limit: 12
		}),
		// Rå-samtalen er førsteklasses: siste intervju-transkript vises på siden
		getLatestReflection(userId, 'livsintervju_chat'),
		loadLangtidsmaal(userId)
	]);

	// Grupper: nyeste per kind for "aktive", resten i historikk.
	const seen = new Set<string>();
	const active: typeof all = [];
	const historical: typeof all = [];
	for (const dream of all) {
		if (seen.has(dream.kind)) {
			historical.push(dream);
		} else {
			seen.add(dream.kind);
			active.push(dream);
		}
	}

	const visions = active.filter((d) => d.kind.startsWith('vision_'));
	// Retningen: brukerforfattede visjoner er selve siden; LLM-utkast er sekundært.
	const authored = visions.filter((d) => d.originKind === 'user_authored');
	const proposed = visions.filter((d) => d.originKind !== 'user_authored');
	const synthesis = active.filter((d) => d.kind.endsWith('_dream'));
	// Revisjonshistorikk for retningen: eldre brukerforfattede visjoner, nyest først.
	const visionHistory = historical.filter(
		(d) => d.kind.startsWith('vision_') && d.originKind === 'user_authored'
	);
	const synthesisHistory = historical.filter((d) => !visionHistory.includes(d));

	return {
		authored: authored.map(serialize),
		proposed: proposed.map(serialize),
		synthesis: synthesis.map(serialize),
		visionHistory: visionHistory.map(serialize),
		historical: synthesisHistory.map(serialize),
		values: valueMemories.map((m) => ({
			id: m.id,
			content: m.content,
			importance: m.importance,
			createdAt: m.createdAt.toISOString()
		})),
		intervjuTranskript: intervjuTranskript
			? {
					periodKey: intervjuTranskript.periodKey,
					content: intervjuTranskript.content,
					createdAt: intervjuTranskript.createdAt.toISOString()
				}
			: null,
		langtidsmaal
	};
};

function serialize(d: typeof dreams.$inferSelect) {
	return {
		id: d.id,
		kind: d.kind,
		summary: d.summary,
		highlights: d.highlights,
		conversationIds: d.inputs?.conversationIds ?? [],
		scopeStart: d.scopeStart.toISOString(),
		scopeEnd: d.scopeEnd.toISOString(),
		relevanceUntil: d.relevanceUntil?.toISOString() ?? null,
		confidence: d.confidence,
		originKind: d.originKind,
		createdAt: d.createdAt.toISOString()
	};
}
