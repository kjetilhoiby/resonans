<script lang="ts">
	interface Props {
		dailyKm: { date: string; km: number }[];
		targetKm: number;
		startDate: string; // YYYY-MM-DD
		endDate: string; // YYYY-MM-DD
		currentKm: number;
	}

	let { dailyKm, targetKm, startDate, endDate, currentKm }: Props = $props();

	const W = 400;
	const H = 100;
	const padL = 30; // y-axis labels
	const padR = 8;
	const padT = 8;
	const padB = 18; // x-axis labels
	const pw = W - padL - padR;
	const ph = H - padT - padB;

	function allDatesBetween(start: string, end: string): string[] {
		const dates: string[] = [];
		const cur = new Date(start + 'T12:00:00Z');
		const last = new Date(end + 'T12:00:00Z');
		while (cur <= last) {
			dates.push(cur.toISOString().slice(0, 10));
			cur.setUTCDate(cur.getUTCDate() + 1);
		}
		return dates;
	}

	function fmtDate(iso: string): string {
		return new Date(iso + 'T12:00:00Z').toLocaleDateString('no-NO', {
			day: 'numeric',
			month: 'short'
		});
	}

	const chart = $derived.by(() => {
		const today = new Date().toISOString().slice(0, 10);
		const allDates = allDatesBetween(startDate, endDate);
		const total = Math.max(1, allDates.length - 1);
		const yMax = Math.max(targetKm, 0.1);

		const kmMap: Record<string, number> = {};
		for (const d of dailyKm) kmMap[d.date] = d.km;

		function xAt(idx: number): number {
			return padL + (idx / total) * pw;
		}
		function xForDate(dateStr: string): number {
			const idx = allDates.indexOf(dateStr);
			return xAt(Math.max(0, idx));
		}
		function yAt(km: number): number {
			return padT + ph - (Math.min(Math.max(km, 0), yMax) / yMax) * ph;
		}

		// Akkumulert km per dag opp til og med i dag
		let acc = 0;
		const cumPts: { x: number; y: number }[] = [];
		for (let i = 0; i < allDates.length; i++) {
			const date = allDates[i];
			if (date > today) break;
			acc += kmMap[date] ?? 0;
			cumPts.push({ x: xAt(i), y: yAt(acc) });
		}

		// SVG-paths
		let areaPath = '';
		let linePath = '';
		if (cumPts.length > 0) {
			const bottom = padT + ph;
			linePath = cumPts
				.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
				.join(' ');
			areaPath =
				`${linePath} L${cumPts[cumPts.length - 1].x.toFixed(1)} ${bottom} L${cumPts[0].x.toFixed(1)} ${bottom} Z`;
		}

		// Plannlagt linje: 0 på startdato → target på sluttdato
		const planPath = `M${padL} ${yAt(0).toFixed(1)} L${(padL + pw).toFixed(1)} ${yAt(targetKm).toFixed(1)}`;

		// Nødvendig snitt resten av perioden: fra i dag til slutt
		let requiredPath = '';
		let daysLeft = 0;
		let requiredPerDay: number | null = null;
		if (today >= startDate && today < endDate) {
			const tX = xForDate(today);
			const tY = yAt(currentKm);
			requiredPath = `M${tX.toFixed(1)} ${tY.toFixed(1)} L${(padL + pw).toFixed(1)} ${yAt(targetKm).toFixed(1)}`;
			const endMs = new Date(endDate + 'T12:00:00Z').getTime();
			const nowMs = new Date(today + 'T12:00:00Z').getTime();
			daysLeft = Math.ceil((endMs - nowMs) / 86400000);
			const kmLeft = Math.max(0, targetKm - currentKm);
			requiredPerDay = daysLeft > 0 ? Math.round((kmLeft / daysLeft) * 10) / 10 : null;
		}

		// Dagens posisjon
		const todayX =
			today >= startDate && today <= endDate ? xForDate(today) : null;

		// Y-akse referansepunkter
		const halfKm = Math.round(targetKm / 2);

		return {
			areaPath,
			linePath,
			planPath,
			requiredPath,
			todayX,
			daysLeft,
			requiredPerDay,
			halfKm,
			gridY50: yAt(halfKm),
			gridY100: yAt(targetKm),
			yBottom: padT + ph
		};
	});
</script>

<div class="burnup-chart">
	<svg viewBox="0 0 {W} {H}" width="100%" style="display:block; height:auto;">
		<!-- Rutenettlinjer -->
		<line
			x1={padL}
			y1={chart.gridY100}
			x2={padL + pw}
			y2={chart.gridY100}
			stroke="#222"
			stroke-width="1"
		/>
		<line
			x1={padL}
			y1={chart.gridY50}
			x2={padL + pw}
			y2={chart.gridY50}
			stroke="#222"
			stroke-width="1"
		/>

		<!-- Y-akse etiketter -->
		<text x={padL - 4} y={chart.gridY100 + 4} text-anchor="end" class="axis-label">{targetKm}</text>
		<text x={padL - 4} y={chart.gridY50 + 4} text-anchor="end" class="axis-label">{chart.halfKm}</text>
		<text x={padL - 4} y={chart.yBottom + 4} text-anchor="end" class="axis-label">0</text>

		<!-- Planlagt linje (stiplet grå) -->
		<path d={chart.planPath} stroke="#3a3a3a" stroke-width="1.5" stroke-dasharray="5 3" fill="none" />

		<!-- Nødvendig snittlinje (prikkete blå) -->
		{#if chart.requiredPath}
			<path
				d={chart.requiredPath}
				stroke="#6ea8fe"
				stroke-width="1.5"
				stroke-dasharray="3 3"
				fill="none"
			/>
		{/if}

		<!-- Akkumulert area + linje -->
		{#if chart.areaPath}
			<path d={chart.areaPath} fill="rgba(240, 149, 74, 0.15)" />
			<path
				d={chart.linePath}
				stroke="#f0954a"
				stroke-width="2"
				fill="none"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		{/if}

		<!-- Dagens vertikale linje -->
		{#if chart.todayX !== null}
			<line
				x1={chart.todayX}
				y1={padT}
				x2={chart.todayX}
				y2={chart.yBottom}
				stroke="#444"
				stroke-width="1"
				stroke-dasharray="2 2"
			/>
		{/if}

		<!-- X-akse etiketter -->
		<text x={padL} y={H - 3} text-anchor="start" class="axis-label">{fmtDate(startDate)}</text>
		<text x={padL + pw} y={H - 3} text-anchor="end" class="axis-label">{fmtDate(endDate)}</text>
	</svg>

	<div class="chart-legend">
		<span class="legend-item legend-actual">— Faktisk</span>
		<span class="legend-item legend-plan">- - Plan</span>
		{#if chart.requiredPerDay !== null}
			<span class="legend-item legend-required">··· Nødvendig snitt: {chart.requiredPerDay} km/dag ({chart.daysLeft} dager igjen)</span>
		{/if}
	</div>
</div>

<style>
	.burnup-chart {
		margin-top: 1rem;
		margin-bottom: 0.5rem;
	}

	.burnup-chart svg {
		overflow: visible;
	}

	:global(.axis-label) {
		font-size: 9px;
		fill: #555;
		font-family: 'Inter', system-ui, sans-serif;
	}

	.chart-legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-top: 0.35rem;
		font-size: 0.68rem;
	}

	.legend-item {
		color: #555;
	}

	.legend-actual {
		color: #f0954a;
	}

	.legend-plan {
		color: #3a3a3a;
	}

	.legend-required {
		color: #6ea8fe;
	}
</style>
