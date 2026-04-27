<script lang="ts">
	export interface TrackPoint {
		lat: number;
		lon: number;
		ele?: number | null;
		hr?: number | null;
		time?: string | null;
	}

	export interface WorkoutSplit {
		km: number;
		paceSecPerKm: number | null;
		avgHr: number | null;
		eleGain: number;
		eleLoss: number;
	}

	interface Props {
		trackPoints: TrackPoint[];
		/** Fallback HR from another source (e.g. Withings) when track has no HR */
		fallbackAvgHr?: number | null;
		fallbackMaxHr?: number | null;
		fallbackMinHr?: number | null;
		fallbackSource?: string | null;
	}

	let { trackPoints, fallbackAvgHr = null, fallbackMaxHr = null, fallbackMinHr = null, fallbackSource = null }: Props = $props();

	function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
		const R = 6371000;
		const dLat = ((lat2 - lat1) * Math.PI) / 180;
		const dLon = ((lon2 - lon1) * Math.PI) / 180;
		const a =
			Math.sin(dLat / 2) ** 2 +
			Math.cos((lat1 * Math.PI) / 180) *
				Math.cos((lat2 * Math.PI) / 180) *
				Math.sin(dLon / 2) ** 2;
		return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	}

	function fmtPace(secPerKm: number): string {
		const m = Math.floor(secPerKm / 60);
		const s = String(Math.round(secPerKm % 60)).padStart(2, '0');
		return `${m}:${s}`;
	}

	interface ChartPt { x: number; y: number }

	const computed = $derived.by(() => {
		if (trackPoints.length < 2) return null;

		// Build cumulative distance and time arrays
		const cumDist: number[] = [0];
		const times: (number | null)[] = [
			trackPoints[0].time ? new Date(trackPoints[0].time).getTime() : null
		];
		for (let i = 1; i < trackPoints.length; i++) {
			const p = trackPoints[i];
			const prev = trackPoints[i - 1];
			cumDist.push(cumDist[i - 1] + haversine(prev.lat, prev.lon, p.lat, p.lon));
			times.push(p.time ? new Date(p.time).getTime() : null);
		}
		const totalDist = cumDist[cumDist.length - 1] || 1;
		const totalKm = Math.floor(totalDist / 1000);

		// --- Elevation chart (normalized x = fraction of total dist) ---
		const elePts: ChartPt[] = trackPoints
			.map((p, i) => (p.ele != null ? { x: cumDist[i] / totalDist, y: p.ele } : null))
			.filter(Boolean) as ChartPt[];

		// --- HR chart ---
		const hrPts: ChartPt[] = trackPoints
			.map((p, i) => (p.hr != null ? { x: cumDist[i] / totalDist, y: p.hr } : null))
			.filter(Boolean) as ChartPt[];
		const hasTrackHr = hrPts.length >= 2;

		// --- Per-km splits ---
		const splits: WorkoutSplit[] = [];
		for (let km = 1; km <= totalKm; km++) {
			const targetM = km * 1000;
			const prevM = (km - 1) * 1000;

			// Find indices bracketing this km segment
			let startIdx = 0;
			let endIdx = cumDist.length - 1;
			for (let i = 0; i < cumDist.length; i++) {
				if (cumDist[i] <= prevM) startIdx = i;
				if (cumDist[i] <= targetM) endIdx = i;
			}

			// Interpolate start time
			function interpTime(targetDist: number): number | null {
				let lo = 0;
				for (let i = 1; i < cumDist.length; i++) {
					if (cumDist[i] >= targetDist) {
						lo = i - 1;
						break;
					}
				}
				const t0 = times[lo];
				const t1 = times[lo + 1] ?? null;
				if (t0 == null || t1 == null) return null;
				const frac = (targetDist - cumDist[lo]) / (cumDist[lo + 1] - cumDist[lo] || 1);
				return t0 + frac * (t1 - t0);
			}

			const tStart = interpTime(prevM);
			const tEnd = interpTime(targetM);
			const paceSecPerKm =
				tStart != null && tEnd != null && tEnd > tStart
					? (tEnd - tStart) / 1000
					: null;

			// HR average over this km (track points between startIdx and endIdx)
			const segHrs = trackPoints
				.slice(startIdx, endIdx + 1)
				.map((p) => p.hr)
				.filter((h): h is number => h != null);
			const avgHr =
				segHrs.length > 0
					? Math.round(segHrs.reduce((s, h) => s + h, 0) / segHrs.length)
					: null;

			// Elevation gain/loss over km
			let eleGain = 0;
			let eleLoss = 0;
			for (let i = startIdx + 1; i <= endIdx; i++) {
				const prev = trackPoints[i - 1].ele;
				const cur = trackPoints[i].ele;
				if (prev != null && cur != null) {
					const diff = cur - prev;
					if (diff > 0) eleGain += diff;
					else eleLoss += Math.abs(diff);
				}
			}

			splits.push({
				km,
				paceSecPerKm,
				avgHr,
				eleGain: Math.round(eleGain),
				eleLoss: Math.round(eleLoss)
			});
		}

		return { elePts, hrPts, hasTrackHr, splits, totalDist, totalKm };
	});

	function polyline(pts: ChartPt[], W: number, H: number, pad = 4): string {
		if (pts.length < 2) return '';
		const ys = pts.map((p) => p.y);
		const minY = Math.min(...ys);
		const maxY = Math.max(...ys);
		const rangeY = maxY - minY || 1;
		return pts
			.map((p) => {
				const x = pad + p.x * (W - pad * 2);
				const y = pad + (1 - (p.y - minY) / rangeY) * (H - pad * 2);
				return `${x.toFixed(1)},${y.toFixed(1)}`;
			})
			.join(' ');
	}

	function arealine(pts: ChartPt[], W: number, H: number, pad = 4): string {
		if (pts.length < 2) return '';
		const line = polyline(pts, W, H, pad);
		const first = `${(pad + pts[0].x * (W - pad * 2)).toFixed(1)},${H}`;
		const last = `${(pad + pts[pts.length - 1].x * (W - pad * 2)).toFixed(1)},${H}`;
		return `${first} ${line} ${last}`;
	}

	function yLabel(pts: ChartPt[], top: boolean): string {
		if (!pts.length) return '';
		const ys = pts.map((p) => p.y);
		return Math.round(top ? Math.max(...ys) : Math.min(...ys)).toString();
	}
