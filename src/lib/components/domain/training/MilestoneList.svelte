<script lang="ts">
	import { setMilestone } from '$lib/client/tracks-api';

	interface Milestone {
		id: string;
		name: string;
		achievedAt: string | null;
		manual: boolean;
	}

	interface Props {
		title: string;
		milestones: Milestone[];
	}

	let { title, milestones }: Props = $props();
</script>

<section class="milestones">
	<h3>{title}</h3>
	<ul>
		{#each milestones as m (m.id)}
			<li class:achieved={m.achievedAt != null}>
				{#if m.manual}
					<button
						type="button"
						class="check"
						data-track="trening:milepael-toggle"
						onclick={() => void setMilestone(m.id, m.achievedAt == null)}
						aria-label={m.achievedAt == null ? `Merk «${m.name}» som nådd` : `Fjern merking av «${m.name}»`}
					>
						{m.achievedAt != null ? '✓' : ''}
					</button>
				{:else}
					<span class="check auto" aria-hidden="true">{m.achievedAt != null ? '✓' : ''}</span>
				{/if}
				<span class="name">{m.name}</span>
				{#if m.achievedAt}
					<span class="date">{new Date(m.achievedAt).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })}</span>
				{/if}
			</li>
		{/each}
	</ul>
</section>

<style>
	.milestones h3 {
		font-size: 0.78rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-tertiary, #777);
		margin: 0 0 0.5rem;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	li {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-size: 0.88rem;
		color: var(--text-secondary, #aaa);
	}

	li.achieved .name {
		color: var(--text-primary, #eee);
	}

	.check {
		width: 20px;
		height: 20px;
		border-radius: 6px;
		border: 1px solid var(--card-border, #242424);
		background: var(--card-bg-inset, #0d0d0d);
		color: var(--accent-light, #7c8ef5);
		font-size: 0.75rem;
		line-height: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		padding: 0;
		flex-shrink: 0;
	}

	.check.auto {
		cursor: default;
	}

	li.achieved .check {
		border-color: var(--accent-primary, #4a5af0);
	}

	.name {
		flex: 1;
	}

	.date {
		font-size: 0.72rem;
		color: var(--text-tertiary, #777);
	}
</style>
