<script lang="ts">
	import type { PageData } from './$types';
	import GpxMapSvg from '$lib/components/charts/GpxMapSvg.svelte';

	let { data }: { data: PageData } = $props();
	const { workout, trackPoints, assessment, healthThemeId } = data;

	function formatDuration(seconds: number | null) {
		if (!seconds) return '–';
		const h = Math.floor(seconds / 3600);
		const m = Math.floor((seconds % 3600) / 60);
		const s = seconds % 60;
		if (h > 0) return `${h}t ${m}m`;
		return `${m}m ${s}s`;
	}

	function formatPace(paceSecondsPerKm: number | null) {
		if (!paceSecondsPerKm) return '–';
		const m = Math.floor(paceSecondsPerKm / 60);
		const s = String(Math.round(paceSecondsPerKm % 60)).padStart(2, '0');
		return `${m}:${s} /km`;
	}

	function formatDate(iso: string) {
		return new Intl.DateTimeFormat('nb-NO', {
			weekday: 'long',
			day: 'numeric',
			month: 'long',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		}).format(new Date(iso));
	}

	const chatUrl = $derived(() => {
		if (!healthThemeId) return '/samtaler';
		const url = new URL(`/tema/${healthThemeId}`, window.location.origin);
		url.searchParams.set('tab', 'chat');
		url.searchParams.set('workout', workout.id);
		url.searchParams.set('prompt', workout.chatPrompt);
		return url.toString();
	});
</script>

<svelte:head>
	<title>{workout.title} – Resonans</title>
</svelte:head>

<div class="page">
	<a href="/health" class="back">← Helse</a>

	<header>
		<h1>{workout.title}</h1>
		<time>{formatDate(workout.timestamp)}</time>
	</header>

	{#if trackPoints.length >= 2}
		<div class="map-wrap">
			<GpxMapSvg points={trackPoints} width={600} height={320} />
		</div>
	{/if}

	<div class="stats">
		{#if workout.distanceKm != null}
			<div class="stat">
				<span class="label">Distanse</span>
				<span class="value">{workout.distanceKm.toFixed(2)} km</span>
			</div>
		{/if}
		{#if workout.durationSeconds != null}
			<div class="stat">
				<span class="label">Varighet</span>
				<span class="value">{formatDuration(workout.durationSeconds)}</span>
			</div>
		{/if}
		{#if workout.paceSecondsPerKm != null}
			<div class="stat">
				<span class="label">Tempo</span>
				<span class="value">{formatPace(workout.paceSecondsPerKm)}</span>
			</div>
		{/if}
		{#if workout.avgHeartRate != null}
			<div class="stat">
				<span class="label">Snitt puls</span>
				<span class="value">{Math.round(workout.avgHeartRate)} bpm</span>
			</div>
		{/if}
		{#if workout.maxHeartRate != null}
			<div class="stat">
				<span class="label">Maks puls</span>
				<span class="value">{Math.round(workout.maxHeartRate)} bpm</span>
			</div>
		{/if}
		{#if workout.elevationMeters != null}
			<div class="stat">
				<span class="label">Høydemeter</span>
				<span class="value">{Math.round(workout.elevationMeters)} m</span>
			</div>
		{/if}
	</div>

	{#if assessment}
		<section class="assessment">
			<h2>Vurdering</h2>
			<p>{assessment}</p>
		</section>
	{/if}

	<a href={chatUrl()} class="chat-btn">
		Start samtale om denne økten →
	</a>
</div>

<style>
	.page {
		max-width: 680px;
		margin: 0 auto;
		padding: 1.5rem 1rem 4rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.back {
		color: var(--color-muted, #888);
		text-decoration: none;
		font-size: 0.9rem;
	}

	header h1 {
		margin: 0 0 0.25rem;
		font-size: 1.5rem;
	}

	header time {
		color: var(--color-muted, #888);
		font-size: 0.9rem;
		text-transform: capitalize;
	}

	.map-wrap {
		border-radius: 12px;
		overflow: hidden;
	}

	.map-wrap :global(svg) {
		width: 100%;
		height: auto;
	}

	.stats {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
		gap: 0.75rem;
	}

	.stat {
		background: var(--color-surface, #1a1f2e);
		border-radius: 10px;
		padding: 0.75rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.label {
		font-size: 0.75rem;
		color: var(--color-muted, #888);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.value {
		font-size: 1.2rem;
		font-weight: 600;
	}

	.assessment {
		background: var(--color-surface, #1a1f2e);
		border-radius: 12px;
		padding: 1.25rem;
	}

	.assessment h2 {
		margin: 0 0 0.75rem;
		font-size: 0.85rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-muted, #888);
	}

	.assessment p {
		margin: 0;
		line-height: 1.6;
	}

	.chat-btn {
		display: inline-block;
		background: var(--color-primary, #7c8ef5);
		color: #fff;
		text-decoration: none;
		padding: 0.85rem 1.5rem;
		border-radius: 10px;
		font-weight: 600;
		text-align: center;
	}
</style>