</script>

{#if computed && (computed.elePts.length >= 2 || computed.hasTrackHr || computed.splits.length > 0)}
	<div class="wc-root">
		{@const W = 560}
		{@const H = 72}

		{#if computed.elePts.length >= 2}
			<div class="wc-chart-block">
				<div class="wc-chart-meta">
					<span class="wc-chart-title">Høydeprofil</span>
					<span class="wc-chart-unit">m</span>
				</div>
				<div class="wc-chart-wrap">
					<svg viewBox="0 0 {W} {H}" class="wc-svg" aria-hidden="true">
						<polygon
							points={arealine(computed.elePts, W, H)}
							fill="rgba(100,180,100,0.15)"
						/>
						<polyline
							points={polyline(computed.elePts, W, H)}
							fill="none"
							stroke="#5fba6a"
							stroke-width="1.6"
							stroke-linejoin="round"
							stroke-linecap="round"
						/>
					</svg>
					<span class="wc-label-top">{yLabel(computed.elePts, true)} m</span>
					<span class="wc-label-bot">{yLabel(computed.elePts, false)} m</span>
				</div>
			</div>
		{/if}

		{#if computed.hasTrackHr}
			<div class="wc-chart-block">
				<div class="wc-chart-meta">
					<span class="wc-chart-title">Puls</span>
					<span class="wc-chart-unit">bpm</span>
				</div>
				<div class="wc-chart-wrap">
					<svg viewBox="0 0 {W} {H}" class="wc-svg" aria-hidden="true">
						<polyline
							points={polyline(computed.hrPts, W, H)}
							fill="none"
							stroke="#ef4444"
							stroke-width="1.6"
							stroke-linejoin="round"
							stroke-linecap="round"
						/>
					</svg>
					<span class="wc-label-top">{yLabel(computed.hrPts, true)}</span>
					<span class="wc-label-bot">{yLabel(computed.hrPts, false)}</span>
				</div>
			</div>
		{:else if fallbackAvgHr != null}
			<div class="wc-hr-fallback">
				<span class="wc-hr-fallback-icon">♥</span>
				<span class="wc-hr-fallback-text">
					{#if fallbackSource}Fra {fallbackSource}:{/if}
					snitt {fallbackAvgHr} bpm
					{#if fallbackMaxHr} · maks {fallbackMaxHr}{/if}
					{#if fallbackMinHr} · min {fallbackMinHr}{/if}
				</span>
			</div>
		{/if}

		{#if computed.splits.length > 0}
			<div class="wc-splits">
				<table class="wc-splits-table">
					<thead>
						<tr>
							<th>km</th>
							<th>tempo</th>
							{#if computed.splits.some((s) => s.avgHr != null)}<th>puls</th>{/if}
							{#if computed.splits.some((s) => s.eleGain > 0 || s.eleLoss > 0)}<th>hm</th>{/if}
						</tr>
					</thead>
					<tbody>
						{#each computed.splits as split}
							<tr>
								<td>{split.km}</td>
								<td>{split.paceSecPerKm != null ? fmtPace(split.paceSecPerKm) : '–'}</td>
								{#if computed.splits.some((s) => s.avgHr != null)}
									<td>{split.avgHr != null ? split.avgHr : '–'}</td>
								{/if}
								{#if computed.splits.some((s) => s.eleGain > 0 || s.eleLoss > 0)}
									<td class="wc-ele-cell">
										{#if split.eleGain > 1}<span class="wc-ele-up">+{split.eleGain}</span>{/if}
										{#if split.eleLoss > 1}<span class="wc-ele-dn">-{split.eleLoss}</span>{/if}
										{#if split.eleGain <= 1 && split.eleLoss <= 1}–{/if}
									</td>
								{/if}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
{/if}

<style>
	.wc-root {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.wc-chart-block {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.wc-chart-meta {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}

	.wc-chart-title {
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #555;
	}

	.wc-chart-unit {
		font-size: 0.68rem;
		color: #444;
	}

	.wc-chart-wrap {
		position: relative;
	}

	.wc-svg {
		display: block;
		width: 100%;
		height: 72px;
	}

	.wc-label-top,
	.wc-label-bot {
		position: absolute;
		right: 0;
		font-size: 0.65rem;
		color: #555;
		line-height: 1;
	}

	.wc-label-top { top: 2px; }
	.wc-label-bot { bottom: 2px; }

	.wc-hr-fallback {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 10px;
		background: rgba(239, 68, 68, 0.07);
		border: 1px solid rgba(239, 68, 68, 0.18);
		border-radius: 8px;
		font-size: 0.78rem;
		color: #d88;
	}

	.wc-hr-fallback-icon {
		flex-shrink: 0;
	}

	.wc-splits {
		margin-top: 2px;
	}

	.wc-splits-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.78rem;
	}

	.wc-splits-table th {
		text-align: left;
		color: #555;
		font-weight: 600;
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 0 6px 4px 0;
	}

	.wc-splits-table td {
		padding: 3px 6px 3px 0;
		color: #aaa;
		border-top: 1px solid #1e1e1e;
	}

	.wc-splits-table tr:first-child td {
		border-top: none;
	}

	.wc-splits-table td:first-child {
		color: #666;
		font-size: 0.72rem;
		width: 2rem;
	}

	.wc-splits-table td:nth-child(2) {
		font-weight: 600;
		color: #ccc;
		font-variant-numeric: tabular-nums;
	}

	.wc-ele-cell {
		display: flex;
		gap: 4px;
	}

	.wc-ele-up { color: #5fba6a; }
	.wc-ele-dn { color: #e07070; }
</style>
