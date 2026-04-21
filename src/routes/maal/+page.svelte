<script lang="ts">
	import { page } from '$app/stores';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type Series = (typeof data.allSeries)[number];
	type Task = (typeof data.goals)[number]['tasks'][number];
	type Goal = (typeof data.goals)[number];

	let goalsLocal = $state<Goal[]>([...data.goals]);
	let deletingId = $state<string | null>(null);
	let expandedId = $state<string | null>(null);
	let linkingTaskId = $state<string | null>(null);
	let savingLink = $state<string | null>(null);
	let assigningThemeGoalId = $state<string | null>(null);

	const active = $derived(goalsLocal.filter((g) => g.status === 'active'));
	const other = $derived(goalsLocal.filter((g) => g.status !== 'active'));

	async function deleteGoal(goalId: string) {
		if (deletingId) return;
		deletingId = goalId;
		try {
			const res = await fetch(`/api/goals/${goalId}`, { method: 'DELETE' });
			if (res.ok) {
				goalsLocal = goalsLocal.filter((g) => g.id !== goalId);
			}
		} finally {
			deletingId = null;
		}
	}

	async function linkSeries(task: Task, seriesId: string | null) {
		if (savingLink) return;
		savingLink = task.id;
		try {
			const res = await fetch(`/api/tracking-series/link-task`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ taskId: task.id, seriesId })
			});
			if (res.ok) {
				// Refresh: update local task's trackingSeries list
				const matched = seriesId ? data.allSeries.find((s) => s.id === seriesId) : null;
				goalsLocal = goalsLocal.map((g) => ({
					...g,
					tasks: g.tasks.map((t) => {
						if (t.id !== task.id) return t;
						return {
							...t,
							trackingSeries: matched ? [{ ...matched }] : []
						};
					})
				}));
			}
		} finally {
			savingLink = null;
			linkingTaskId = null;
		}
	}

	async function assignTheme(goalId: string, themeId: string) {
		if (!themeId || assigningThemeGoalId) return;
		assigningThemeGoalId = goalId;
		try {
			const res = await fetch(`/api/goals/${goalId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ themeId })
			});
			if (!res.ok) return;
			const selectedTheme = data.themes.find((t) => t.id === themeId);
			if (!selectedTheme) return;
			goalsLocal = goalsLocal.map((g) =>
				g.id === goalId
					? {
						...g,
						theme: { name: selectedTheme.name, emoji: selectedTheme.emoji }
					}
					: g
			);
		} finally {
			assigningThemeGoalId = null;
		}
	}

	function getWeeklyTasks(goal: Goal): Task[] {
		return goal.tasks.filter((t) => t.frequency === 'weekly' || t.frequency === 'daily');
	}

	function seriesLabel(series: Series) {
		const rt = series.recordType as { label?: string; key?: string } | null | undefined;
		return series.title || rt?.label || rt?.key || series.id;
	}

	function intentBadge(task: Task): string | null {
		const meta = task.metadata as Record<string, unknown> | null;
		if (!meta) return null;
		const status = meta.intentStatus as string | undefined;
		if (status === 'parsed') return '✓ Kobles til signal';
		if (status === 'failed') return '⚠ Ingen signal';
		if (status === 'pending') return '⏳ Analyseres…';
		return null;
	}
</script>

<div class="maal-page">
	<header class="maal-header">
		<h1>Mål</h1>
	</header>

	{#if active.length === 0 && other.length === 0}
		<p class="empty">Ingen mål ennå. Start en samtale for å opprette ett.</p>
	{:else}
		{#each [{ label: 'Aktive', list: active }, { label: 'Tidligere', list: other }] as section}
			{#if section.list.length > 0}
				<section class="goal-section">
					<h2 class="section-label">{section.label}</h2>
					<ul class="goal-list" role="list">
						{#each section.list as goal}
							{@const isExpanded = expandedId === goal.id}
							{@const weeklyTasks = getWeeklyTasks(goal)}
							<li class="goal-item" class:expanded={isExpanded}>
								<div class="goal-row">
									<button
										class="goal-toggle"
										onclick={() => (expandedId = isExpanded ? null : goal.id)}
										aria-expanded={isExpanded}
									>
										<span class="goal-title">{goal.title}</span>
										{#if goal.theme}
											{@const theme = goal.theme as { emoji: string | null; name: string }}
											<span class="goal-meta">{theme.emoji ?? ''} {theme.name}</span>
										{:else if goal.category}
											{@const category = goal.category as { name: string }}
											<span class="goal-meta">{category.name}</span>
											<span class="goal-meta-warning">Ikke koblet til tema</span>
										{/if}
									</button>
									<button
										class="delete-btn"
										onclick={() => deleteGoal(goal.id)}
										disabled={deletingId === goal.id}
										aria-label="Slett mål"
									>
										{deletingId === goal.id ? '…' : '✕'}
									</button>
								</div>

								{#if isExpanded}
									<div class="goal-detail">
										{#if goal.description}
											<p class="goal-desc">{goal.description}</p>
										{/if}

										{#if !goal.theme}
											<div class="theme-assign-row">
												<span class="tasks-label">Koble mål til tema</span>
												<select
													class="series-select"
													disabled={assigningThemeGoalId === goal.id}
													onchange={(e) => assignTheme(goal.id, (e.currentTarget as HTMLSelectElement).value)}
												>
													<option value="">Velg tema…</option>
													{#each data.themes as themeOption}
														<option value={themeOption.id}>{themeOption.emoji ?? ''} {themeOption.name}</option>
													{/each}
												</select>
											</div>
										{/if}

										{#if weeklyTasks.length > 0}
											<div class="tasks-section">
												<span class="tasks-label">Sporbare oppgaver</span>
												{#each weeklyTasks as task}
													{@const linked = task.trackingSeries?.[0] ?? null}
													{@const badge = intentBadge(task)}
													<div class="task-row">
														<span class="task-title">{task.title}</span>
														{#if badge}
															<span class="intent-badge" class:parsed={badge.startsWith('✓')} class:failed={badge.startsWith('⚠')}>{badge}</span>
														{/if}

														{#if linkingTaskId === task.id}
															<div class="series-picker">
																<select
																	class="series-select"
																	disabled={savingLink === task.id}
																	onchange={(e) => linkSeries(task, (e.currentTarget as HTMLSelectElement).value || null)}
																>
																	<option value="">— ingen kobling —</option>
																	{#each data.allSeries as s}
																		<option value={s.id} selected={linked?.id === s.id}>
																			{seriesLabel(s)}
																		</option>
																	{/each}
																</select>
																<button class="cancel-link" onclick={() => (linkingTaskId = null)}>Avbryt</button>
															</div>
														{:else}
															<div class="series-row">
																{#if linked}
																	<span class="series-chip">{seriesLabel(linked)}</span>
																{:else}
																	<span class="no-series">Ingen metrikk</span>
																{/if}
																<button
																	class="edit-link"
																	onclick={() => (linkingTaskId = task.id)}
																>
																	{linked ? 'Bytt' : 'Koble'}
																</button>
															</div>
														{/if}
													</div>
												{/each}
											</div>
										{/if}
									</div>
								{/if}
							</li>
						{/each}
					</ul>
				</section>
			{/if}
		{/each}
	{/if}
</div>

<nav class="bottom-nav" aria-label="Navigasjon">
	<a href="/" class="nav-item" class:active={$page.url.pathname === '/'}>
		<span class="nav-icon">⬡</span>
		<span class="nav-label">Hjem</span>
	</a>
	<a href="/maal" class="nav-item" class:active={$page.url.pathname === '/maal'} aria-current="page">
		<span class="nav-icon">◎</span>
		<span class="nav-label">Mål</span>
	</a>
	<a href="/economics" class="nav-item" class:active={$page.url.pathname.startsWith('/economics')}>
		<span class="nav-icon">◈</span>
		<span class="nav-label">Økonomi</span>
	</a>
	<a href="/settings" class="nav-item" class:active={$page.url.pathname === '/settings'}>
		<span class="nav-icon">⚙</span>
		<span class="nav-label">Innstillinger</span>
	</a>
</nav>

<style>
	.maal-page {
		min-height: 100dvh;
		background: #0f0f0f;
		color: #ccc;
		padding: 0 0 72px;
		max-width: 480px;
		margin: 0 auto;
	}

	.maal-header {
		padding: 20px 20px 12px;
		border-bottom: 1px solid #1e1e1e;
		position: sticky;
		top: 0;
		background: #0f0f0f;
		z-index: 10;
	}

	h1 {
		font-size: 1.3rem;
		font-weight: 700;
		color: #eee;
		margin: 0;
	}

	.goal-section {
		padding: 20px 16px 0;
	}

	.section-label {
		font-size: 0.75rem;
		color: #555;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		margin: 0 0 10px;
	}

	.goal-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.goal-item {
		background: #1a1a1a;
		border: 1px solid #252525;
		border-radius: 12px;
		overflow: hidden;
	}

	.goal-item.expanded {
		border-color: #333;
	}

	.goal-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.goal-toggle {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		padding: 14px 16px;
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
	}

	.goal-title {
		font-size: 0.95rem;
		font-weight: 600;
		color: #e0e0e0;
		line-height: 1.3;
	}

	.goal-meta {
		font-size: 0.72rem;
		color: #555;
	}

	.goal-meta-warning {
		font-size: 0.7rem;
		color: #b57943;
	}

	.delete-btn {
		flex-shrink: 0;
		width: 32px;
		height: 32px;
		margin-right: 12px;
		background: none;
		border: 1px solid #2e2e2e;
		border-radius: 6px;
		color: #555;
		cursor: pointer;
		font-size: 0.8rem;
		transition: color 0.15s, border-color 0.15s;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.delete-btn:hover {
		color: #e07070;
		border-color: #e07070;
	}

	.delete-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}

	/* ─ Expanded detail ─ */

	.goal-detail {
		padding: 0 16px 14px;
		border-top: 1px solid #222;
	}

	.goal-desc {
		font-size: 0.82rem;
		color: #666;
		margin: 10px 0 12px;
		line-height: 1.5;
	}

	.tasks-section {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-top: 8px;
	}

	.theme-assign-row {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-top: 8px;
	}

	.tasks-label {
		font-size: 0.68rem;
		color: #444;
		text-transform: uppercase;
		letter-spacing: 0.07em;
	}

	.task-row {
		background: #141414;
		border: 1px solid #272727;
		border-radius: 8px;
		padding: 10px 12px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.task-title {
		font-size: 0.85rem;
		color: #ccc;
	}

	.intent-badge {
		font-size: 0.7rem;
		color: #555;
	}

	.intent-badge.parsed {
		color: #6db36d;
	}

	.intent-badge.failed {
		color: #c87a50;
	}

	.series-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.series-chip {
		font-size: 0.75rem;
		background: #242424;
		border: 1px solid #333;
		border-radius: 20px;
		padding: 2px 10px;
		color: #7c8ef5;
	}

	.no-series {
		font-size: 0.75rem;
		color: #3a3a3a;
	}

	.edit-link {
		font-size: 0.72rem;
		color: #555;
		background: none;
		border: 1px solid #2a2a2a;
		border-radius: 4px;
		padding: 2px 8px;
		cursor: pointer;
		transition: color 0.15s;
	}

	.edit-link:hover {
		color: #7c8ef5;
	}

	.series-picker {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.series-select {
		flex: 1;
		background: #1e1e1e;
		border: 1px solid #333;
		border-radius: 6px;
		color: #ccc;
		font-size: 0.8rem;
		padding: 4px 6px;
	}

	.cancel-link {
		font-size: 0.72rem;
		color: #555;
		background: none;
		border: none;
		cursor: pointer;
	}

	.cancel-link:hover {
		color: #ccc;
	}

	.empty {
		padding: 60px 20px;
		text-align: center;
		color: #555;
		font-size: 0.9rem;
	}

	/* ─ Bottom nav ─ */
	.bottom-nav {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		display: flex;
		justify-content: space-around;
		align-items: center;
		padding: 8px 0 env(safe-area-inset-bottom, 10px);
		border-top: 1px solid #1e1e1e;
		background: #0f0f0f;
		z-index: 20;
	}

	.nav-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
		color: #444;
		text-decoration: none;
		flex: 1;
		padding: 6px 0;
		transition: color 0.15s;
	}

	.nav-item.active {
		color: #7c8ef5;
	}

	.nav-icon {
		font-size: 1.1rem;
		line-height: 1;
	}

	.nav-label {
		font-size: 0.62rem;
		letter-spacing: 0.03em;
	}
</style>
