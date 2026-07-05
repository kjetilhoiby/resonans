<script lang="ts">
	interface HistoryEntry {
		date: string;
		label: string;
		detail: string;
	}

	interface Props {
		title: string;
		entries: HistoryEntry[];
		emptyText?: string;
	}

	let { title, entries, emptyText = 'Ingen økter registrert ennå.' }: Props = $props();

	function fmtDate(iso: string): string {
		return new Date(`${iso}T12:00:00Z`).toLocaleDateString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short' });
	}
</script>

<section class="history">
	<h3>{title}</h3>
	{#if entries.length === 0}
		<p class="empty">{emptyText}</p>
	{:else}
		<ul>
			{#each entries as entry, i (entry.date + i)}
				<li>
					<span class="date">{fmtDate(entry.date)}</span>
					<span class="label">{entry.label}</span>
					<span class="detail">{entry.detail}</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.history h3 {
		font-size: 0.78rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-tertiary, #777);
		margin: 0 0 0.5rem;
	}

	.empty {
		font-size: 0.85rem;
		color: var(--text-tertiary, #777);
		margin: 0;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	li {
		display: grid;
		grid-template-columns: 90px 1fr auto;
		gap: 0.6rem;
		font-size: 0.85rem;
		align-items: baseline;
	}

	.date {
		color: var(--text-tertiary, #777);
		font-size: 0.78rem;
	}

	.label {
		color: var(--text-primary, #eee);
	}

	.detail {
		color: var(--text-secondary, #aaa);
		font-variant-numeric: tabular-nums;
	}
</style>
