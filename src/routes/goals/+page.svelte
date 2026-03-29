<script lang="ts">
	type GoalTrackMeta = {
		kind?: string | null;
		window?: string | null;
		targetValue?: number | null;
		unit?: string | null;
		durationDays?: number | null;
	};

	type GoalItem = {
		id: string;
		title: string;
		description: string | null;
		status: string;
		targetDate: Date | null;
		metadata: {
			metricId?: string | null;
			goalTrack?: GoalTrackMeta | null;
		} | null;
		createdAt: Date;
		category: {
			name: string;
			icon: string | null;
		} | null;
		tasks: Array<{
			id: string;
			title: string;
			frequency: string | null;
			status: string;
			targetValue: number | null;
			unit: string | null;
			progress: Array<{
				id: string;
				value: number | null;
				note: string | null;
				completedAt: Date;
				activity: {
					id: string;
					type: string;
					completedAt: Date;
					duration: number | null;
					note: string | null;
					metadata: any;
					metrics: Array<{
						id: string;
						metricType: string;
						value: string;
						unit: string | null;
					}>;
				} | null;
			}>;
		}>;
	};

	interface Props {
		data: {
			goals: GoalItem[];
		};
	}

	let { data }: Props = $props();

	function calculateTaskProgress(task: GoalItem['tasks'][number]): number {
		if (!task.targetValue || !task.progress || task.progress.length === 0) {
			return task.progress && task.progress.length > 0 ? 100 : 0;
		}

		const totalValue = task.progress.reduce((sum, entry) => sum + (entry.value || 0), 0);
		return Math.min(Math.round((totalValue / task.targetValue) * 100), 100);
	}

	function calculateGoalProgress(goal: GoalItem): number {
		if (goal.tasks.length === 0) return 0;
		const taskProgresses = goal.tasks.map(calculateTaskProgress);
		const avgProgress = taskProgresses.reduce((sum, pct) => sum + pct, 0) / taskProgresses.length;
		return Math.round(avgProgress);
	}

	function formatGoalTrack(goal: GoalItem): string | null {
		const track = goal.metadata?.goalTrack;
		if (!track || typeof track.targetValue !== 'number') return null;

		const unit = track.unit ? ` ${track.unit}` : '';
		if (track.window === 'custom' && track.durationDays) {
			return `${goal.metadata?.metricId || 'metric'} · ${track.targetValue}${unit} / ${track.durationDays} dager`;
		}

		return `${goal.metadata?.metricId || 'metric'} · ${track.targetValue}${unit} / ${track.window || 'periode'}`;
	}

	async function deleteGoal(goalId: string, goalTitle: string) {
		const confirmed = confirm(`Er du sikker på at du vil slette målet "${goalTitle}"? Dette vil også slette alle oppgaver og fremgang knyttet til målet.`);
		if (!confirmed) return;

		try {
			const response = await fetch(`/goals?id=${goalId}`, {
				method: 'DELETE'
			});
			const result = await response.json();
			if (!response.ok) {
				throw new Error(result.error || 'Kunne ikke slette målet');
			}
			window.location.reload();
		} catch (error) {
			alert(`Feil ved sletting: ${error instanceof Error ? error.message : 'Ukjent feil'}`);
		}
	}
</script>

