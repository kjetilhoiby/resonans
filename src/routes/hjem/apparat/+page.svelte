<script lang="ts">
	import type { PageData } from './$types';
	import { enhance } from '$app/forms';
	import { AppPage, PageHeader, PageSection } from '$lib/components/ui';

	let { data }: { data: PageData } = $props();

	let remainingMinutes = $state(data.currentEstimateMinutes ? Math.round(data.currentEstimateMinutes) : 60);
	let program = $state('');

	const hours = $derived(Math.floor(remainingMinutes / 60));
	const mins = $derived(remainingMinutes % 60);
	const durationLabel = $derived(
		hours > 0 ? `${hours}t ${mins}min` : `${mins}min`
	);
	const finishLabel = $derived(() => {
		const finish = new Date(Date.now() + remainingMinutes * 60_000);
		return finish.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
	});
</script>

<svelte:head>
	<title>{data.appliance} · Resonans</title>
</svelte:head>

<AppPage>
<PageSection>
<PageHeader title="Apparat" titleHref="/hjem" />
<div class="apparat-content">
	<h1>{data.appliance}</h1>
	{#if data.startedAt}
		<p class="started">Startet {new Date(data.startedAt).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })}</p>
	{/if}

	<form method="POST" use:enhance>
		<input type="hidden" name="sensorId" value={data.sensorId} />
		<input type="hidden" name="cycleId" value={data.cycleId} />
		<input type="hidden" name="appliance" value={data.appliance} />

		<label>
			<span>Program</span>
			<input
				type="text"
				name="program"
				bind:value={program}
				placeholder="f.eks. Bomull 60°"
				autocomplete="off"
			/>
		</label>

		<label>
			<span>Gjenstående tid</span>
			<div class="duration-display">{durationLabel} <span class="finish-time">— ferdig ca. {finishLabel()}</span></div>
			<input
				type="range"
				name="remainingMinutes"
				bind:value={remainingMinutes}
				min="5"
				max="240"
				step="5"
			/>
			<div class="range-labels"><span>5min</span><span>4t</span></div>
		</label>

		<button type="submit">Oppdater</button>
	</form>
</div>
</PageSection>
</AppPage>

<style>
	.apparat-content {
		max-width: 400px;
		margin: 0 auto;
		padding: 2rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}
	h1 {
		margin: 0;
		font-size: 1.4rem;
	}
	.started {
		color: var(--muted, #888);
		margin: 0;
		font-size: 0.9rem;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	label span {
		font-size: 0.85rem;
		font-weight: 500;
	}
	input[type="text"] {
		padding: 0.6rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border, #333);
		background: var(--surface, #1a1a2e);
		color: inherit;
		font: inherit;
		font-size: 1rem;
	}
	input[type="range"] {
		width: 100%;
		accent-color: var(--accent, #4a90e2);
	}
	.duration-display {
		font-size: 1.3rem;
		font-weight: 600;
		text-align: center;
		padding: 0.5rem 0;
	}
	.finish-time {
		font-size: 0.85rem;
		font-weight: 400;
		color: var(--muted, #888);
	}
	.range-labels {
		display: flex;
		justify-content: space-between;
		font-size: 0.75rem;
		color: var(--muted, #888);
	}
	button {
		padding: 0.7rem;
		border-radius: 8px;
		border: 0;
		background: var(--accent, #4a90e2);
		color: white;
		font: inherit;
		font-size: 1rem;
		font-weight: 500;
		cursor: pointer;
	}
</style>
