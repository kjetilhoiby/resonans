<script lang="ts">
	import { page } from '$app/stores';
	import { AppPage, IconButton, PageHeader, PageSection } from '$lib/components/ui';

	let { children } = $props();

	const tabs = [
		{ href: '/plan/mal', label: 'Mål', icon: '◎' },
		{ href: '/plan/oppgaver', label: 'Oppgaver', icon: '🗂' },
		{ href: '/plan/rutiner', label: 'Rutiner', icon: '🔁' },
		{ href: '/plan/drommer', label: 'Retning', icon: '🧭' }
	];
</script>

<AppPage>
	<PageSection>
	<PageHeader title="Plan" titleHref="/" titleLabel="Gå til forsiden">
		{#snippet actions()}
			<IconButton href="/" icon="chat" ariaLabel="Chat" />
			<IconButton href="/settings" icon="settings" ariaLabel="Innstillinger" />
		{/snippet}
	</PageHeader>

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
	</div>
	</PageSection>
</AppPage>

<style>
	.plan-shell {
		flex: 1;
		background: var(--bg-primary);
		color: var(--text-primary);
		display: flex;
		flex-direction: column;
	}
	.plan-tabs {
		display: flex;
		gap: 4px;
		padding: 0.25rem 1rem 0;
		border-bottom: 1px solid var(--border-color);
		position: sticky;
		top: 0;
		background: var(--bg-primary);
		z-index: 5;
		/* Fire faner overflower på smal viewport — scroll horisontalt uten synlig scrollbar */
		overflow-x: auto;
		overflow-y: hidden;
		-webkit-overflow-scrolling: touch;
		scrollbar-width: none;
	}
	.plan-tabs::-webkit-scrollbar {
		display: none;
	}
	@media (max-width: 760px) {
		.plan-tabs {
			mask-image: linear-gradient(to right, black calc(100% - 28px), transparent);
		}
	}
	.plan-tab {
		display: inline-flex;
		gap: 6px;
		align-items: center;
		flex: 0 0 auto;
		white-space: nowrap;
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

</style>
