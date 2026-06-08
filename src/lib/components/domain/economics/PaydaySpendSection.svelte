<!--
  PaydaySpendSection — Burnup chart widgets showing daily spend since payday.
  Renders total spend and grocery spend side by side with comparison lines.
-->
<script lang="ts">
	interface TxItem {
		date: string;
		description: string;
		amount: number;
		category: string;
		emoji: string;
		label: string;
	}

	interface PaydaySpend {
		paydayDate: string | null;
		daysSincePayday: number;
		totalSpend: number;
		spendPerDay: number;
		grocerySpend: number;
		grocerySpendPerDay: number;
		prevSpendPerDay: number | null;
		prevGrocerySpendPerDay: number | null;
		comparisonPeriodsUsed: number;
		averageComparisonPoints: Array<{ day: number; total: number; grocery: number }>;
		transactions: TxItem[];
		groceryTransactions: TxItem[];
	}

	interface Props {
		paydaySpend: PaydaySpend;
		currentMonth: string;
		onShowAllTransactions: () => void;
		onShowGroceryTransactions: () => void;
	}

	let { paydaySpend, currentMonth, onShowAllTransactions, onShowGroceryTransactions }: Props = $props();

	// ── Formatting helpers ──

	function formatNOK(amount: number): string {
		return new Intl.NumberFormat('nb-NO', {
			style: 'currency', currency: 'NOK', maximumFractionDigits: 0
		}).format(amount);
	}

	function formatPerDay(kr: number): string {
		return `${new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 0 }).format(kr)} kr/dag`;
	}

	function formatPaydayDate(iso: string | null): string {
		if (!iso) return 'ukjent dato';
		return new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short' }).format(new Date(iso));
	}

	function paydayRingColor(current: number, prev: number | null): string {
		if (!prev || prev === 0) return '#7c8ef5';
		const ratio = current / prev;
		if (ratio <= 0.95) return '#82c882';
		if (ratio <= 1.1) return '#f0b429';
		return '#e07070';
	}

	// ── Transaction dedup ──

	function makeTxDedupKey(tx: TxItem): string {
		const day = new Date(tx.date).toISOString().slice(0, 10);
		const normalized = tx.description.normalize('NFKC').replace(/\s+/g, ' ').trim().toUpperCase();
		const words = normalized.split(' ').filter(Boolean);
		const first = (count: number) => words.slice(0, Math.min(count, words.length)).join(' ');
		let description = normalized;
		if (normalized.startsWith('COOP MEGA ')) description = first(3);
		else if (normalized.startsWith('COOP EXTRA ')) description = first(3);
		else if (normalized.startsWith('KIWI ')) description = first(2);
		else if (normalized.startsWith('REMA ')) description = first(2);
		else if (normalized.startsWith('MENY ')) description = first(2);
		else if (normalized.startsWith('SPAR ')) description = first(2);
		else if (normalized.startsWith('BUNNPRIS ')) description = first(2);
		else if (normalized.startsWith('EXTRA ')) description = first(2);
		else if (normalized.startsWith('JOKER ')) description = first(2);
		else if (normalized.startsWith('NARVESEN ')) description = first(2);
		else if (normalized.startsWith('ODA.COM')) description = 'ODA.COM';
		else if (normalized.startsWith('ODA ')) description = 'ODA';
		const amount = Math.round(Math.abs(tx.amount) * 100);
		return `${day}:${description}:${amount}:${tx.category}`;
	}

	function dedupeTransactions(transactions: TxItem[]): TxItem[] {
		const seen = new Set<string>();
		const result: TxItem[] = [];
		for (const tx of transactions) {
			const key = makeTxDedupKey(tx);
			if (seen.has(key)) continue;
			seen.add(key);
			result.push(tx);
		}
		return result;
	}

	// ── Burnup chart helpers ──

	function resolvePaydayStartDate(): Date {
		if (paydaySpend.paydayDate) return new Date(paydaySpend.paydayDate);
		const firstTx = paydaySpend.transactions[paydaySpend.transactions.length - 1]?.date;
		if (firstTx) return new Date(firstTx);
		return new Date(`${currentMonth}-01T12:00:00Z`);
	}

	function sameDateNextMonth(from: Date): Date {
		const next = new Date(from);
		const wantedDay = from.getDate();
		next.setDate(1);
		next.setMonth(next.getMonth() + 1);
		const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
		next.setDate(Math.min(wantedDay, lastDay));
		next.setHours(0, 0, 0, 0);
		return next;
	}

	function daysBetween(start: Date, end: Date): number {
		const msPerDay = 24 * 60 * 60 * 1000;
		return Math.max(0, Math.floor((end.getTime() - start.getTime()) / msPerDay));
	}

	type BurnupPoint = { day: number; total: number };

	function buildBurnupPoints(transactions: TxItem[]): BurnupPoint[] {
		const startDate = resolvePaydayStartDate();
		const startDay = new Date(startDate);
		startDay.setHours(0, 0, 0, 0);
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const totalsByDay = new Map<string, number>();
		for (const tx of transactions) {
			const dayKey = new Date(tx.date).toISOString().slice(0, 10);
			totalsByDay.set(dayKey, (totalsByDay.get(dayKey) ?? 0) + Math.abs(tx.amount));
		}
		const points: BurnupPoint[] = [{ day: 0, total: 0 }];
		let cumulative = 0;
		let cursor = new Date(startDay);
		let day = 1;
		while (cursor <= today) {
			const key = cursor.toISOString().slice(0, 10);
			cumulative += totalsByDay.get(key) ?? 0;
			points.push({ day, total: cumulative });
			cursor.setDate(cursor.getDate() + 1);
			day += 1;
		}
		return points;
	}

	function burnupPath(points: BurnupPoint[], width = 220, height = 74, maxTotalOverride?: number, maxDayOverride?: number): string {
		if (points.length === 0) return '';
		const maxTotal = Math.max(maxTotalOverride ?? Math.max(...points.map((p) => p.total), 1), 1);
		const maxDay = Math.max(maxDayOverride ?? Math.max(...points.map((p) => p.day), 1), 1);
		return points
			.map((p, i) => {
				const x = (p.day / maxDay) * width;
				const y = height - (p.total / maxTotal) * height;
				return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
			})
			.join(' ');
	}

	function burnupAreaPath(points: BurnupPoint[], width = 220, height = 74, maxTotalOverride?: number, maxDayOverride?: number): string {
		const line = burnupPath(points, width, height, maxTotalOverride, maxDayOverride);
		if (!line) return '';
		const lastDay = points[points.length - 1].day;
		const maxDay = Math.max(maxDayOverride ?? Math.max(...points.map((p) => p.day), 1), 1);
		const lastX = (lastDay / maxDay) * width;
		return `${line} L ${lastX.toFixed(1)} ${height} L 0 ${height} Z`;
	}

	// ── Derived values ──

	const paydayTransactionsDeduped = $derived(dedupeTransactions(paydaySpend.transactions));
	const groceryTransactionsDeduped = $derived(dedupeTransactions(paydaySpend.groceryTransactions));
	const totalSpendDeduped = $derived(paydayTransactionsDeduped.reduce((sum, tx) => sum + Math.abs(tx.amount), 0));
	const grocerySpendDeduped = $derived(groceryTransactionsDeduped.reduce((sum, tx) => sum + Math.abs(tx.amount), 0));
	const spendPerDayDeduped = $derived(totalSpendDeduped / Math.max(1, paydaySpend.daysSincePayday));
	const grocerySpendPerDayDeduped = $derived(grocerySpendDeduped / Math.max(1, paydaySpend.daysSincePayday));

	const totalBurnupPoints = $derived(buildBurnupPoints(paydayTransactionsDeduped));
	const groceryBurnupPoints = $derived(buildBurnupPoints(groceryTransactionsDeduped));
	const totalComparisonBurnupPoints = $derived([
		{ day: 0, total: 0 },
		...paydaySpend.averageComparisonPoints.map((p) => ({ day: p.day, total: p.total }))
	]);
	const groceryComparisonBurnupPoints = $derived([
		{ day: 0, total: 0 },
		...paydaySpend.averageComparisonPoints.map((p) => ({ day: p.day, total: p.grocery }))
	]);
	const totalBurnupMax = $derived.by(() => {
		const compMax = Math.max(0, ...totalComparisonBurnupPoints.map((p) => p.total));
		return Math.max(1, compMax > 0 ? compMax : Math.max(...totalBurnupPoints.map((p) => p.total)));
	});
	const groceryBurnupMax = $derived.by(() => {
		const compMax = Math.max(0, ...groceryComparisonBurnupPoints.map((p) => p.total));
		return Math.max(1, compMax > 0 ? compMax : Math.max(...groceryBurnupPoints.map((p) => p.total)));
	});
	const totalRingColor = $derived(paydayRingColor(spendPerDayDeduped, paydaySpend.prevSpendPerDay));
	const groceryRingColor = $derived(paydayRingColor(grocerySpendPerDayDeduped, paydaySpend.prevGrocerySpendPerDay));
	const paydayStartLabel = $derived(formatPaydayDate(resolvePaydayStartDate().toISOString()));
	const burnupHorizonDay = $derived.by(() => {
		const start = resolvePaydayStartDate();
		start.setHours(0, 0, 0, 0);
		const horizon = sameDateNextMonth(start);
		const compMaxDay = paydaySpend.averageComparisonPoints.length > 0
			? Math.max(...paydaySpend.averageComparisonPoints.map((p) => p.day))
			: 0;
		return Math.max(paydaySpend.daysSincePayday, daysBetween(start, horizon), compMaxDay, 1);
	});
