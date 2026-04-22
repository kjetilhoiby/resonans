<script lang="ts">
	import { TabButton } from '$lib/components/ui';

	export type EconomicsTabSlug = 'saldo' | 'utgifter' | 'innsikt' | 'pengestrom' | 'variabelt' | 'akkumulert' | 'transaksjoner' | 'salary-month';

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
		{ slug: 'transaksjoner',label: '🧾 Transaksjoner', href: (id) => `/economics/${encodeURIComponent(id)}/transaksjoner` },
		{ slug: 'salary-month', label: '📅 Lønnsmåned', href: (id) => `/economics/${encodeURIComponent(id)}/salary-month` },
	];
</script>

<div class="tabs">
	{#each TABS as t}
		<TabButton href={t.href(accountId)} active={t.slug === activeTab}>{t.label}</TabButton>
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
</style>
