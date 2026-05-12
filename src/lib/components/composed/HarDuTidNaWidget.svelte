<script lang="ts">
	import { invalidateAll } from '$app/navigation';

	type Suggestion = {
		id: string;
		title: string;
		estimatedMinutes: number | null;
		effort: string | null;
		dueDate: string | null;
		yearlyWindow: string | null;
		projectTitle: string | null;
		reason: string | null;
	};

	let selectedMinutes = $state<number | null>(null);
	let suggestions = $state<Suggestion[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let lastFetchedAt = $state<number | null>(null);

	const slots = [5, 15, 30, 60];

	async function pickSlot(minutes: number) {
		selectedMinutes = minutes;
		loading = true;
		error = null;
		try {
			const res = await fetch(`/api/tasks/pool?available=${minutes}&limit=3`);
			if (!res.ok) {
				error = 'Kunne ikke hente forslag';
				suggestions = [];
				return;
			}
			const data = (await res.json()) as { tasks: Suggestion[] };
			suggestions = data.tasks ?? [];
			lastFetchedAt = Date.now();
		} catch (err) {
			console.error('[har-du-tid] fetch failed', err);
			error = 'Kunne ikke hente forslag';
			suggestions = [];
		} finally {
			loading = false;
		}
	}

	async function action(taskId: string, kind: 'complete' | 'snooze') {
		try {
			if (kind === 'complete') {
				await fetch(`/api/tasks/${taskId}/complete-pool`, { method: 'POST' });
				suggestions = suggestions.filter((s) => s.id !== taskId);
				await invalidateAll();
			} else if (kind === 'snooze') {
				await fetch(`/api/tasks/${taskId}/snooze`, {
					method: 'PATCH',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ days: 1 })
				});
				suggestions = suggestions.filter((s) => s.id !== taskId);
			}
		} catch (err) {
			console.error('[har-du-tid] action failed', err);
		}
	}

	function dueLabel(iso: string | null): string | null {
		if (!iso) return null;
		const target = new Date(`${iso}T00:00:00Z`).getTime();
		const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
		const days = Math.round((target - today) / 86400000);
		if (days < 0) return `Forfalt ${-days}d`;
		if (days === 0) return 'I dag';
		if (days === 1) return 'I morgen';
		if (days <= 7) return `Om ${days}d`;
		return iso;
	}
</script>

<section class="har-du-tid">
	<header>
		<h3>Har du tid nå?</h3>
		<a href="/huskeliste" class="all-link">Hele huskelista →</a>
	</header>

	<div class="slot-row" role="group" aria-label="Velg tilgjengelig tid">
		{#each slots as m (m)}
			<button
				type="button"
				class:active={selectedMinutes === m}
				onclick={() => pickSlot(m)}
				disabled={loading}
			>
				{m < 60 ? `${m} min` : '1 t'}
			</button>
		{/each}
	</div>

	{#if selectedMinutes !== null}
		{#if loading}
			<p class="hint">Finner forslag …</p>
		{:else if error}
			<p class="hint error">{error}</p>
		{:else if suggestions.length === 0}
			<p class="hint">
				Ingen passende oppgaver på huskelista akkurat nå.
				<a href="/huskeliste">Dump inn noe →</a>
			</p>
		{:else}
			<ul class="suggestions">
				{#each suggestions as s (s.id)}
					<li>
						<div class="row">
							<div class="info">
								<div class="title">{s.title}</div>
								<div class="meta">
									{#if s.estimatedMinutes}<span class="chip">{s.estimatedMinutes} min</span>{/if}
									{#if s.effort}<span class="chip">{s.effort}</span>{/if}
									{#if s.dueDate}<span class="chip due">{dueLabel(s.dueDate)}</span>{/if}
									{#if s.projectTitle}<span class="chip project">{s.projectTitle}</span>{/if}
									{#if s.reason}<span class="reason">— {s.reason}</span>{/if}
								</div>
							</div>
						</div>
						<div class="actions">
							<button type="button" class="primary" onclick={() => action(s.id, 'complete')}>Gjør nå</button>
							<button type="button" onclick={() => action(s.id, 'snooze')}>Snooze 1d</button>
							<button type="button" onclick={() => (suggestions = suggestions.filter((x) => x.id !== s.id))}>Skip</button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	{:else}
		<p class="hint">Velg hvor mye tid du har — vi foreslår noe fra huskelista.</p>
	{/if}
</section>

<style>
	.har-du-tid {
		background: var(--bg-card, #fff);
		border: 1px solid var(--border-subtle, #eee);
		border-radius: 14px;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 12px;
	}
	h3 {
		margin: 0;
		font-size: 16px;
		font-weight: 600;
	}
	.all-link {
		font-size: 13px;
		color: var(--text-secondary, #777);
		text-decoration: none;
	}
	.all-link:hover {
		color: var(--accent-primary, #4a5af0);
	}
	.slot-row {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.slot-row button {
		flex: 1 1 auto;
		min-width: 64px;
		padding: 8px 12px;
		border: 1px solid var(--border-color, #ddd);
		background: var(--bg-secondary, #f7f7f7);
		border-radius: 10px;
		font-weight: 500;
		font-size: 14px;
		cursor: pointer;
	}
	.slot-row button.active {
		background: var(--accent-primary, #4a5af0);
		color: white;
		border-color: transparent;
	}
	.slot-row button:disabled {
		opacity: 0.6;
		cursor: progress;
	}
	.hint {
		margin: 4px 0 0;
		color: var(--text-secondary, #777);
		font-size: 13px;
	}
	.hint.error {
		color: #d54545;
	}
	.suggestions {
		list-style: none;
		padding: 0;
		margin: 4px 0 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.suggestions li {
		background: var(--bg-secondary, #f9f9f9);
		border-radius: 10px;
		padding: 10px 12px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.row {
		display: flex;
		align-items: flex-start;
		gap: 12px;
	}
	.info {
		flex: 1;
		min-width: 0;
	}
	.title {
		font-weight: 500;
	}
	.meta {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
		margin-top: 4px;
		align-items: center;
	}
	.chip {
		font-size: 12px;
		padding: 2px 8px;
		background: var(--bg-card, #fff);
		border-radius: 999px;
		color: var(--text-secondary, #555);
		border: 1px solid var(--border-subtle, #eee);
	}
	.chip.due {
		background: rgba(244, 114, 182, 0.15);
		color: #b3306b;
		border-color: transparent;
	}
	.chip.project {
		background: rgba(74, 90, 240, 0.12);
		color: #4a5af0;
		border-color: transparent;
	}
	.reason {
		font-size: 12px;
		color: var(--text-secondary, #777);
	}
	.actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.actions button {
		padding: 6px 10px;
		border: 1px solid var(--border-color, #ddd);
		background: white;
		border-radius: 8px;
		font: inherit;
		font-size: 13px;
		cursor: pointer;
	}
	.actions button.primary {
		background: var(--accent-primary, #4a5af0);
		color: white;
		border-color: transparent;
	}
</style>
