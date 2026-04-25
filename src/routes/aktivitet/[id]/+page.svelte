<script lang="ts">
	import type { PageData } from './$types';
	import { AppPage } from '$lib/components/ui';
	import GpxMap from '$lib/components/charts/GpxMap.svelte';
	import ChatInput from '$lib/components/ui/ChatInput.svelte';
	import TriageCard from '$lib/components/composed/TriageCard.svelte';
	import { tick } from 'svelte';
	import { streamProxyChat } from '$lib/client/proxy-chat-stream';

	let { data }: { data: PageData } = $props();
	const { workout, trackPoints, assessment, healthThemeId } = data;
	const healthGoals: Array<{ title: string; description: string | null }> = (data as any).healthGoals ?? [];

	type Tab = 'detaljer' | 'kart' | 'graf';
	let tab = $state<Tab>('detaljer');

	// Chat
	let conversationId = $state<string | null>(null);
	let isFirstMessage = $state(true);
	let chatMessages = $state<Array<{ role: 'user' | 'assistant'; text: string }>>([]);
	let chatLoading = $state(false);
	let streamingText = $state('');
	let streamingStatus = $state('');
	let messagesEl = $state<HTMLElement | null>(null);

	// Build workout context note injected on the first chat message
	const workoutContextNote = $derived.by(() => {
		const lines: string[] = [
			`Treningsøkt: ${workout.title}`,
			`Dato: ${new Intl.DateTimeFormat('nb-NO', { dateStyle: 'full', timeStyle: 'short' }).format(new Date(workout.timestamp))}`,
		];
		if (workout.distanceKm != null) lines.push(`Distanse: ${workout.distanceKm.toFixed(2)} km`);
		if (workout.durationSeconds != null) lines.push(`Varighet: ${Math.round(workout.durationSeconds / 60)} min`);
		if (workout.paceSecondsPerKm != null) {
			const m = Math.floor(workout.paceSecondsPerKm / 60);
			const s = String(Math.round(workout.paceSecondsPerKm % 60)).padStart(2, '0');
			lines.push(`Tempo: ${m}:${s} /km`);
		}
		if (workout.avgHeartRate != null) lines.push(`Snitt puls: ${Math.round(workout.avgHeartRate)} bpm`);
		if (workout.maxHeartRate != null) lines.push(`Maks puls: ${Math.round(workout.maxHeartRate)} bpm`);
		if (workout.elevationMeters != null) lines.push(`Høydemeter: ${Math.round(workout.elevationMeters)} m`);
		if (assessment) lines.push(`\nVurdering: ${assessment}`);
		if (healthGoals.length > 0) {
			lines.push('\nAktive helsemål:');
			for (const g of healthGoals) {
				lines.push(`- ${g.title}${g.description ? `: ${g.description}` : ''}`);
			}
		}
		return lines.join('\n');
	});

	async function scrollToBottom() {
		await tick();
		if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
	}

	async function sendMessage(text: string) {
		chatMessages = [...chatMessages, { role: 'user', text }];
		chatLoading = true;
		streamingText = '';
		streamingStatus = 'Starter...';
		await scrollToBottom();

		// Inject workout + goals context as a structured attachment on the first message.
		// It gets persisted in conversation history so all follow-up messages have context.
		const attachment = isFirstMessage
			? { url: 'resonans://workout-context', kind: 'other' as const, contentText: workoutContextNote, note: 'Treningsøkt-kontekst' }
			: undefined;
		isFirstMessage = false;

		try {
			const result = await streamProxyChat({
				message: text,
				conversationId,
				attachment,
				onStatus: (s) => { streamingStatus = s; },
				onToken: (t) => { streamingStatus = ''; streamingText += t; scrollToBottom(); }
			});
			conversationId = result.conversationId ?? result.metadata?.conversationId ?? conversationId;
			chatMessages = [
				...chatMessages,
				{ role: 'assistant', text: result.message ?? result.fullMessage ?? streamingText }
			];
			streamingText = '';
		} catch {
			chatMessages = [...chatMessages, { role: 'assistant', text: 'Noe gikk galt.' }];
		} finally {
			chatLoading = false;
			await scrollToBottom();
		}
	}

	// Formatters
	function formatDuration(seconds: number | null) {
		if (!seconds) return '–';
		const h = Math.floor(seconds / 3600);
		const m = Math.floor((seconds % 3600) / 60);
		if (h > 0) return `${h}t ${m}m`;
		return `${m}m`;
	}

	function formatPace(paceSecondsPerKm: number | null) {
		if (!paceSecondsPerKm) return '–';
		const m = Math.floor(paceSecondsPerKm / 60);
		const s = String(Math.round(paceSecondsPerKm % 60)).padStart(2, '0');
		return `${m}:${s} /km`;
	}

	function formatDate(iso: string) {
		return new Intl.DateTimeFormat('nb-NO', {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		}).format(new Date(iso));
	}

	// Chart helpers
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

	interface ChartPoint { x: number; y: number; }

	const chartData = $derived.by(() => {
		if (trackPoints.length < 2) return { hr: [], ele: [], speed: [] };

		// Compute cumulative distances and timestamps
		const cumDist: number[] = [0];
		const times: (number | null)[] = [trackPoints[0].time ? new Date(trackPoints[0].time).getTime() : null];
		for (let i = 1; i < trackPoints.length; i++) {
			const prev = trackPoints[i - 1];
			const cur = trackPoints[i];
			cumDist.push(cumDist[i - 1] + haversine(prev.lat, prev.lon, cur.lat, cur.lon));
			times.push(cur.time ? new Date(cur.time).getTime() : null);
		}
		const totalDist = cumDist[cumDist.length - 1] || 1;

		// HR series
		const hrPts = trackPoints
			.map((p, i) => p.hr != null ? { x: cumDist[i] / totalDist, y: p.hr } : null)
			.filter(Boolean) as ChartPoint[];

		// Elevation series
		const elePts = trackPoints
			.map((p, i) => p.ele != null ? { x: cumDist[i] / totalDist, y: p.ele } : null)
			.filter(Boolean) as ChartPoint[];

		// Speed series (m/s → km/h), between consecutive points
		const speedPts: ChartPoint[] = [];
		for (let i = 1; i < trackPoints.length; i++) {
			const dt = times[i] != null && times[i - 1] != null ? (times[i]! - times[i - 1]!) / 1000 : null;
			const d = cumDist[i] - cumDist[i - 1];
			if (dt && dt > 0 && d >= 0) {
				speedPts.push({ x: cumDist[i] / totalDist, y: (d / dt) * 3.6 });
			}
		}

		return { hr: hrPts, ele: elePts, speed: speedPts };
	});

	function polyline(pts: ChartPoint[], W: number, H: number, pad = 6): string {
		if (pts.length < 2) return '';
		const ys = pts.map(p => p.y);
		const minY = Math.min(...ys), maxY = Math.max(...ys);
		const rangeY = maxY - minY || 1;
		return pts
			.map(p => {
				const x = pad + p.x * (W - pad * 2);
				const y = pad + (1 - (p.y - minY) / rangeY) * (H - pad * 2);
				return `${x.toFixed(1)},${y.toFixed(1)}`;
			})
			.join(' ');
	}

	function yLabel(pts: ChartPoint[], top: boolean): string {
		if (!pts.length) return '';
		const ys = pts.map(p => p.y);
		const v = top ? Math.max(...ys) : Math.min(...ys);
		return Math.round(v).toString();
	}
