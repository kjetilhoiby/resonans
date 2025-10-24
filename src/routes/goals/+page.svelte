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
	<header class="header">
		<div class="header-content">
			<h1>🎯 Dine Mål</h1>
			<a href="/" class="back-link">← Tilbake til chat</a>
		</div>
	</header>

	<main class="content">
		{#if data.goals.length === 0}
			<div class="empty-state">
				<p>Du har ikke opprettet noen mål ennå.</p>
				<p>Gå til chatten og snakk med Resonans AI om hva du ønsker å oppnå!</p>
				<a href="/" class="cta-button">Start chat</a>
			</div>
		{:else}
			<div class="goals-grid">
				{#each data.goals as goal}
					<div class="goal-card">
						<div class="goal-header">
							<div class="goal-badges">
								{#if goal.category}
									<span class="category-badge">
										{goal.category.icon || '📌'} {goal.category.name}
									</span>
								{/if}
								<span class="status-badge status-{goal.status}">
									{goal.status === 'active' ? '🔥 Aktiv' : 
									 goal.status === 'completed' ? '✅ Fullført' :
									 goal.status === 'paused' ? '⏸️ Pauset' : '❌ Avbrutt'}
								</span>
						</div>
						<button 
							class="delete-button" 
							onclick={(e) => { e.preventDefault(); deleteGoal(goal.id, goal.title); }}
							title="Slett mål"
						>
							🗑️
						</button>
					</div>
					
					<h2>{goal.title}</h2>						{#if goal.description}
							<p class="description">{goal.description}</p>
						{/if}

						{#if goal.tasks.length > 0}
							{@const goalProgress = calculateGoalProgress(goal)}
							<div class="progress-bar">
								<div class="progress-fill" style="width: {goalProgress}%"></div>
								<span class="progress-label">{goalProgress}% fullført</span>
							</div>
						{/if}

						{#if goal.targetDate}
							<div class="target-date">
								🗓️ Måldato: {new Date(goal.targetDate).toLocaleDateString('no-NO', { 
									year: 'numeric', 
									month: 'long', 
									day: 'numeric' 
								})}
							</div>
						{/if}

						{#if goal.tasks.length > 0}
							<div class="tasks-section">
								<h3>Oppgaver ({goal.tasks.length})</h3>
								<ul class="tasks-list">
									{#each goal.tasks as task}
										{@const taskProgress = calculateTaskProgress(task)}
										<li class="task-item">
											<div class="task-header">
												<span class="task-title">{task.title}</span>
												{#if task.frequency}
													<span class="task-frequency">{task.frequency}</span>
												{/if}
											</div>
											{#if task.targetValue}
												<div class="task-target">
													Mål: {task.targetValue} {task.unit || ''}
												</div>
											{/if}
											{#if task.progress && task.progress.length > 0}
												<div class="task-progress">
													<div class="task-progress-bar">
														<div class="task-progress-fill" style="width: {taskProgress}%"></div>
													</div>
													<span class="task-progress-label">{taskProgress}%</span>
												</div>
												<div class="progress-entries">
													<strong>Siste registreringer:</strong>
													{#each task.progress.slice(0, 3) as entry}
														<div class="progress-entry">
															<span class="entry-date">
																{new Date(entry.completedAt).toLocaleDateString('no-NO', { 
																	month: 'short', 
																	day: 'numeric' 
																})}
															</span>
															{#if entry.value}
																<span class="entry-value">
																	{entry.value} {task.unit || ''}
																</span>
															{/if}
															{#if entry.note}
																<span class="entry-note">{entry.note}</span>
															{/if}
														</div>
													{/each}
												</div>
											{/if}
										</li>
									{/each}
								</ul>
							</div>
						{/if}

						<div class="goal-footer">
							<span class="created-date">
								Opprettet {new Date(goal.createdAt).toLocaleDateString('no-NO')}
							</span>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</main>
</div>

<style>
	.goals-page {
		min-height: 100vh;
		background: #fafafa;
	}

	.header {
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		color: white;
		padding: 2rem;
		box-shadow: 0 2px 8px rgba(0,0,0,0.1);
	}

	.header-content {
		max-width: 1200px;
		margin: 0 auto;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	h1 {
		margin: 0;
		font-size: 2rem;
	}

	.back-link {
		color: white;
		text-decoration: none;
		padding: 0.5rem 1rem;
		border: 2px solid white;
		border-radius: 0.5rem;
		transition: background 0.2s;
	}

	.back-link:hover {
		background: rgba(255,255,255,0.2);
	}

	.content {
		max-width: 1200px;
		margin: 0 auto;
		padding: 2rem;
	}

	.empty-state {
		text-align: center;
		padding: 4rem 2rem;
		background: white;
		border-radius: 1rem;
		box-shadow: 0 2px 8px rgba(0,0,0,0.1);
	}

	.empty-state p {
		font-size: 1.1rem;
		color: #666;
		margin: 1rem 0;
	}

	.cta-button {
		display: inline-block;
		margin-top: 2rem;
		padding: 1rem 2rem;
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		color: white;
		text-decoration: none;
		border-radius: 0.5rem;
		font-weight: 600;
		transition: opacity 0.2s;
	}

	.cta-button:hover {
		opacity: 0.9;
	}

	.goals-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
		gap: 1.5rem;
	}

	.goal-card {
		background: white;
		border-radius: 1rem;
		padding: 1.5rem;
		box-shadow: 0 2px 8px rgba(0,0,0,0.1);
		transition: transform 0.2s, box-shadow 0.2s;
	}

	.goal-card:hover {
		transform: translateY(-2px);
		box-shadow: 0 4px 16px rgba(0,0,0,0.15);
	}

	.goal-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 1rem;
		gap: 0.5rem;
	}

	.goal-badges {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		flex: 1;
	}

	.delete-button {
		background: transparent;
		border: 1px solid #e0e0e0;
		border-radius: 0.5rem;
		padding: 0.4rem 0.6rem;
		font-size: 1.2rem;
		cursor: pointer;
		transition: all 0.2s;
		line-height: 1;
	}

	.delete-button:hover {
		background: #fee;
		border-color: #f44336;
		transform: scale(1.1);
	}

	.category-badge {
		background: #e3f2fd;
		color: #1976d2;
		padding: 0.25rem 0.75rem;
		border-radius: 1rem;
		font-size: 0.85rem;
		font-weight: 600;
	}

	.status-badge {
		padding: 0.25rem 0.75rem;
		border-radius: 1rem;
		font-size: 0.85rem;
		font-weight: 600;
	}

	.status-active {
		background: #e8f5e9;
		color: #2e7d32;
	}

	.status-completed {
		background: #f3e5f5;
		color: #7b1fa2;
	}

	.status-paused {
		background: #fff3e0;
		color: #ef6c00;
	}

	.goal-card h2 {
		margin: 0 0 1rem 0;
		font-size: 1.5rem;
		color: #333;
	}

	.description {
		color: #666;
		line-height: 1.6;
		margin-bottom: 1rem;
	}

	.target-date {
		background: #fff3e0;
		padding: 0.75rem;
		border-radius: 0.5rem;
		margin: 1rem 0;
		color: #e65100;
		font-weight: 500;
	}

	.tasks-section {
		margin-top: 1.5rem;
		padding-top: 1.5rem;
		border-top: 1px solid #eee;
	}

	.tasks-section h3 {
		margin: 0 0 0.75rem 0;
		font-size: 1rem;
		color: #555;
	}

	.tasks-list {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.task-item {
		padding: 1rem;
		background: #f5f5f5;
		border-radius: 0.5rem;
		margin-bottom: 0.75rem;
	}

	.task-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
	}

	.task-title {
		color: #333;
		font-weight: 500;
	}

	.task-frequency {
		font-size: 0.85rem;
		color: #999;
		font-style: italic;
	}

	.task-target {
		font-size: 0.9rem;
		color: #666;
		margin-bottom: 0.5rem;
	}

	.task-progress {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin: 0.75rem 0;
	}

	.task-progress-bar {
		flex: 1;
		height: 8px;
		background: #e0e0e0;
		border-radius: 4px;
		overflow: hidden;
	}

	.task-progress-fill {
		height: 100%;
		background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
		transition: width 0.3s ease;
	}

	.task-progress-label {
		font-size: 0.85rem;
		color: #666;
		font-weight: 600;
		min-width: 40px;
		text-align: right;
	}

	.progress-entries {
		margin-top: 0.75rem;
		padding-top: 0.75rem;
		border-top: 1px solid #ddd;
		font-size: 0.9rem;
	}

	.progress-entries strong {
		display: block;
		margin-bottom: 0.5rem;
		color: #555;
		font-size: 0.85rem;
	}

	.progress-entry {
		display: flex;
		gap: 0.75rem;
		padding: 0.35rem 0;
		color: #666;
		font-size: 0.85rem;
	}

	.entry-date {
		color: #999;
		min-width: 60px;
	}

	.entry-value {
		font-weight: 600;
		color: #667eea;
	}

	.entry-note {
		color: #666;
		font-style: italic;
	}

	.progress-bar {
		position: relative;
		height: 32px;
		background: #e0e0e0;
		border-radius: 16px;
		overflow: hidden;
		margin: 1rem 0;
	}

	.progress-fill {
		height: 100%;
		background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
		transition: width 0.5s ease;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		padding-right: 12px;
	}

	.progress-label {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		color: #333;
		font-weight: 600;
		font-size: 0.9rem;
		z-index: 1;
	}

	.goal-footer {
		margin-top: 1.5rem;
		padding-top: 1rem;
		border-top: 1px solid #eee;
	}

	.created-date {
		font-size: 0.85rem;
		color: #999;
	}
</style>
