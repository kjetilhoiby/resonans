<!--
  SensorDashboard — fullskjerm-visning for én sensor-kategori.
  Brukes av /sensor/[type] ruten.

  Viser ekte data via props (lastet server-side).
	Supports: weight | sleep | steps | running | relationship

  Props:
    type        sensor-type: 'weight' | 'sleep' | 'steps' | 'running'
    summary     komplett sensor-summary fra /api/sensor-summary
-->
<script lang="ts">
	import GoalRing from '../ui/GoalRing.svelte';
	import PeriodPills from '../ui/PeriodPills.svelte';

	type SensorType = 'weight' | 'sleep' | 'steps' | 'running' | 'relationship';

	interface SensorSummary {
		weight: { current: number | null; unit: string; delta: number; sparkline: number[] };
		sleep: { current: number | null; unit: string; sparkline: number[] };
		steps: { current: number | null; unit: string; sparkline: number[] };
		running: { weekKm: number; unit: string; sparkline: number[] };
		relationship?: {
			current: number | null;
			unit: string;
			delta: number;
			sparkline: number[];
			revealed?: boolean;
			partnerSubmitted?: boolean;
			mismatchDays14?: number;
			bothNegativeDays14?: number;
			followUpRecommended?: boolean;
		};
	}

	interface Props {
		type: SensorType;
		summary: SensorSummary;
	}

	let { type, summary }: Props = $props();

	const SENSOR_META: Record<SensorType, { label: string; emoji: string; color: string; goal?: number; goalUnit?: string }> = {
		weight: { label: 'Vekt', emoji: '⚖️', color: '#e07070', goal: 88, goalUnit: 'kg' },
		sleep: { label: 'Søvn', emoji: '🌙', color: '#5fa0a0', goal: 7.5, goalUnit: 'h' },
		steps: { label: 'Skritt', emoji: '👟', color: '#82c882', goal: 10000, goalUnit: '/dag' },
		running: { label: 'Løping', emoji: '🏃', color: '#7c8ef5', goal: 30, goalUnit: 'km/uke' },
		relationship: { label: 'Parsjekk', emoji: '💞', color: '#b56ae0', goal: 6, goalUnit: '/7' },
	};

	const meta = $derived(SENSOR_META[type]);

	const currentData = $derived.by(() => {
		if (type === 'weight') {
			return {
				val: summary.weight.current !== null ? String(summary.weight.current) : '–',
				unit: summary.weight.unit,
				sparkline: summary.weight.sparkline,
				delta: summary.weight.delta,
				pct: summary.weight.current !== null && meta.goal
					? Math.max(0, Math.min(100, Math.round((1 - (summary.weight.current - meta.goal!) / meta.goal!) * 100)))
					: 0,
			};
		}
		if (type === 'sleep') {
			return {
				val: summary.sleep.current !== null ? String(summary.sleep.current) : '–',
				unit: summary.sleep.unit,
				sparkline: summary.sleep.sparkline,
				delta: 0,
				pct: summary.sleep.current !== null && meta.goal
					? Math.min(100, Math.round((summary.sleep.current / meta.goal!) * 100))
					: 0,
			};
		}
		if (type === 'steps') {
			return {
				val: summary.steps.current !== null ? summary.steps.current.toLocaleString('nb-NO') : '–',
				unit: summary.steps.unit,
				sparkline: summary.steps.sparkline,
				delta: 0,
				pct: summary.steps.current !== null && meta.goal
					? Math.min(100, Math.round((summary.steps.current / meta.goal!) * 100))
					: 0,
			};
		}
		if (type === 'relationship') {
			const current = summary.relationship?.current ?? null;
			return {
				val: current !== null ? String(current) : '–',
				unit: summary.relationship?.unit || '/7',
				sparkline: summary.relationship?.sparkline || [],
				delta: summary.relationship?.delta || 0,
				pct: current !== null && meta.goal
					? Math.min(100, Math.round((current / meta.goal!) * 100))
					: 0,
			};
		}
		// running
		return {
			val: String(summary.running.weekKm),
			unit: summary.running.unit,
			sparkline: summary.running.sparkline,
			delta: 0,
			pct: meta.goal ? Math.min(100, Math.round((summary.running.weekKm / meta.goal!) * 100)) : 0,
		};
	});

	const data = $derived(currentData);

	const periods = ['uke', 'måned', 'kvartal'] as const;
	let period = $state<(typeof periods)[number]>('uke');

	// Sparkline SVG — mini linjediagram 160×40
	function buildSparkPath(series: number[]): string {
		if (series.length < 2) return '';
		const min = Math.min(...series);
		const max = Math.max(...series);
		const range = max - min || 1;
		const W = 160;
		const H = 40;
		const pts = series.map((v, i) => {
			const x = (i / (series.length - 1)) * W;
			const y = H - ((v - min) / range) * H * 0.85 - H * 0.075;
			return `${x.toFixed(1)},${y.toFixed(1)}`;
		});
		return `M ${pts.join(' L ')}`;
	}

	const sparkPath = $derived(buildSparkPath(data.sparkline));
