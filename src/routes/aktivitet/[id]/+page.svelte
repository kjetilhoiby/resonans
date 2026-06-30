<script lang="ts">
	import type { PageData } from './$types';
	import { AppPage, PageSection } from '$lib/components/ui';
	import GpxMap from '$lib/components/charts/GpxMap.svelte';
	import TrackProfileChart from '$lib/components/charts/TrackProfileChart.svelte';
	import KmSplitsTable from '$lib/components/charts/KmSplitsTable.svelte';
	import HrDistributionBar from '$lib/components/charts/HrDistributionBar.svelte';
	import ChatInput from '$lib/components/ui/ChatInput.svelte';
	import TriageCard from '$lib/components/composed/TriageCard.svelte';
	import { tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { ChatState } from '$lib/client/chat-state.svelte';
	import {
		cumulativeDistanceMeters,
		hasElevation,
		hasHeartRate
	} from '$lib/utils/track-stats';
	import { isWheeledSport, formatSpeed, paceOrSpeedLabel } from '$lib/utils/activity-metrics';

	let { data }: { data: PageData } = $props();
	const { workout, trackPoints, assessment, healthThemeId } = data;
	const healthGoals: Array<{ title: string; description: string | null }> = (data as any).healthGoals ?? [];

	type Tab = 'detaljer' | 'kart' | 'graf';
	let tab = $state<Tab>('detaljer');

	let messagesEl = $state<HTMLElement | null>(null);

	// Skjul-økt-tilstand (to-stegs bekreftelse — backend setter metadata.dismissed)
	let hiding = $state(false);
	let confirmHide = $state(false);
	let hideError = $state<string | null>(null);
	let confirmTimer: ReturnType<typeof setTimeout> | null = null;

	async function hideWorkout() {
		if (hiding) return;
		if (!confirmHide) {
			confirmHide = true;
			hideError = null;
			confirmTimer = setTimeout(() => { confirmHide = false; }, 3500);
			return;
		}
		if (confirmTimer) { clearTimeout(confirmTimer); confirmTimer = null; }
		confirmHide = false;
		hiding = true;
		hideError = null;
		try {
			const res = await fetch(`/api/workouts/${workout.id}/dismiss`, { method: 'POST' });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			// Naviger til en fersk oversikt slik at den skjulte økten ikke vises fra cache
			if (healthThemeId) {
				await goto(`/tema/${healthThemeId}`, { invalidateAll: true });
			} else {
				history.back();
			}
		} catch {
			hideError = 'Kunne ikke skjule økten. Prøv igjen.';
			hiding = false;
		}
	}

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

	const chat = new ChatState({
		getOrCreateConversationId: async () => null, // samtale opprettes lazy av API
		initialAttachment: { url: 'resonans://workout-context', kind: 'other' as const, contentText: workoutContextNote, note: 'Treningsøkt-kontekst' }
	});

	async function scrollToBottom() {
		await tick();
		if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
	}

	async function sendMessage(text: string) {
		await chat.send(text);
		await scrollToBottom();
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

	interface ChartPoint { x: number; y: number; }

	const totalKm = $derived.by(() => {
		if (trackPoints.length < 2) return 0;
		const cum = cumulativeDistanceMeters(trackPoints);
		return cum[cum.length - 1] / 1000;
	});

	const hrSeries = $derived.by(() => {
		if (trackPoints.length < 2 || !hasHeartRate(trackPoints)) return [] as ChartPoint[];
		const cum = cumulativeDistanceMeters(trackPoints);
		const total = cum[cum.length - 1] || 1;
		const out: ChartPoint[] = [];
		for (let i = 0; i < trackPoints.length; i++) {
			const hr = trackPoints[i].hr;
			if (typeof hr === 'number') out.push({ x: cum[i] / total, y: hr });
		}
		return out;
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

	function formatKm(km: number): string {
		if (km >= 10) return `${km.toFixed(0)} km`;
		return `${km.toFixed(1)} km`;
	}
</script>

<svelte:head>
	<title>{workout.title} – Resonans</title>
</svelte:head>

<AppPage>
	<PageSection>
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
		<button
			class="hide-btn"
			class:confirm={confirmHide}
			onclick={hideWorkout}
			disabled={hiding}
			data-track="aktivitet:skjul-okt"
			aria-label="Skjul økt fra oversikten"
		>
			{#if hiding}
				Skjuler…
			{:else if confirmHide}
				Bekreft skjul
			{:else}
				<svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
					<path d="M2.5 10S5.5 4.5 10 4.5 17.5 10 17.5 10 14.5 15.5 10 15.5 2.5 10 2.5 10z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
					<path d="M4 4l12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
				</svg>
				Skjul
			{/if}
		</button>
	</header>
	{#if hideError}
		<p class="hide-error" role="alert">{hideError}</p>
	{/if}

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
					<div class="stat"><span class="label">{paceOrSpeedLabel(workout.sportType)}</span><span class="value">{isWheeledSport(workout.sportType) ? formatSpeed(workout.paceSecondsPerKm) : formatPace(workout.paceSecondsPerKm)}</span></div>
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
			{#if trackPoints.length < 2}
				<p class="no-data">Ingen graf-data for denne økten.</p>
			{:else}
				<TrackProfileChart points={trackPoints} kind="speed" height={120} showAxes={true} />
				{#if hasElevation(trackPoints)}
					<TrackProfileChart points={trackPoints} kind="elevation" height={100} showAxes={true} />
				{/if}
				{#if hrSeries.length >= 2}
					{@const W = 560}
					{@const H = 120}
					<div class="chart-block">
						<div class="chart-meta">
							<span class="chart-title">Puls</span>
							<span class="chart-unit">bpm</span>
						</div>
						<div class="chart-wrap">
							<svg viewBox="0 0 {W} {H}" class="chart-svg" aria-hidden="true">
								<polyline points={polyline(hrSeries, W, H)} fill="none" stroke="#ef4444" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" />
							</svg>
							<span class="chart-label-top">{yLabel(hrSeries, true)}</span>
							<span class="chart-label-bot">{yLabel(hrSeries, false)}</span>
						</div>
						{#if totalKm > 0}
							<div class="chart-x-axis">
								<span>0</span>
								<span>{formatKm(totalKm / 2)}</span>
								<span>{formatKm(totalKm)}</span>
							</div>
						{/if}
					</div>
				{/if}
				<KmSplitsTable points={trackPoints} sportType={workout.sportType} />
				{#if hasHeartRate(trackPoints)}
					<HrDistributionBar points={trackPoints} />
				{/if}
			{/if}
		{/if}
	</div>

	<div class="chat-section">
		<p class="chat-label">Chat</p>
		<div class="chat-messages" bind:this={messagesEl} aria-live="polite">
			{#if chat.messages.length === 0 && !chat.loading}
				<p class="chat-empty">Spør om denne økten…</p>
			{/if}
			{#each chat.messages as msg (msg.id)}
				{#if msg.role === 'user'}
					<div class="bubble-user">{msg.text}</div>
				{:else}
					<TriageCard text={msg.text} />
				{/if}
			{/each}
			{#if chat.loading}
				{#if chat.streamingText}
					<TriageCard text={chat.streamingText} streaming={true} />
				{:else}
					<TriageCard loading={true} steps={chat.streamingSteps} />
				{/if}
			{/if}
		</div>
		<ChatInput
			placeholder="Spør om denne økten…"
			disabled={chat.loading}
			onsubmit={sendMessage}
		/>
	</div>
</div>
	</PageSection>
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

	.hide-btn {
		margin-left: auto;
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		background: #1a1f2e;
		border: 1px solid #2a2f3e;
		color: #9aa3b5;
		font-size: 0.78rem;
		font-weight: 500;
		padding: 0.4rem 0.7rem;
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.15s;
	}

	.hide-btn:hover:not(:disabled) {
		background: #242a3a;
		color: #c8cedb;
	}

	.hide-btn.confirm {
		background: rgba(239, 68, 68, 0.14);
		border-color: rgba(239, 68, 68, 0.4);
		color: #f87171;
	}

	.hide-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.hide-error {
		margin: 0;
		padding: 0 1rem 0.5rem;
		font-size: 0.78rem;
		color: #f87171;
		flex-shrink: 0;
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

	.chart-x-axis {
		display: flex;
		justify-content: space-between;
		font-size: 0.62rem;
		color: #666;
		padding: 0 0.2rem;
		margin-top: 0.3rem;
	}

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

