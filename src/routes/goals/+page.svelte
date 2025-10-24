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
				}>;
			}>;
		};
	}

	let { data }: Props = $props();
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
						
						<h2>{goal.title}</h2>
						
						{#if goal.description}
							<p class="description">{goal.description}</p>
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
										<li class="task-item">
											<span class="task-title">{task.title}</span>
											{#if task.frequency}
												<span class="task-frequency">{task.frequency}</span>
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
		align-items: center;
		margin-bottom: 1rem;
		flex-wrap: wrap;
		gap: 0.5rem;
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
		padding: 0.5rem;
		background: #f5f5f5;
		border-radius: 0.5rem;
		margin-bottom: 0.5rem;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.task-title {
		color: #333;
	}

	.task-frequency {
		font-size: 0.85rem;
		color: #999;
		font-style: italic;
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