</script>

<div class="sd-page">
	<!-- Back nav -->
	<a class="sd-back" href="/">← Hjem</a>

	<!-- Header -->
	<header class="sd-header">
		<span class="sd-emoji">{meta.emoji}</span>
		<div>
			<h1 class="sd-title" style="color:{meta.color}">{meta.label}</h1>
			{#if meta.goal}
				<p class="sd-goal">Mål: {meta.goal} {meta.goalUnit}</p>
			{/if}
		</div>
	</header>

	<!-- Sentral ring + nåverdi -->
	<div class="sd-ring-block">
		<GoalRing pct={data.pct} color={meta.color} r={60} strokeWidth={8} size={168}>
			{#snippet children()}
				<text x="84" y="75" text-anchor="middle" fill={meta.color} font-size="24" font-weight="700">
					{data.val}
				</text>
				<text x="84" y="93" text-anchor="middle" fill="#555" font-size="12">
					{data.unit}
				</text>
				<text x="84" y="108" text-anchor="middle" fill="#444" font-size="10">
					{data.pct}%
				</text>
			{/snippet}
		</GoalRing>

		{#if type === 'weight' && data.delta !== 0}
			<p class="sd-delta" style="color:{data.delta < 0 ? '#5fa0a0' : '#e07070'}">
				{data.delta > 0 ? '+' : ''}{data.delta} kg vs forrige uke
			</p>
		{:else if type === 'relationship'}
			<p class="sd-delta" style="color:{(summary.relationship?.followUpRecommended ?? false) ? '#f0b429' : '#5fa0a0'}">
				{summary.relationship?.revealed
					? (summary.relationship?.followUpRecommended
						? `Oppfølging anbefalt (${summary.relationship?.mismatchDays14 || 0} mismatch siste 14 dager)`
						: 'Stabil parsjekk den siste perioden')
						: 'Venter på begge svar for reveal'}
			</p>
		{/if}
	</div>

	<!-- Periodvelger -->
	<div class="sd-period">
		<PeriodPills options={[...periods]} value={period} onchange={(v) => (period = v as typeof period)} />
	</div>

	<!-- Sparkline -->
	{#if data.sparkline.length > 1}
		<div class="sd-spark-block">
			<p class="sd-spark-label">Siste {period === 'uke' ? '7 uker' : period === 'måned' ? '7 måneder' : '7 kvartaler'}</p>
			<svg class="sd-spark" viewBox="0 0 160 40" preserveAspectRatio="none" aria-hidden="true">
				<!-- Fyllt område -->
				<path
					d="{sparkPath} L 160,40 L 0,40 Z"
					fill={meta.color}
					opacity="0.08"
				/>
				<!-- Linje -->
				<path
					d={sparkPath}
					fill="none"
					stroke={meta.color}
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
				<!-- Siste punkt -->
				{#if data.sparkline.length > 0}
					{@const last = data.sparkline.at(-1)!}
					{@const min = Math.min(...data.sparkline)}
					{@const max = Math.max(...data.sparkline)}
					{@const range = max - min || 1}
					{@const cy = 40 - ((last - min) / range) * 40 * 0.85 - 40 * 0.075}
					<circle cx="160" cy={cy} r="3" fill={meta.color} />
				{/if}
			</svg>

			<!-- Tallrad under sparkline -->
			<div class="sd-spark-nums">
				{#each data.sparkline as val}
					<span class="sd-sn">{val}</span>
				{/each}
			</div>
		</div>
	{:else}
		<div class="sd-no-data">
			<p>Ingen historiske data tilgjengelig ennå.</p>
			<p class="sd-no-data-hint">
				{#if type === 'weight' || type === 'sleep' || type === 'steps'}
					Koble til Withings under Innstillinger.
				{:else}
					Synkroniser treningsøkter fra Withings.
				{/if}
			</p>
		</div>
	{/if}

	<!-- Metrikk-rad -->
	<div class="sd-metrics">
		<div class="sd-metric-card">
			<span class="sd-mv" style="color:{meta.color}">{data.val}</span>
			<span class="sd-mu">{data.unit}</span>
			<span class="sd-ml">Siste uke</span>
		</div>
		<div class="sd-metric-card">
			<span class="sd-mv" style="color:#7c8ef5">{data.pct}%</span>
			<span class="sd-ml">Av mål</span>
		</div>
	</div>

	<!-- Chat-knapp -->
	<div class="sd-chat-cta">
		<a class="sd-chat-btn" href="/?chat=1" style="border-color:{meta.color};color:{meta.color}">
			◈ Spør om {meta.label.toLowerCase()}
		</a>
	</div>
</div>

<style>
	.sd-page {
		min-height: 100dvh;
		background: #0f0f0f;
		color: #ccc;
		font-family: 'Inter', system-ui, sans-serif;
		display: flex;
		flex-direction: column;
		padding: 0 0 40px;
	}

	.sd-back {
		display: inline-block;
		padding: 16px 20px;
		color: #444;
		font-size: 0.8rem;
		text-decoration: none;
	}
	.sd-back:hover {
		color: #aaa;
	}

	.sd-header {
		padding: 0 20px 16px;
		display: flex;
		align-items: center;
		gap: 12px;
		border-bottom: 1px solid #1a1a1a;
	}

	.sd-emoji {
		font-size: 2rem;
	}

	.sd-title {
		font-size: 1.4rem;
		font-weight: 700;
		letter-spacing: -0.03em;
		margin: 0 0 2px;
	}

	.sd-goal {
		font-size: 0.72rem;
		color: #444;
		margin: 0;
	}

	.sd-ring-block {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 32px 20px 16px;
		gap: 8px;
	}

	.sd-delta {
		font-size: 0.82rem;
		font-weight: 600;
	}

	.sd-period {
		display: flex;
		justify-content: center;
		padding: 0 20px 16px;
	}

	.sd-spark-block {
		padding: 0 20px 16px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.sd-spark-label {
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #444;
		margin: 0;
	}

	.sd-spark {
		width: 100%;
		height: 60px;
		border-bottom: 1px solid #1a1a1a;
	}

	.sd-spark-nums {
		display: flex;
		justify-content: space-between;
	}

	.sd-sn {
		font-size: 0.6rem;
		color: #444;
	}

	.sd-no-data {
		padding: 24px 20px;
		text-align: center;
		color: #444;
	}

	.sd-no-data p {
		font-size: 0.85rem;
		margin: 0 0 4px;
	}

	.sd-no-data-hint {
		font-size: 0.75rem !important;
		color: #333 !important;
	}

	.sd-metrics {
		display: flex;
		gap: 10px;
		padding: 0 20px 16px;
	}

	.sd-metric-card {
		background: #141414;
		border: 1px solid #222;
		border-radius: 12px;
		padding: 12px 16px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		min-width: 90px;
	}

	.sd-mv {
		font-size: 1.3rem;
		font-weight: 700;
		line-height: 1;
		letter-spacing: -0.02em;
	}

	.sd-mu {
		font-size: 0.62rem;
		color: #444;
	}

	.sd-ml {
		font-size: 0.62rem;
		color: #444;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		margin-top: 2px;
	}

	.sd-chat-cta {
		padding: 24px 20px 0;
		display: flex;
		justify-content: center;
	}

	.sd-chat-btn {
		display: inline-block;
		padding: 10px 24px;
		border: 1px solid;
		border-radius: 99px;
		font-size: 0.82rem;
		text-decoration: none;
		font-weight: 500;
		transition: opacity 0.15s;
	}

	.sd-chat-btn:hover {
		opacity: 0.75;
	}
</style>
