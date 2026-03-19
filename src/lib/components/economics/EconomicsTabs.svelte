<script lang="ts">
	export type EconomicsTabSlug = 'saldo' | 'utgifter' | 'innsikt' | 'pengestrom' | 'variabelt' | 'akkumulert' | 'salary-month';

	let {
		accountId,
		activeTab
	}: {
		accountId: string;
		activeTab: EconomicsTabSlug;
	} = $props();

	const TABS: { slug: EconomicsTabSlug; label: string; href: (id: string) => string }[] = [
		{ slug: 'saldo',        label: '📈 Saldo',      href: (id) => `/economics/${encodeURIComponent(id)}/saldo`        },
		{ slug: 'utgifter',     label: '📊 Utgifter',   href: (id) => `/economics/${encodeURIComponent(id)}/utgifter`     },
		{ slug: 'innsikt',      label: '🔍 Innsikt',    href: (id) => `/economics/${encodeURIComponent(id)}/innsikt`      },
		{ slug: 'pengestrom',   label: '💸 Pengestrøm', href: (id) => `/economics/${encodeURIComponent(id)}/pengestrom`   },
		{ slug: 'variabelt',    label: '📦 Variabelt',  href: (id) => `/economics/${encodeURIComponent(id)}/variabelt`    },
		{ slug: 'akkumulert',   label: '📈 Akkumulert', href: (id) => `/economics/${encodeURIComponent(id)}/akkumulert`   },
		{ slug: 'salary-month', label: '📅 Lønnsmåned', href: (id) => `/economics/${encodeURIComponent(id)}/salary-month` },
	];
</script>

<div class="tabs">
	{#each TABS as t}
		{#if t.slug === activeTab}
			<span class="tab active">{t.label}</span>
		{:else}
			<a class="tab" href={t.href(accountId)}>{t.label}</a>
		{/if}
	{/each}
</div>

<style>
	.tabs {
		display: flex;
		gap: 0.25rem;
		margin-bottom: 1.5rem;
		border-bottom: 2px solid var(--border-color, #e2e8f0);
		overflow-x: auto;
		scrollbar-width: none;
	}
	.tabs::-webkit-scrollbar { display: none; }

	.tab {
		padding: 0.6rem 1.25rem;
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		margin-bottom: -2px;
		font-size: 0.95rem;
		font-weight: 500;
		color: var(--text-secondary, #64748b);
		cursor: pointer;
		text-decoration: none;
		white-space: nowrap;
		transition: color 0.15s, border-color 0.15s;
		display: inline-flex;
		align-items: center;
	}
	.tab:hover { color: var(--text-primary, #0f172a); }

	.tab.active {
		color: var(--text-primary, #0f172a);
		border-bottom-color: #10b981;
		font-weight: 600;
	}
</style>
