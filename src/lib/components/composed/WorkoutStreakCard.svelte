<script lang="ts">
	interface Props {
		icon: string;
		label: string;
		lastSessionAt: string | null;
		streakDays: number;
		weeklyStats: { weeks: number; count: number; avgPerWeek: number }[];
	}

	let { icon, label, lastSessionAt, streakDays, weeklyStats }: Props = $props();

	let expanded = $state(false);

	function relativeTime(isoString: string): string {
		const date = new Date(isoString);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffDays = Math.floor(diffMs / 86400000);
		if (diffDays === 0) return 'i dag';
		if (diffDays === 1) return 'i går';
		if (diffDays < 7) return `${diffDays} dager siden`;
		if (diffDays < 14) return '1 uke siden';
		if (diffDays < 30) return `${Math.floor(diffDays / 7)} uker siden`;
		return date.toLocaleDateString('no-NO', { day: 'numeric', month: 'short' });
	}

	function weekLabel(weeks: number): string {
		if (weeks === 1) return 'Siste uke';
		if (weeks === 4) return 'Siste 4 uker';
		if (weeks === 12) return 'Siste 12 uker';
		return 'Siste år';
	}

	const lastSessionLabel = $derived(lastSessionAt ? relativeTime(lastSessionAt) : 'ingen registrert');
</script>

<div class="workout-card" class:expanded>
	<button class="workout-summary" onclick={() => (expanded = !expanded)} aria-expanded={expanded}>
		<span class="workout-icon">{icon}</span>
		<span class="workout-label">{label}</span>
		<span class="workout-last">{lastSessionLabel}</span>
		<span class="chevron" class:open={expanded}>›</span>
	</button>

	{#if expanded}
		<div class="workout-details">
			{#if streakDays > 1}
				<div class="streak-badge">🔥 {streakDays} dager på rad</div>
			{:else if streakDays === 1}
				<div class="streak-badge">🔥 Aktiv streak</div>
			{/if}

			<div class="weekly-stats">
				{#each weeklyStats as stat}
					<div class="stat-row">
						<span class="stat-label">{weekLabel(stat.weeks)}</span>
						<span class="stat-count">{stat.count}x</span>
						<span class="stat-avg">{stat.avgPerWeek}/uke</span>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>

<style>
	.workout-card {
		background: #141414;
		border: 1px solid #242424;
		border-radius: 12px;
		overflow: hidden;
		transition: border-color 0.2s;
	}

	.workout-card:hover {
		border-color: #2e2e2e;
	}

	.workout-card.expanded {
		border-color: #333;
	}

	.workout-summary {
		width: 100%;
		background: none;
		border: none;
		padding: 0.85rem 1.25rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		text-align: left;
		color: inherit;
	}

	.workout-summary:hover {
		background: rgba(255, 255, 255, 0.02);
	}

	.workout-icon {
		font-size: 1.2rem;
		flex-shrink: 0;
	}

	.workout-label {
		font-size: 0.95rem;
		font-weight: 500;
		color: #ddd;
		flex: 1;
	}

	.workout-last {
		font-size: 0.8rem;
		color: #555;
	}

	.chevron {
		font-size: 1.2rem;
		color: #444;
		line-height: 1;
		transition: transform 0.2s ease;
		display: inline-block;
		flex-shrink: 0;
	}

	.chevron.open {
		transform: rotate(90deg);
		color: #7c8ef5;
	}

	.workout-details {
		padding: 0.75rem 1.25rem 1rem;
		border-top: 1px solid #1e1e1e;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.streak-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.3rem 0.7rem;
		border-radius: 999px;
		background: rgba(255, 160, 50, 0.12);
		border: 1px solid rgba(255, 160, 50, 0.28);
		color: #ffbe6a;
		font-size: 0.8rem;
		font-weight: 600;
		align-self: flex-start;
	}

	.weekly-stats {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.stat-row {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
	}

	.stat-label {
		font-size: 0.8rem;
		color: #666;
		flex: 1;
	}

	.stat-count {
		font-size: 0.9rem;
		font-weight: 600;
		color: #ccc;
		min-width: 2.5rem;
		text-align: right;
	}

	.stat-avg {
		font-size: 0.78rem;
		color: #555;
		min-width: 3.5rem;
		text-align: right;
	}
</style>