</script>

<svelte:head>
	<title>{workout.title} – Resonans</title>
</svelte:head>

<AppPage width="full" padding="none" gap="sm" surface="default">
	<div class="backdrop" role="button" tabindex="-1" aria-label="Lukk" onclick={() => history.back()} onkeydown={(e) => e.key === 'Escape' && history.back()}></div>

	<div class="sheet" role="dialog" aria-modal="true" aria-label={workout.title}>
	<div class="handle"></div>

	<header class="sheet-header">
		<button class="back-btn" onclick={() => history.back()} aria-label="Tilbake">
			<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
				<path d="M12 4l-6 6 6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
			</svg>
		</button>
		<div class="header-text">
			<h1>{workout.title}</h1>
			<time>{formatDate(workout.timestamp)}</time>
		</div>
	</header>

	<div class="tabs" role="tablist">
		<button role="tab" aria-selected={tab === 'detaljer'} class:active={tab === 'detaljer'} onclick={() => (tab = 'detaljer')}>Detaljer</button>
		<button role="tab" aria-selected={tab === 'kart'} class:active={tab === 'kart'} onclick={() => (tab = 'kart')}>Kart</button>
		<button role="tab" aria-selected={tab === 'graf'} class:active={tab === 'graf'} onclick={() => (tab = 'graf')}>Graf</button>
	</div>

	<div class="tab-content">
		{#if tab === 'detaljer'}
			<div class="stats">
				{#if workout.distanceKm != null}
					<div class="stat"><span class="label">Distanse</span><span class="value">{workout.distanceKm.toFixed(2)} km</span></div>
				{/if}
				{#if workout.durationSeconds != null}
					<div class="stat"><span class="label">Varighet</span><span class="value">{formatDuration(workout.durationSeconds)}</span></div>
				{/if}
				{#if workout.paceSecondsPerKm != null}
					<div class="stat"><span class="label">Tempo</span><span class="value">{formatPace(workout.paceSecondsPerKm)}</span></div>
				{/if}
				{#if workout.avgHeartRate != null}
					<div class="stat"><span class="label">Snitt puls</span><span class="value">{Math.round(workout.avgHeartRate)} bpm</span></div>
				{/if}
				{#if workout.maxHeartRate != null}
					<div class="stat"><span class="label">Maks puls</span><span class="value">{Math.round(workout.maxHeartRate)} bpm</span></div>
				{/if}
				{#if workout.elevationMeters != null}
					<div class="stat"><span class="label">Høydemeter</span><span class="value">{Math.round(workout.elevationMeters)} m</span></div>
				{/if}
			</div>
			{#if assessment}
				<section class="assessment">
					<p class="assessment-label">Vurdering</p>
					<p>{assessment}</p>
				</section>
			{/if}

		{:else if tab === 'kart'}
			{#if trackPoints.length >= 2}
				<div class="map-wrap">
					<GpxMap points={trackPoints} height={340} />
				</div>
			{:else}
				<p class="no-data">Ingen GPS-data for denne økten.</p>
			{/if}

		{:else if tab === 'graf'}
			{@const W = 560}
			{@const H = 120}
			{#if chartData.hr.length >= 2}
				<div class="chart-block">
					<div class="chart-meta">
						<span class="chart-title">Puls</span>
						<span class="chart-unit">bpm</span>
					</div>
					<div class="chart-wrap">
						<svg viewBox="0 0 {W} {H}" class="chart-svg" aria-hidden="true">
							<polyline points={polyline(chartData.hr, W, H)} fill="none" stroke="#ef4444" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" />
						</svg>
						<span class="chart-label-top">{yLabel(chartData.hr, true)}</span>
						<span class="chart-label-bot">{yLabel(chartData.hr, false)}</span>
					</div>
				</div>
			{/if}
			{#if chartData.ele.length >= 2}
				<div class="chart-block">
					<div class="chart-meta">
						<span class="chart-title">Høyde</span>
						<span class="chart-unit">moh</span>
					</div>
					<div class="chart-wrap">
						<svg viewBox="0 0 {W} {H}" class="chart-svg" aria-hidden="true">
							<polyline points={polyline(chartData.ele, W, H)} fill="none" stroke="#34d399" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" />
						</svg>
						<span class="chart-label-top">{yLabel(chartData.ele, true)}</span>
						<span class="chart-label-bot">{yLabel(chartData.ele, false)}</span>
					</div>
				</div>
			{/if}
			{#if chartData.speed.length >= 2}
				<div class="chart-block">
					<div class="chart-meta">
						<span class="chart-title">Fart</span>
						<span class="chart-unit">km/t</span>
					</div>
					<div class="chart-wrap">
						<svg viewBox="0 0 {W} {H}" class="chart-svg" aria-hidden="true">
							<polyline points={polyline(chartData.speed, W, H)} fill="none" stroke="#60a5fa" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" />
						</svg>
						<span class="chart-label-top">{yLabel(chartData.speed, true)}</span>
						<span class="chart-label-bot">{yLabel(chartData.speed, false)}</span>
					</div>
				</div>
			{/if}
			{#if chartData.hr.length < 2 && chartData.ele.length < 2 && chartData.speed.length < 2}
				<p class="no-data">Ingen graf-data for denne økten.</p>
			{/if}
		{/if}
	</div>

	<div class="chat-section">
		<p class="chat-label">Chat</p>
		<div class="chat-messages" bind:this={messagesEl} aria-live="polite">
			{#if chatMessages.length === 0 && !chatLoading}
				<p class="chat-empty">Spør om denne økten…</p>
			{/if}
			{#each chatMessages as msg}
				{#if msg.role === 'user'}
					<div class="bubble-user">{msg.text}</div>
				{:else}
					<TriageCard text={msg.text} />
				{/if}
			{/each}
			{#if chatLoading}
				{#if streamingText}
					<TriageCard text={streamingText} streaming={true} />
				{:else}
					<TriageCard loading={true} status={streamingStatus} />
				{/if}
			{/if}
		</div>
		<ChatInput
			placeholder="Spør om denne økten…"
			disabled={chatLoading}
			onsubmit={sendMessage}
		/>
	</div>
</div>
</AppPage>

<style>
	:global(.backdrop) {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		z-index: 40;
		cursor: pointer;
	}

	:global(.sheet) {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		top: 5vh;
		z-index: 50;
		background: #111318;
		border-radius: 20px 20px 0 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		animation: slide-up 0.28s cubic-bezier(0.32, 0.72, 0, 1);
	}

	@keyframes slide-up {
		from { transform: translateY(100%); }
		to   { transform: translateY(0); }
	}

	:global(.handle) {
		width: 36px;
		height: 4px;
		background: #333;
		border-radius: 2px;
		margin: 10px auto 0;
		flex-shrink: 0;
	}

	/* Header */
	:global(.sheet-header) {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem 0.5rem;
		flex-shrink: 0;
	}

	:global(.back-btn) {
		background: none;
		border: none;
		color: #888;
		cursor: pointer;
		padding: 0.25rem;
		flex-shrink: 0;
		line-height: 0;
	}

	:global(.header-text) h1 {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 600;
		line-height: 1.2;
		color: #eee;
	}

	:global(.header-text) time {
		font-size: 0.8rem;
		color: #888;
		text-transform: capitalize;
	}

	/* Tabs */
	.tabs {
		display: flex;
		gap: 0;
		padding: 0 1rem;
		border-bottom: 1px solid #1e2632;
		flex-shrink: 0;
	}

	.tabs button {
		background: none;
		border: none;
		color: #666;
		font-size: 0.85rem;
		font-weight: 500;
		padding: 0.6rem 1rem;
		cursor: pointer;
		position: relative;
		transition: color 0.15s;
	}

	.tabs button.active {
		color: #e8e8e8;
	}

	.tabs button.active::after {
		content: '';
		position: absolute;
		bottom: -1px;
		left: 0;
		right: 0;
		height: 2px;
		background: #7c8ef5;
		border-radius: 1px 1px 0 0;
	}

	/* Tab content area — scrollable */
	.tab-content {
		flex: 1;
		overflow-y: auto;
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		min-height: 0;
	}

	/* Stats */
	.stats {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
		gap: 0.6rem;
	}

	.stat {
		background: #1a1f2e;
		border-radius: 10px;
		padding: 0.65rem 0.85rem;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.label {
		font-size: 0.7rem;
		color: #888;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.value {
		font-size: 1.1rem;
		font-weight: 600;
		color: #eee;
	}

	.assessment {
		background: #1a1f2e;
		border-radius: 10px;
		padding: 1rem;
	}

	.assessment-label {
		font-size: 0.7rem;
		color: #888;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: 0 0 0.5rem;
	}

	.assessment p:last-child {
		margin: 0;
		line-height: 1.6;
		font-size: 0.9rem;
		color: #ccc;
	}

	.map-wrap {
		border-radius: 12px;
		overflow: hidden;
	}

	/* Charts */
	.chart-block {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.chart-meta {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
	}

	.chart-title {
		font-size: 0.8rem;
		font-weight: 600;
		color: #aaa;
	}

	.chart-unit {
		font-size: 0.72rem;
		color: #555;
	}

	.chart-wrap {
		position: relative;
	}

	.chart-svg {
		width: 100%;
		height: 80px;
		display: block;
		overflow: visible;
	}

	.chart-label-top,
	.chart-label-bot {
		position: absolute;
		right: 0;
		font-size: 0.65rem;
		color: #666;
	}

	.chart-label-top { top: 0; }
	.chart-label-bot { bottom: 0; }

	.no-data {
		color: #666;
		font-size: 0.85rem;
		text-align: center;
		padding: 2rem 0;
		margin: 0;
	}

	/* Chat */
	.chat-section {
		border-top: 1px solid #1e2632;
		display: flex;
		flex-direction: column;
		max-height: 45vh;
		flex-shrink: 0;
	}

	.chat-label {
		font-size: 0.7rem;
		color: #444;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 0.6rem 1rem 0;
		margin: 0;
		flex-shrink: 0;
	}

	.chat-messages {
		flex: 1;
		overflow-y: auto;
		padding: 0.5rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-height: 0;
	}

	.chat-empty {
		color: #444;
		font-size: 0.85rem;
		margin: 0.5rem 0;
	}

	.bubble-user {
		align-self: flex-end;
		background: #1e2a40;
		color: #d0d8ff;
		font-size: 0.88rem;
		padding: 0.5rem 0.85rem;
		border-radius: 14px 14px 2px 14px;
		max-width: 80%;
		line-height: 1.4;
	}
</style>

