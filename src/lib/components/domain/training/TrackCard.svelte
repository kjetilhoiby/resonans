<script lang="ts">
	interface MetricRow {
		label: string;
		value: string;
		hint?: string;
	}

	interface Props {
		title: string;
		subtitle?: string;
		/** 0–100: hvor langt løpet har kommet mot målet */
		progressPct: number | null;
		badge?: string;
		rows: MetricRow[];
	}

	let { title, subtitle, progressPct, badge, rows }: Props = $props();
</script>

<section class="track-card">
	<header>
		<div class="title-row">
			<h2>{title}</h2>
			{#if badge}<span class="badge">{badge}</span>{/if}
		</div>
		{#if subtitle}<p class="subtitle">{subtitle}</p>{/if}
	</header>

	{#if progressPct != null}
		<div class="progress" role="progressbar" aria-valuenow={Math.round(progressPct)} aria-valuemin="0" aria-valuemax="100" aria-label="Fremdrift mot mål">
			<div class="bar" style="width: {Math.max(2, Math.min(100, progressPct))}%"></div>
		</div>
	{/if}

	<dl class="metrics">
		{#each rows as row (row.label)}
			<div class="metric">
				<dt>{row.label}</dt>
				<dd>
					{row.value}
					{#if row.hint}<span class="hint">{row.hint}</span>{/if}
				</dd>
			</div>
		{/each}
	</dl>
</section>

<style>
	.track-card {
		background: var(--card-bg-subtle, #141414);
		border: 1px solid var(--card-border, #242424);
		border-radius: var(--card-radius, 16px);
		padding: var(--card-padding, 16px);
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	header {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.title-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
	}

	h2 {
		font-size: 1.05rem;
		font-weight: 700;
		color: var(--text-primary, #eee);
		margin: 0;
	}

	.badge {
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--accent-light, #7c8ef5);
		background: color-mix(in srgb, var(--accent-primary, #4a5af0) 18%, transparent);
		border-radius: 999px;
		padding: 0.15rem 0.6rem;
		white-space: nowrap;
	}

	.subtitle {
		font-size: 0.82rem;
		color: var(--text-secondary, #aaa);
		margin: 0;
	}

	.progress {
		height: 6px;
		border-radius: 999px;
		background: var(--card-bg-inset, #0d0d0d);
		overflow: hidden;
	}

	.bar {
		height: 100%;
		border-radius: 999px;
		background: var(--accent-primary, #4a5af0);
		transition: width 0.4s ease;
	}

	.metrics {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
		gap: 0.75rem;
		margin: 0;
	}

	.metric dt {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-tertiary, #777);
	}

	.metric dd {
		font-size: 1.05rem;
		font-weight: 650;
		color: var(--text-primary, #eee);
		margin: 0.1rem 0 0;
	}

	.hint {
		display: block;
		font-size: 0.72rem;
		font-weight: 400;
		color: var(--text-secondary, #aaa);
	}
</style>
