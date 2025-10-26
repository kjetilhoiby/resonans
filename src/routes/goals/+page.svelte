<script lang="ts">
	interface Props {
		data: {
			goals: Array<{
				id: string;
				title: string;
				description: string | null;
				status: string;
				targetDate: Date | null;
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
			}>;
		};
	}

	let { data }: Props = $props();

	// Beregn progresjon for en oppgave
	function calculateTaskProgress(task: any): number {
		if (!task.targetValue || !task.progress || task.progress.length === 0) {
			return task.progress && task.progress.length > 0 ? 100 : 0;
		}
		const totalValue = task.progress.reduce((sum: number, p: any) => sum + (p.value || 0), 0);
		return Math.min(Math.round((totalValue / task.targetValue) * 100), 100);
	}

	// Beregn total progresjon for et mål
	function calculateGoalProgress(goal: any): number {
		if (goal.tasks.length === 0) return 0;
		const taskProgresses = goal.tasks.map(calculateTaskProgress);
		const avgProgress = taskProgresses.reduce((sum: number, p: number) => sum + p, 0) / taskProgresses.length;
		return Math.round(avgProgress);
	}

	async function deleteGoal(goalId: string, goalTitle: string) {
		console.log('deleteGoal called with:', goalId, goalTitle);
		
		const confirmed = confirm(`Er du sikker på at du vil slette målet "${goalTitle}"? Dette vil også slette alle oppgaver og fremgang knyttet til målet.`);
		console.log('User confirmed:', confirmed);
		
		if (!confirmed) {
			return;
		}

		try {
			console.log('Sending DELETE request...');
			const response = await fetch(`/goals?id=${goalId}`, {
				method: 'DELETE'
			});

			const result = await response.json();
			console.log('Response:', response.status, result);

			if (!response.ok) {
				throw new Error(result.error || 'Kunne ikke slette målet');
			}

			// Reload page to show updated goals list
			window.location.reload();
		} catch (error) {
			console.error('Delete error:', error);
			alert(`Feil ved sletting: ${error instanceof Error ? error.message : 'Ukjent feil'}`);
		}
	}
</script>

