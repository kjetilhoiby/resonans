<script lang="ts">
	import { page } from '$app/stores';
	import { AppPage } from '$lib/components/ui';

	let { children } = $props();

	const tabs = [
		{ href: '/plan/mal', label: 'Mål', icon: '◎' },
		{ href: '/plan/oppgaver', label: 'Oppgaver', icon: '🗂' }
	];
</script>

<AppPage width="full" theme="dark" surface="default">
	<div class="plan-shell">
		<nav class="plan-tabs" aria-label="Plan-faner">
			{#each tabs as tab (tab.href)}
				<a
					href={tab.href}
					class="plan-tab"
					class:active={$page.url.pathname.startsWith(tab.href)}
					data-sveltekit-noscroll
				>
					<span class="plan-tab-icon">{tab.icon}</span>
					<span class="plan-tab-label">{tab.label}</span>
				</a>
			{/each}
		</nav>

		<div class="plan-content">
			{@render children?.()}
		</div>

		<nav class="bottom-nav" aria-label="Navigasjon">
			<a href="/" class="nav-item" class:active={$page.url.pathname === '/'}>
				<span class="nav-icon">⬡</span>
				<span class="nav-label">Hjem</span>
			</a>
			<a href="/plan/mal" class="nav-item" class:active={$page.url.pathname.startsWith('/plan')} aria-current="page">
				<span class="nav-icon">◎</span>
				<span class="nav-label">Plan</span>
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
	</div>
</AppPage>

<style>
	.plan-shell {
		min-height: 100dvh;
		background: var(--bg-primary);
		color: var(--text-primary);
		display: flex;
		flex-direction: column;
		padding-bottom: 80px;
	}
	.plan-tabs {
		display: flex;
		gap: 4px;
		padding: var(--screen-title-top-pad, 28px) 1rem 0.5rem;
		border-bottom: 1px solid var(--border-color);
		position: sticky;
		top: 0;
		background: var(--bg-primary);
		z-index: 5;
	}
	.plan-tab {
		display: inline-flex;
		gap: 6px;
		align-items: center;
		padding: 0.55rem 0.95rem;
		border-radius: 999px 999px 0 0;
		font: inherit;
		font-size: 0.92rem;
		color: var(--text-tertiary);
		text-decoration: none;
		border-bottom: 2px solid transparent;
		transition: color 0.12s, border-color 0.12s;
	}
	.plan-tab:hover {
		color: var(--text-secondary);
	}
	.plan-tab.active {
		color: var(--text-primary);
		border-bottom-color: var(--accent-primary);
		font-weight: 600;
	}
	.plan-tab-icon {
		font-size: 1rem;
	}
	.plan-content {
		flex: 1;
		padding: 1rem;
		max-width: 820px;
		width: 100%;
		margin: 0 auto;
	}

	.bottom-nav {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		display: flex;
		justify-content: space-around;
		align-items: center;
		background: var(--bg-card);
		border-top: 1px solid var(--border-color);
		padding: 0.4rem 0 calc(0.4rem + env(safe-area-inset-bottom, 0px));
		z-index: 10;
	}
	.nav-item {
		display: inline-flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		color: var(--text-tertiary);
		text-decoration: none;
		padding: 6px 10px;
		font-size: 0.7rem;
	}
	.nav-icon {
		font-size: 1.3rem;
	}
	.nav-item.active {
		color: var(--text-primary);
	}
</style>
