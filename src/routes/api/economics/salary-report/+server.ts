import { json } from '@sveltejs/kit';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { canonicalBankTransactions, goals, memories, sensorEvents } from '$lib/db/schema';
import { detectGlobalPayday } from '$lib/server/integrations/payday-detector';
import { buildDailyBalances } from '$lib/server/integrations/balance-reconstructor';
import {
	ensureCategorizedEventsForRange,
	queryCategorizedEvents
} from '$lib/server/integrations/categorized-events';
import { METRIC_CATALOG, type MetricId } from '$lib/domain/metric-catalog';
import type { GoalTrack } from '$lib/domain/goal-tracks';
import type { SalaryMonthReport, GoalProgressItem, SalaryInsight } from '$lib/types/salary-report';
import type { RequestHandler } from './$types';

const SALARY_KEYWORDS = ['lønn', 'lonn', 'salary', 'arbeidsgiver', 'folktrygd', 'nav '];

// Metrics that are relevant to economics/spending
const ECONOMIC_METRIC_IDS: MetricId[] = ['grocery_spend'];

export const GET: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;

	// 1. Detect payday dates — accept 1 date, fall back to raw lookup if detector returns null
	let currentSalaryDate: string;
	let prevSalaryDate: string | null = null;
	let sourceAccountId: string | null = null;

	const payDay = await detectGlobalPayday(userId);

	if (payDay && payDay.paydayDates.length >= 2) {
		currentSalaryDate = payDay.paydayDates[payDay.paydayDates.length - 1];
		prevSalaryDate = payDay.paydayDates[payDay.paydayDates.length - 2];
		sourceAccountId = payDay.sourceAccountId;
	} else if (payDay && payDay.paydayDates.length === 1) {
		currentSalaryDate = payDay.paydayDates[0];
		sourceAccountId = payDay.sourceAccountId;
	} else {
		// Raw fallback: most recent transaction >= 10 000 kr
		const [fallback] = await db
			.select({
				date: canonicalBankTransactions.canonicalDate,
				accountId: canonicalBankTransactions.accountId
			})
			.from(canonicalBankTransactions)
			.where(
				and(
					eq(canonicalBankTransactions.userId, userId),
					eq(canonicalBankTransactions.isActive, true),
					sql`${canonicalBankTransactions.amount} >= 10000`
				)
			)
			.orderBy(desc(canonicalBankTransactions.canonicalDate))
			.limit(1);
		if (!fallback) {
			return json({ error: 'No salary data detected' }, { status: 404 });
		}
		currentSalaryDate = String(fallback.date);
		sourceAccountId = fallback.accountId;
	}

	const currentFrom = new Date(`${currentSalaryDate}T00:00:00.000Z`);
	const prevFrom = prevSalaryDate ? new Date(`${prevSalaryDate}T00:00:00.000Z`) : currentFrom;
	const today = new Date();

	// 2. Ensure categorized events are up to date
	await ensureCategorizedEventsForRange({ userId, from: prevFrom, to: today });

	// 3. Fetch spending for current salary period
	const currentTxRows = await queryCategorizedEvents({
		userId,
		from: currentFrom,
		to: today,
		spendingOnly: true
	});

	// Aggregate by category
	const categoryMap = new Map<string, { label: string; emoji: string; amount: number; count: number; isFixed: boolean }>();
	let totalFixed = 0;
	let totalVariable = 0;

	for (const row of currentTxRows) {
		const cat = row.resolvedCategory ?? 'ukategorisert';
		const abs = Math.abs(row.amount);
		const existing = categoryMap.get(cat);
		if (existing) {
			existing.amount += abs;
			existing.count++;
		} else {
			categoryMap.set(cat, {
				label: row.resolvedLabel ?? cat,
				emoji: row.resolvedEmoji ?? '📦',
				amount: abs,
				count: 1,
				isFixed: row.isFixed ?? false
			});
		}
		if (row.isFixed) {
			totalFixed += abs;
		} else {
			totalVariable += abs;
		}
	}

	const categories = Array.from(categoryMap.entries())
		.map(([category, data]) => ({ category, ...data }))
		.sort((a, b) => b.amount - a.amount);

	const totalSpending = totalFixed + totalVariable;

	// 4. Fetch previous period spending for trend (only if we have a prev date)
	let previousMonthSpending = 0;
	let spendingTrend = 0;
	if (prevSalaryDate) {
		const prevTxRows = await queryCategorizedEvents({
			userId,
			from: prevFrom,
			to: currentFrom,
			spendingOnly: true
		});
		previousMonthSpending = prevTxRows.reduce((sum, row) => sum + Math.abs(row.amount), 0);
		if (previousMonthSpending > 0) {
			spendingTrend = ((totalSpending - previousMonthSpending) / previousMonthSpending) * 100;
		}
	}

	// 5. Fetch salary transaction amount
	let salaryAmount = 0;
	const salaryTxRows = await db
		.select({
			amount: canonicalBankTransactions.amount,
			description: sql<string>`COALESCE(${canonicalBankTransactions.descriptionDisplay}, ${canonicalBankTransactions.merchantKey}, '')`
		})
		.from(canonicalBankTransactions)
		.where(
			and(
				eq(canonicalBankTransactions.userId, userId),
				eq(canonicalBankTransactions.isActive, true),
				sql`${canonicalBankTransactions.canonicalDate} = ${currentSalaryDate}`,
				sql`${canonicalBankTransactions.amount} >= 10000`
			)
		)
		.orderBy(desc(canonicalBankTransactions.amount))
		.limit(5);

	for (const row of salaryTxRows) {
		const descText = (row.description ?? '').toLowerCase();
		if (SALARY_KEYWORDS.some((kw) => descText.includes(kw))) {
			salaryAmount = Number(row.amount);
			break;
		}
	}
	if (salaryAmount === 0 && salaryTxRows.length > 0) {
		salaryAmount = Number(salaryTxRows[0].amount);
	}

	// 6. Compute savings account balance change
	const savingsChanges: SalaryMonthReport['savingsChanges'] = [];
	if (sourceAccountId) {
		try {
			const dailyBalances = await buildDailyBalances(userId, sourceAccountId);

			// Get account name from latest bank_balance event
			const accountNameRow = await db
				.select({ accountName: sql<string>`data->>'accountName'` })
				.from(sensorEvents)
				.where(
					and(
						eq(sensorEvents.userId, userId),
						eq(sensorEvents.dataType, 'bank_balance'),
						sql`data->>'accountId' = ${sourceAccountId}`
					)
				)
				.orderBy(desc(sensorEvents.timestamp))
				.limit(1);
			const accountName = accountNameRow[0]?.accountName ?? sourceAccountId;

			// Find balance on or after payday
			const startRow = dailyBalances.find((r) => r.date >= currentSalaryDate);
			const endRow = dailyBalances.length > 0 ? dailyBalances[dailyBalances.length - 1] : null;

			if (startRow && endRow) {
				savingsChanges.push({
					accountId: sourceAccountId,
					accountName,
					startBalance: startRow.balance,
					endBalance: endRow.balance,
					change: endRow.balance - startRow.balance
				});
			}
		} catch {
			// Non-fatal
		}
	}

	// 7. Fetch goal tracks from memories store
	const goalProgress: GoalProgressItem[] = [];

	try {
		const storeMemory = await db.query.memories.findFirst({
			where: and(eq(memories.userId, userId), eq(memories.source, 'goal_tracks_v1')),
			columns: { content: true }
		});

		if (storeMemory?.content) {
			const store = JSON.parse(storeMemory.content) as Partial<Record<MetricId, GoalTrack[]>>;

			for (const metricId of ECONOMIC_METRIC_IDS) {
				const tracks = store[metricId] ?? [];
				const catalog = METRIC_CATALOG[metricId];
				if (!catalog) continue;

				for (const track of tracks) {
					// Compute actual value for this track in the current salary period
					let actualValue = 0;

					if (metricId === 'grocery_spend') {
						const groceryRows = await queryCategorizedEvents({
							userId,
							from: currentFrom,
							to: today,
							category: 'dagligvarer',
							spendingOnly: true
						});
						actualValue = groceryRows.reduce((sum, row) => sum + Math.abs(row.amount), 0);
					}

					const direction = catalog.direction as GoalProgressItem['direction'];
					const achieved =
						direction === 'lower_is_better'
							? actualValue <= track.targetValue
							: direction === 'higher_is_better'
								? actualValue >= track.targetValue
								: Math.abs(actualValue - track.targetValue) / track.targetValue < 0.1;

					goalProgress.push({
						type: 'track',
						metricId,
						label: track.label || catalog.label,
						targetValue: track.targetValue,
						actualValue,
						unit: track.unit || catalog.defaultUnit,
						direction,
						achieved
					});
				}
			}
		}
	} catch {
		// Non-fatal — report still works without goal tracks
	}

	// 8. Fetch active goals from goals table
	try {
		const activeGoals = await db
			.select({ id: goals.id, title: goals.title, description: goals.description })
			.from(goals)
			.where(and(eq(goals.userId, userId), eq(goals.status, 'active')))
			.limit(10);

		for (const goal of activeGoals) {
			goalProgress.push({
				type: 'goal',
				label: goal.title,
				targetValue: 0,
				actualValue: 0,
				unit: '',
				direction: 'higher_is_better',
				achieved: false,
				goalTitle: goal.title,
				goalDescription: goal.description
			});
		}
	} catch {
		// Non-fatal
	}

	// 9. Generate insights
	const insights = generateInsights({
		currentSalaryDate,
		prevSalaryDate,
		salaryAmount,
		totalSpending,
		totalFixed,
		totalVariable,
		categories,
		savingsChanges,
		goalProgress,
		previousMonthSpending,
		spendingTrend
	});

	const report: SalaryMonthReport = {
		currentSalaryDate,
		prevSalaryDate,
		salaryAmount,
		totalSpending,
		totalFixed,
		totalVariable,
		categories,
		savingsChanges,
		goalProgress,
		previousMonthSpending,
		spendingTrend,
		insights
	};

	return json(report);
};