<div class="goals-page">
	<header class="page-header">
		<div class="header-top">
			<h1>Mål</h1>
			<div class="header-actions">
				<a href="/" class="icon-button" title="Chat">💬</a>
				<a href="/settings" class="icon-button" title="Innstillinger">⚙️</a>
			</div>
		</div>
		<div class="header-stats">
			<div class="stat-card">
				<div class="stat-value">{data.goals.filter(g => g.status === 'active').length}</div>
				<div class="stat-label">Aktive mål</div>
			</div>
		</div>
	</header>

	<main class="content">
		{#if data.goals.length === 0}
			<div class="empty-state">
				<div class="empty-icon">🎯</div>
				<p>Ingen mål ennå</p>
				<a href="/" class="primary-button">Start i chatten</a>
			</div>
		{:else}
			<div class="goals-list">
				{#each data.goals as goal}
					{@const goalProgress = calculateGoalProgress(goal)}
					<div class="goal-card">
						<div class="goal-header">
							<div class="goal-title-row">
								<h2>{goal.title}</h2>
								<button 
									class="delete-button" 
									onclick={(e) => { e.preventDefault(); deleteGoal(goal.id, goal.title); }}
									title="Slett"
								>×</button>
							</div>
							{#if goal.category}
								<div class="goal-category">{goal.category.icon || '📌'} {goal.category.name}</div>
							{/if}
						</div>

						{#if goal.tasks.length > 0}
							<div class="progress-section">
								<div class="progress-bar">
									<div class="progress-fill" style="width: {goalProgress}%"></div>
								</div>
								<div class="progress-text">{goalProgress}%</div>
							</div>
						{/if}

						{#if goal.targetDate}
							<div class="meta-info">
								🗓️ {new Date(goal.targetDate).toLocaleDateString('no-NO', { 
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
											<div class="task-meta">
												Mål: {task.targetValue} {task.unit || ''}
											</div>
										{/if}

										{#if task.progress && task.progress.length > 0}
											<div class="task-progress">
												<div class="task-progress-bar">
													<div class="task-progress-fill" style="width: {taskProgress}%"></div>
												</div>
												<div class="task-progress-label">{taskProgress}%</div>
											</div>

											<div class="activity-summary">
												<div class="activity-count">🔥 {task.progress.length}x</div>
												<div class="recent-activities">
													{#each task.progress.slice(0, 3) as entry}
														<span class="activity-dot" title={new Date(entry.completedAt).toLocaleDateString('no-NO')}>•</span>
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
		background: var(--bg-primary);
		color: var(--text-primary);
	}

	.page-header {
		padding: 1.5rem;
		background: var(--bg-header);
		border-bottom: 1px solid var(--border-color);
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
		color: var(--text-primary);
	}

	.header-actions {
		display: flex;
		gap: 0.5rem;
	}

	.icon-button {
		width: 44px;
		height: 44px;
		border-radius: 50%;
		background: var(--bg-card);
		border: 1px solid var(--border-color);
		display: flex;
		align-items: center;
		justify-content: center;
		text-decoration: none;
		font-size: 1.2rem;
		transition: all 0.2s;
		color: var(--text-primary);
	}

	.icon-button:hover {
		background: var(--bg-hover);
		transform: scale(1.05);
	}

	.header-stats {
		display: flex;
		gap: 1rem;
	}

	.stat-card {
		background: var(--bg-card);
		padding: 1rem 1.5rem;
		border-radius: 12px;
		border: 1px solid var(--border-color);
	}

	.stat-value {
		display: block;
		font-size: 2rem;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 0.25rem;
	}

	.stat-label {
		font-size: 0.85rem;
		color: var(--text-tertiary);
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
		background: var(--bg-card);
		border-radius: 16px;
		border: 1px solid var(--border-color);
	}

	.empty-icon {
		font-size: 4rem;
		margin-bottom: 1rem;
	}

	.empty-state p {
		color: var(--text-secondary);
		margin-bottom: 2rem;
	}

	.primary-button {
		display: inline-block;
		padding: 0.875rem 1.75rem;
		background: var(--accent-primary);
		color: white;
		text-decoration: none;
		border-radius: 12px;
		font-weight: 600;
		transition: all 0.2s;
	}

	.primary-button:hover {
		background: var(--accent-hover);
	}

	.goals-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.goal-card {
		background: var(--bg-card);
		border: 1px solid var(--border-color);
		border-radius: 16px;
		padding: 1.5rem;
		transition: all 0.2s;
	}

	.goal-card:hover {
		border-color: var(--border-subtle);
		transform: translateY(-2px);
		box-shadow: var(--shadow-md);
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
		color: var(--text-primary);
		flex: 1;
	}

	.delete-button {
		background: transparent;
		border: 1px solid var(--border-color);
		color: var(--text-tertiary);
		width: 32px;
		height: 32px;
		border-radius: 50%;
		font-size: 1.5rem;
		cursor: pointer;
		transition: all 0.2s;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		line-height: 1;
	}

	.delete-button:hover {
		background: var(--error-bg);
		border-color: var(--error-text);
		color: var(--error-text);
	}

	.goal-category {
		font-size: 0.85rem;
		color: var(--text-secondary);
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
		background: var(--bg-hover);
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
		color: var(--text-primary);
		min-width: 60px;
		text-align: right;
	}

	.meta-info {
		font-size: 0.85rem;
		color: var(--text-secondary);
		margin-bottom: 1rem;
	}

	.tasks-section {
		margin-top: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.task-card {
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
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
		color: var(--text-primary);
		font-weight: 500;
		font-size: 0.95rem;
	}

	.task-frequency {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.task-meta {
		font-size: 0.85rem;
		color: var(--text-secondary);
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
		background: var(--bg-hover);
		border-radius: 3px;
		overflow: hidden;
	}

	.task-progress-fill {
		height: 100%;
		background: var(--accent-primary);
		transition: width 0.3s ease;
	}

	.task-progress-label {
		font-size: 0.85rem;
		color: var(--text-secondary);
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
		border-top: 1px solid var(--border-subtle);
	}

	.activity-count {
		font-size: 0.85rem;
		color: var(--text-primary);
		font-weight: 600;
	}

	.recent-activities {
		display: flex;
		gap: 0.25rem;
	}

	.activity-dot {
		width: 8px;
		height: 8px;
		background: var(--accent-primary);
		border-radius: 50%;
		display: inline-block;
	}
</style>