<div class="goals-page">
	<header class="page-header">
		<div class="header-top">
			<h1>Mål</h1>
			<div class="header-actions">
				<a href="/" class="btn-icon" title="Chat">💬</a>
				<a href="/settings" class="btn-icon" title="Innstillinger">⚙️</a>
			</div>
		</div>
		<div class="header-stats">
			<div class="stat-card">
				<div class="stat-value">{data.goals.filter((goal) => goal.status === 'active').length}</div>
				<div class="stat-label">Aktive mål</div>
			</div>
		</div>
	</header>

	<main class="content">
		{#if data.goals.length === 0}
			<div class="empty-state">
				<div class="empty-icon">🎯</div>
				<p>Ingen mål ennå</p>
				<a href="/" class="btn-primary">Start i chatten</a>
			</div>
		{:else}
			<div class="goals-list">
				{#each data.goals as goal}
					{@const goalProgress = calculateGoalProgress(goal)}
					{@const goalTrackLabel = formatGoalTrack(goal)}
					<div class="goal-card">
						<div class="goal-header">
							<div class="goal-title-row">
								<h2>{goal.title}</h2>
								<button
									class="btn-icon-danger"
									onclick={(event) => {
										event.preventDefault();
										deleteGoal(goal.id, goal.title);
									}}
									title="Slett"
								>
									×
								</button>
							</div>
							{#if goal.category}
								<div class="goal-category">{goal.category.icon || '📌'} {goal.category.name}</div>
							{/if}
							{#if goalTrackLabel}
								<div class="goal-track-pill">{goalTrackLabel}</div>
							{/if}
						</div>

						{#if goal.tasks.length > 0}
							<div class="progress-section">
								<div class="progress-bar">
									<div class="progress-fill" style={`width: ${goalProgress}%`}></div>
								</div>
								<div class="progress-text">{goalProgress}%</div>
							</div>
						{/if}

						{#if goal.targetDate}
							<div class="meta-info">
								🗓️ {goal.targetDate.toLocaleDateString('no-NO', {
									month: 'short',
									day: 'numeric',
									year: 'numeric'
								})}
							</div>
						{/if}

						{#if goal.tasks.length > 0}
							<div class="tasks-section">
								{#each goal.tasks as task}
									{@const taskProgress = calculateTaskProgress(task)}
									<div class="task-card">
										<div class="task-header">
											<div class="task-title">{task.title}</div>
											{#if task.frequency}
												<div class="task-frequency">{task.frequency}</div>
											{/if}
										</div>

										{#if task.targetValue}
											<div class="task-meta">Mål: {task.targetValue} {task.unit || ''}</div>
										{/if}

										{#if task.progress && task.progress.length > 0}
											<div class="task-progress">
												<div class="task-progress-bar">
													<div class="task-progress-fill" style={`width: ${taskProgress}%`}></div>
												</div>
												<div class="task-progress-label">{taskProgress}%</div>
											</div>

											<div class="activity-summary">
												<div class="activity-count">🔥 {task.progress.length}x</div>
												<div class="recent-activities">
													{#each task.progress.slice(0, 3) as entry}
														<span class="activity-dot" title={entry.completedAt.toLocaleDateString('no-NO')}>•</span>
													{/each}
												</div>
											</div>
										{/if}
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</main>
</div>

<style>
	.goals-page {
		min-height: 100vh;
		background: #0f0f0f;
		color: #ccc;
		font-family: 'Inter', system-ui, sans-serif;
	}

	.page-header {
		padding: 1.5rem;
		background: #111;
		border-bottom: 1px solid #1e1e1e;
	}

	.header-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.5rem;
	}

	.page-header h1 {
		font-size: 2rem;
		font-weight: 700;
		margin: 0;
		color: #e8e8e8;
	}

	.header-actions {
		display: flex;
		gap: 0.5rem;
	}

	.header-stats {
		display: flex;
		gap: 1rem;
	}

	.stat-card {
		background: #1a1a1a;
		padding: 1rem 1.5rem;
		border-radius: 12px;
		border: 1px solid #242424;
	}

	.stat-value {
		display: block;
		font-size: 2rem;
		font-weight: 700;
		color: #e8e8e8;
		margin-bottom: 0.25rem;
	}

	.stat-label {
		font-size: 0.85rem;
		color: #666;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.content {
		max-width: 800px;
		margin: 0 auto;
		padding: 1.5rem;
	}

	.empty-state {
		text-align: center;
		padding: 4rem 2rem;
		background: #1a1a1a;
		border-radius: 16px;
		border: 1px solid #242424;
	}

	.empty-icon {
		font-size: 4rem;
		margin-bottom: 1rem;
	}

	.empty-state p {
		color: #888;
		margin-bottom: 2rem;
	}

	.goals-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.goal-card {
		background: #141414;
		border: 1px solid #242424;
		border-radius: 16px;
		padding: 1.5rem;
		transition: all 0.2s;
	}

	.goal-card:hover {
		border-color: #2e2e2e;
		transform: translateY(-2px);
		box-shadow: 0 4px 6px rgba(0, 0, 0, 0.5);
	}

	.goal-header {
		margin-bottom: 1.25rem;
	}

	.goal-title-row {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 0.5rem;
	}

	.goal-card h2 {
		margin: 0;
		font-size: 1.25rem;
		font-weight: 600;
		color: #e8e8e8;
		flex: 1;
	}

	.goal-category {
		font-size: 0.85rem;
		color: #888;
	}

	.goal-track-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.35rem 0.7rem;
		border-radius: 999px;
		background: rgba(124, 142, 245, 0.12);
		border: 1px solid rgba(124, 142, 245, 0.28);
		color: #b9c3ff;
		font-size: 0.76rem;
		margin-top: 0.45rem;
	}

	.progress-section {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	.progress-bar {
		flex: 1;
		height: 8px;
		background: #222;
		border-radius: 4px;
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
		transition: width 0.3s ease;
	}

	.progress-text {
		font-size: 1.25rem;
		font-weight: 600;
		color: #e8e8e8;
		min-width: 60px;
		text-align: right;
	}

	.meta-info {
		font-size: 0.85rem;
		color: #888;
		margin-bottom: 1rem;
	}

	.tasks-section {
		margin-top: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.task-card {
		background: #1a1a1a;
		border: 1px solid #222;
		border-radius: 12px;
		padding: 1rem;
	}

	.task-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
	}

	.task-title {
		color: #ddd;
		font-weight: 500;
		font-size: 0.95rem;
	}

	.task-frequency {
		font-size: 0.75rem;
		color: #555;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.task-meta {
		font-size: 0.85rem;
		color: #888;
		margin-bottom: 0.75rem;
	}

	.task-progress {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin: 0.75rem 0;
	}

	.task-progress-bar {
		flex: 1;
		height: 6px;
		background: #222;
		border-radius: 3px;
		overflow: hidden;
	}

	.task-progress-fill {
		height: 100%;
		background: #7c8ef5;
		transition: width 0.3s ease;
	}

	.task-progress-label {
		font-size: 0.85rem;
		color: #888;
		font-weight: 600;
		min-width: 45px;
		text-align: right;
	}

	.activity-summary {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-top: 0.75rem;
		padding-top: 0.75rem;
		border-top: 1px solid #1e1e1e;
	}

	.activity-count {
		font-size: 0.85rem;
		color: #ddd;
		font-weight: 600;
	}

	.recent-activities {
		display: flex;
		gap: 0.25rem;
	}

	.activity-dot {
		width: 8px;
		height: 8px;
		background: #7c8ef5;
		border-radius: 50%;
		display: inline-block;
	}
</style>
