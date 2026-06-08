<script lang="ts">
	import type { PageData } from './$types';
	import { AppPage, PageHeader } from '$lib/components/ui';

	let { data }: { data: PageData } = $props();

	let labelInputs = $state<Record<string, string>>({});
	let labeling = $state<Record<string, boolean>>({});
	let labeled = $state<Set<string>>(new Set());

	const programSuggestions = $derived(() => {
		const byAppliance: Record<string, string[]> = {};
		for (const p of data.profiles) {
			if (!byAppliance[p.appliance]) byAppliance[p.appliance] = [];
			if (!byAppliance[p.appliance].includes(p.programName)) {
				byAppliance[p.appliance].push(p.programName);
			}
		}
		return byAppliance;
	});

	async function labelCycle(cycleId: string) {
		const programName = labelInputs[cycleId]?.trim();
		if (!programName) return;

		labeling[cycleId] = true;

		try {
			const res = await fetch('/api/apps/ping/label', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ cycleId, programName })
			});

			if (res.ok) {
				labeled = new Set([...labeled, cycleId]);
			}
		} finally {
			labeling[cycleId] = false;
		}
	}

	function formatDuration(minutes: number): string {
		const h = Math.floor(minutes / 60);
		const m = Math.round(minutes % 60);
		if (h > 0) return `${h}t ${m}min`;
		return `${m} min`;
	}

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString('nb-NO', {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit',
			timeZone: 'Europe/Oslo'
		});
	}
</script>

<svelte:head>
	<title>Label sykluser · Resonans</title>
</svelte:head>

<AppPage>
<PageHeader title="Label apparater" backHref="/hjem/apparat" />
<div class="label-content">
	<p class="subtitle">Velg programnavn for ferdige sykluser slik at Resonans kan gjenkjenne dem neste gang.</p>

	{#if data.cycles.length === 0}
		<p class="empty">Ingen ulabelede sykluser.</p>
	{:else}
		<div class="cycles">
			{#each data.cycles as cycle}
				{#if !labeled.has(cycle.cycleId)}
					<div class="cycle-card">
						<div class="cycle-header">
							<strong>{cycle.appliance}</strong>
							<span class="date">{formatDate(cycle.timestamp)}</span>
						</div>
						<div class="cycle-stats">
							{formatDuration(cycle.durationMinutes)} · {cycle.totalKwh} kWh
						</div>
						<div class="label-form">
							<input
								type="text"
								placeholder="Programnavn, f.eks. Bomull 60°"
								bind:value={labelInputs[cycle.cycleId]}
								list="suggestions-{cycle.appliance}"
								disabled={labeling[cycle.cycleId]}
							/>
							<datalist id="suggestions-{cycle.appliance}">
								{#each programSuggestions()[cycle.appliance] ?? [] as suggestion}
									<option value={suggestion}></option>
								{/each}
							</datalist>
							<button
								onclick={() => labelCycle(cycle.cycleId)}
								disabled={labeling[cycle.cycleId] || !labelInputs[cycle.cycleId]?.trim()}
							>
								{labeling[cycle.cycleId] ? '...' : 'Label'}
							</button>
						</div>
					</div>
				{/if}
			{/each}
		</div>
	{/if}
</div>
</AppPage>

<style>
	.label-content {
		max-width: 500px;
		margin: 0 auto;
		padding: 2rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}
	.subtitle {
		color: var(--muted, #888);
		margin: 0;
		font-size: 0.9rem;
	}
	.empty {
		color: var(--muted, #888);
		text-align: center;
		padding: 2rem 0;
	}
	.cycles {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.cycle-card {
		background: var(--surface, #1a1a2e);
		border: 1px solid var(--border, #333);
		border-radius: 10px;
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.cycle-header {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}
	.date {
		font-size: 0.8rem;
		color: var(--muted, #888);
	}
	.cycle-stats {
		font-size: 0.85rem;
		color: var(--muted, #888);
	}
	.label-form {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.25rem;
	}
	.label-form input {
		flex: 1;
		padding: 0.5rem 0.6rem;
		border-radius: 8px;
		border: 1px solid var(--border, #333);
		background: var(--surface-alt, #16162a);
		color: inherit;
		font: inherit;
		font-size: 0.9rem;
	}
	.label-form button {
		padding: 0.5rem 1rem;
		border-radius: 8px;
		border: 0;
		background: var(--accent, #4a90e2);
		color: white;
		font: inherit;
		font-size: 0.9rem;
		font-weight: 500;
		cursor: pointer;
	}
	.label-form button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
