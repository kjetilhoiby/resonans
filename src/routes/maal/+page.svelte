<script lang="ts">
	import GoalCard from '$lib/components/composed/GoalCard.svelte';
	import { page } from '$app/stores';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Optimistisk lokal oppdatering av progress
	type AnyProgress = { id: string; completedAt: Date };
	let goalsLocal = $state(
		data.goals.map((g) => ({
			...g,
			tasks: g.tasks.map((t) => ({ ...t, progress: t.progress as AnyProgress[] }))
		}))
	);

	async function logProgress(taskId: string) {
		// Optimistisk: legg til en fake progress-record umiddelbart
		for (const g of goalsLocal) {
			for (const t of g.tasks) {
				if (t.id === taskId) {
					t.progress = [{ id: crypto.randomUUID(), completedAt: new Date() }, ...t.progress];
				}
			}
		}
		await fetch(`/api/tasks/${taskId}/progress`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({})
		});
	}

	const active = $derived(goalsLocal.filter((g) => g.status === 'active'));
	const other = $derived(goalsLocal.filter((g) => g.status !== 'active'));
</script>

<div class="maal-page">
	<header class="maal-header">
		<h1>Mål</h1>
	</header>

	{#if active.length === 0 && other.length === 0}
		<p class="empty">Ingen mål ennå. Start en samtale for å opprette ett.</p>
	{:else}
		{#if active.length > 0}
			<section class="goal-section">
				<h2 class="section-label">Aktive</h2>
				<ul class="goal-list" role="list">
					{#each active as goal}
						<li>
							<GoalCard {goal} onTaskComplete={logProgress} />
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if other.length > 0}
			<section class="goal-section">
				<h2 class="section-label">Tidligere</h2>
				<ul class="goal-list" role="list">
					{#each other as goal}
						<li>
							<GoalCard {goal} onTaskComplete={logProgress} />
						</li>
					{/each}
				</ul>
			</section>
		{/if}
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
		gap: 10px;
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