// ── Insight generation ─────────────────────────────────────────────────────

function fmtNOK(n: number) {
	return `kr ${Math.round(Math.abs(n)).toLocaleString('nb-NO')}`;
}

function pctLabel(pct: number) {
	const abs = Math.abs(Math.round(pct));
	return pct <= 0 ? `ned ${abs}%` : `opp ${abs}%`;
}

function fmtDateNO(iso: string) {
	return new Date(iso).toLocaleDateString('nb-NO', { day: 'numeric', month: 'long' });
}

function generateInsights(data: {
	currentSalaryDate: string;
	prevSalaryDate: string | null;
	salaryAmount: number;
	totalSpending: number;
	totalFixed: number;
	totalVariable: number;
	categories: SalaryMonthReport['categories'];
	savingsChanges: SalaryMonthReport['savingsChanges'];
	goalProgress: GoalProgressItem[];
	previousMonthSpending: number;
	spendingTrend: number;
}): SalaryInsight[] {
	const insights: SalaryInsight[] = [];
	const period = `${fmtDateNO(data.currentSalaryDate)} – i dag`;
	const hasTrend = data.previousMonthSpending > 0;
	const trendCtx = hasTrend
		? ` (${pctLabel(data.spendingTrend)} vs forrige periode på ${fmtNOK(data.previousMonthSpending)})`
		: '';
	const baseCtx = `Lønnsperioden: ${period}. Lønn: ${fmtNOK(data.salaryAmount)}. Totalt forbruk: ${fmtNOK(data.totalSpending)}${trendCtx}.`;

	// 1. Total spending
	const trendEmoji = data.spendingTrend <= 0 ? '📉' : '📈';
	insights.push({
		id: 'total_spending',
		title: 'Totalt forbruk denne perioden',
		emoji: trendEmoji,
		summary: hasTrend
			? `${fmtNOK(data.totalSpending)} — ${pctLabel(data.spendingTrend)} vs forrige periode`
			: `${fmtNOK(data.totalSpending)} siden lønning`,
		systemPrompt: `${baseCtx} Du hjelper brukeren med å reflektere over totalforbruket og eventuelt justere eller opprette mål. Svar kort, konkret og på norsk. Foreslå gjerne et konkret mål om de ikke har ett.`,
		seedMessage: hasTrend
			? `Totalt brukte du ${fmtNOK(data.totalSpending)} i lønnsperioden fra ${fmtDateNO(data.currentSalaryDate)} — det er ${pctLabel(data.spendingTrend)} sammenliknet med forrige periode (${fmtNOK(data.previousMonthSpending)}). ${trendEmoji}\n\nHva tenker du om dette? Har du et mål for totalforbruk, eller vil du sette et?`
			: `Totalt brukte du ${fmtNOK(data.totalSpending)} siden lønning (${fmtDateNO(data.currentSalaryDate)}). ${trendEmoji}\n\nHva tenker du om dette? Har du et mål for totalforbruk, eller vil du sette et?`
	});

	// 2. Top spending categories (up to 3, skip tiny ones)
	const topCats = data.categories
		.filter((c) => c.category !== 'innskudd' && c.category !== 'ukategorisert' && c.amount > 200)
		.slice(0, 4);

	for (const cat of topCats) {
		const catPct = data.previousMonthSpending > 0
			? ((cat.amount / data.totalSpending) * 100)
			: 0;
		insights.push({
			id: `category_${cat.category}`,
			title: `${cat.emoji} ${cat.label}`,
			emoji: cat.emoji,
			summary: `${fmtNOK(cat.amount)} — ${Math.round(catPct)}% av totalforbruket`,
			category: cat.category,
			systemPrompt: `${baseCtx} Kategori: ${cat.label} (${fmtNOK(cat.amount)}, ${Math.round(catPct)}% av totalt). Du hjelper brukeren med å reflektere over dette og eventuelt justere eller opprette mål for kategorien. Svar kort og på norsk.`,
			seedMessage: `Du brukte ${fmtNOK(cat.amount)} på ${cat.label} denne perioden — det tilsvarer ${Math.round(catPct)}% av totalforbruket ditt. ${cat.emoji}\n\nHar du noen tanker om dette? Vil du sette et mål for ${cat.label.toLowerCase()}-budsjettet?`
		});
	}

	// 3. Goal track insights
	for (const g of data.goalProgress.filter((g) => g.type === 'track')) {
		const resultEmoji = g.achieved ? '✅' : '⚠️';
		const resultText = g.achieved ? 'nådde du målet' : 'nådde du ikke målet';
		insights.push({
			id: `goal_${g.metricId ?? g.label}`,
			title: `Mål: ${g.label}`,
			emoji: resultEmoji,
			summary: `${fmtNOK(g.actualValue)} av ${fmtNOK(g.targetValue)} ${g.unit} — ${g.achieved ? 'nådd ✅' : 'ikke nådd ⚠️'}`,
			systemPrompt: `${baseCtx} Mål: ${g.label}. Faktisk: ${fmtNOK(g.actualValue)}, mål: ${fmtNOK(g.targetValue)} ${g.unit}. Resultatet: ${resultText}. Hjelp brukeren med å reflektere og evt. justere målet. Svar kort og på norsk.`,
			seedMessage: `For målet om «${g.label}» ${resultText} denne perioden: ${fmtNOK(g.actualValue)} brukt av ${fmtNOK(g.targetValue)} ${g.unit}. ${resultEmoji}\n\nVil du justere målet, eller har du tanker om hva som påvirket resultatet?`
		});
	}

	// 4. Savings insight
	for (const s of data.savingsChanges) {
		const dir = s.change >= 0 ? 'vokste' : 'sank';
		const savEmoji = s.change >= 0 ? '💰' : '📊';
		insights.push({
			id: `savings_${s.accountId}`,
			title: `${s.accountName} ${dir} siden lønning`,
			emoji: savEmoji,
			summary: `${s.change >= 0 ? '+' : ''}${fmtNOK(s.change)} — fra ${fmtNOK(s.startBalance)} til ${fmtNOK(s.endBalance)}`,
			systemPrompt: `${baseCtx} Sparekonto «${s.accountName}»: startsaldo ${fmtNOK(s.startBalance)}, sluttsaldo ${fmtNOK(s.endBalance)}, endring ${s.change >= 0 ? '+' : ''}${fmtNOK(s.change)}. Hjelp brukeren med å reflektere og evt. sette sparemål. Svar kort og på norsk.`,
			seedMessage: `${s.accountName} ${dir} med ${fmtNOK(s.change)} siden lønning (fra ${fmtNOK(s.startBalance)} til ${fmtNOK(s.endBalance)}). ${savEmoji}\n\nHar du et sparemål? Vil du justere eller sette et mål for månedlig sparing?`
		});
	}

	// 5. Final free reflection (always last)
	const monthLabel = new Date(data.currentSalaryDate).toLocaleDateString('nb-NO', { month: 'long', year: 'numeric' });
	insights.push({
		id: 'free_reflection',
		title: `Andre refleksjoner om ${monthLabel}?`,
		emoji: '💬',
		summary: 'Fritt rom for tanker om økonomi og mål fremover',
		systemPrompt: `${baseCtx} Dette er en fri refleksjon om lønnsmåneden. Brukeren kan dele tanker, stille spørsmål, eller snakke om mål fremover. Vær åpen, vennlig og hjelp med det de trenger. Svar på norsk.`,
		seedMessage: `Har du andre refleksjoner om økonomien i ${monthLabel}? 💬\n\nDet kan være noe du vil endre, mål du vil sette, eller bare en tanke du vil si høyt.`,
		isFreeReflection: true
	});

	return insights;
}