</script>

<p class="ed-widget-context">
	Forbruk per dag siden lønn — nåværende periode er {paydaySpend.daysSincePayday} dager.{#if paydaySpend.comparisonPeriodsUsed > 0} Stiplet linje viser snitt av {paydaySpend.comparisonPeriodsUsed} foregående {paydaySpend.comparisonPeriodsUsed === 1 ? 'periode' : 'perioder'}.{/if}
</p>
<div class="ed-grid">
	<!-- Widget 1: Total forbruk per dag siden lønn -->
	<button class="ed-card ed-card-btn" type="button" onclick={onShowAllTransactions}>
		<div class="ed-burnup-head">
			<p class="ed-burnup-value">{formatPerDay(spendPerDayDeduped)}</p>
			<p class="ed-burnup-total">{formatNOK(totalSpendDeduped)} totalt</p>
		</div>
		<div class="ed-burnup-chart" aria-hidden="true">
			<svg viewBox="0 0 220 74" preserveAspectRatio="none">
				<path d={burnupAreaPath(totalBurnupPoints, 220, 74, totalBurnupMax, burnupHorizonDay)} class="ed-burnup-area" style:color={totalRingColor}></path>
				{#if paydaySpend.comparisonPeriodsUsed > 0}
					<path d={burnupPath(totalComparisonBurnupPoints, 220, 74, totalBurnupMax, burnupHorizonDay)} class="ed-burnup-compare"></path>
				{/if}
				<path d={burnupPath(totalBurnupPoints, 220, 74, totalBurnupMax, burnupHorizonDay)} class="ed-burnup-line" style:color={totalRingColor}></path>
			</svg>
		</div>
		<div class="ed-card-copy">
			<p class="ed-card-label">Forbruk / dag</p>
			<p class="ed-card-sub">fra {paydayStartLabel} til i dag</p>
			{#if paydaySpend.prevSpendPerDay}
				<p class="ed-card-compare" style:color={totalRingColor}>
					{spendPerDayDeduped <= paydaySpend.prevSpendPerDay ? '↓' : '↑'}
					{formatPerDay(paydaySpend.prevSpendPerDay)} forrige
				</p>
			{/if}
		</div>
	</button>

	<!-- Widget 2: Dagligvare per dag siden lønn -->
	<button class="ed-card ed-card-btn" type="button" onclick={onShowGroceryTransactions}>
		<div class="ed-burnup-head">
			<p class="ed-burnup-value">{formatPerDay(grocerySpendPerDayDeduped)}</p>
			<p class="ed-burnup-total">{formatNOK(grocerySpendDeduped)} totalt</p>
		</div>
		<div class="ed-burnup-chart" aria-hidden="true">
			<svg viewBox="0 0 220 74" preserveAspectRatio="none">
				<path d={burnupAreaPath(groceryBurnupPoints, 220, 74, groceryBurnupMax, burnupHorizonDay)} class="ed-burnup-area" style:color={groceryRingColor}></path>
				{#if paydaySpend.comparisonPeriodsUsed > 0}
					<path d={burnupPath(groceryComparisonBurnupPoints, 220, 74, groceryBurnupMax, burnupHorizonDay)} class="ed-burnup-compare"></path>
				{/if}
				<path d={burnupPath(groceryBurnupPoints, 220, 74, groceryBurnupMax, burnupHorizonDay)} class="ed-burnup-line" style:color={groceryRingColor}></path>
			</svg>
		</div>
		<div class="ed-card-copy">
			<p class="ed-card-label">Dagligvare / dag</p>
			<p class="ed-card-sub">fra {paydayStartLabel} til i dag</p>
			{#if paydaySpend.prevGrocerySpendPerDay}
				<p class="ed-card-compare" style:color={groceryRingColor}>
					{grocerySpendPerDayDeduped <= paydaySpend.prevGrocerySpendPerDay ? '↓' : '↑'}
					{formatPerDay(paydaySpend.prevGrocerySpendPerDay)} forrige
				</p>
			{/if}
		</div>
	</button>
</div>

<style>
	.ed-widget-context {
		margin: 0;
		font-size: 0.75rem;
		line-height: 1.45;
		color: #6d6d6d;
	}
	.ed-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(155px, 1fr));
		gap: 12px;
	}
	.ed-card {
		background: #141414;
		border: 1px solid #232323;
		border-radius: 18px;
		padding: 14px 12px 12px;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 10px;
		text-align: left;
	}
	.ed-card-btn {
		cursor: pointer;
		appearance: none;
		-webkit-appearance: none;
		transition: border-color 0.15s;
	}
	.ed-card-copy {
		display: flex;
		flex-direction: column;
		gap: 2px;
		align-items: flex-start;
	}
	.ed-burnup-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
	}
	.ed-burnup-value {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 700;
		letter-spacing: -0.02em;
		color: #f2f3ff;
	}
	.ed-burnup-total {
		margin: 0;
		font-size: 0.72rem;
		color: #7f8092;
		text-align: right;
	}
	.ed-burnup-chart {
		height: 74px;
		border-radius: 12px;
		overflow: hidden;
		background:
			linear-gradient(to top, rgba(255,255,255,0.02), rgba(255,255,255,0)),
			repeating-linear-gradient(
				to top,
				transparent 0,
				transparent 17px,
				rgba(255,255,255,0.04) 17px,
				rgba(255,255,255,0.04) 18px
			);
	}
	.ed-burnup-chart svg {
		display: block;
		width: 100%;
		height: 100%;
	}
	.ed-burnup-line {
		fill: none;
		stroke: currentColor;
		stroke-width: 2.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.ed-burnup-compare {
		fill: none;
		stroke: rgba(226, 228, 255, 0.72);
		stroke-width: 1.8;
		stroke-dasharray: 5 4;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.ed-burnup-area {
		fill: currentColor;
		opacity: 0.12;
	}
	.ed-card-label {
		margin: 0;
		font-size: 0.78rem;
		font-weight: 600;
		color: #bbb;
		letter-spacing: 0.02em;
		text-transform: uppercase;
	}
	.ed-card-sub {
		margin: 0;
		font-size: 0.75rem;
		color: #666;
	}
</style>
