<script lang="ts">
	import type { PageData } from './$types';
	import { enhance } from '$app/forms';
	import { AppPage, Button, PageHeader, PageSection } from '$lib/components/ui';

	let { data }: { data: PageData } = $props();

	const active = $derived(data.snoozes.filter((s) => !s.expired));
	const expired = $derived(data.snoozes.filter((s) => s.expired));

	function formatUntil(s: { until: string | Date; forever: boolean }): string {
		if (s.forever) return 'Permanent';
		const d = typeof s.until === 'string' ? new Date(s.until) : s.until;
		return d.toLocaleString('nb-NO', {
			weekday: 'short',
			day: '2-digit',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

<svelte:head>
	<title>Skjulte forslag – Innstillinger | Resonans</title>
</svelte:head>

<AppPage>
<PageSection>
<PageHeader title="Snoozes" titleHref="/settings" />
<main>
	<p class="lead">
		Når du holder inne en handlings-chip på hjem-skjermen og velger «til i morgen», «til neste
		mandag» eller «skjul permanent», havner den her. Du kan ta dem tilbake når du vil.
	</p>

	{#if data.snoozes.length === 0}
		<p class="empty">Ingen skjulte forslag akkurat nå.</p>
	{:else}
		{#if active.length > 0}
			<section>
				<h2>Aktive</h2>
				<table>
					<thead>
						<tr>
							<th>Forslag</th>
							<th>Skjult til</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{#each active as snooze (snooze.id)}
							<tr class:forever={snooze.forever}>
								<td>
									<div class="label">{snooze.label}</div>
									<div class="chip-id">{snooze.chipId}</div>
								</td>
								<td>{formatUntil(snooze)}</td>
								<td>
									<form method="POST" action="?/clear" use:enhance>
										<input type="hidden" name="chipId" value={snooze.chipId} />
										<Button type="submit">Vis igjen</Button>
									</form>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</section>
		{/if}

		{#if expired.length > 0}
			<section>
				<h2>Utløpt</h2>
				<p class="muted">Disse vil dukke opp som vanlig igjen — du kan rydde dem opp her hvis du vil.</p>
				<table>
					<thead>
						<tr>
							<th>Forslag</th>
							<th>Utløp</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{#each expired as snooze (snooze.id)}
							<tr>
								<td>
									<div class="label">{snooze.label}</div>
									<div class="chip-id">{snooze.chipId}</div>
								</td>
								<td class="muted">{formatUntil(snooze)}</td>
								<td>
									<form method="POST" action="?/clear" use:enhance>
										<input type="hidden" name="chipId" value={snooze.chipId} />
										<Button type="submit" variant="secondary">Fjern</Button>
									</form>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</section>
		{/if}
	{/if}
</main>
</PageSection>
</AppPage>

<style>
	main {
		max-width: 800px;
		margin: 0 auto;
		padding: 0 0 1rem;
	}
	h2 {
		font-size: 1rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-tertiary);
		margin: 1.75rem 0 0.5rem;
	}
	.lead {
		color: var(--text-secondary);
		margin-bottom: 1rem;
	}
	.empty,
	.muted {
		color: var(--text-tertiary);
	}
	.empty {
		font-style: italic;
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	th,
	td {
		text-align: left;
		padding: 0.6rem 0.5rem;
		border-bottom: 1px solid var(--border-subtle);
		font-size: 0.9rem;
		vertical-align: middle;
	}
	th {
		font-size: 0.75rem;
		text-transform: uppercase;
		color: var(--text-tertiary);
		letter-spacing: 0.04em;
	}
	.label {
		font-weight: 500;
		color: var(--text-primary);
	}
	.chip-id {
		font-size: 0.72rem;
		color: var(--text-tertiary);
		font-family: ui-monospace, SFMono-Regular, monospace;
	}
	tr.forever .label::after {
		content: ' · permanent';
		font-weight: 400;
		font-size: 0.78rem;
		color: var(--warning-text);
	}
</style>
