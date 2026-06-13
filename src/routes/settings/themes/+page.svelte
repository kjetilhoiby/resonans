<script lang="ts">
	import { AppPage, PageHeader, PageSection } from '$lib/components/ui';
	import { invalidateAll } from '$app/navigation';
	import ThemeSettingsPanel from './ThemeSettingsPanel.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let busyId = $state<string | null>(null);
	let errorMessage = $state('');
	let expandedId = $state<string | null>(null);

	type ThemeRow = PageData['active'][number];

	// Domener som har et innstillingspanel i dag (resten utvides bare til handlinger).
	const HANDLED_KINDS = ['travel', 'ferie', 'health', 'books', 'economics'];
	const hasSettings = (kind: string | null) => kind != null && HANDLED_KINDS.includes(kind);

	function toggleExpanded(id: string) {
		expandedId = expandedId === id ? null : id;
	}

	// Aktive temaer gruppert på parentTheme (null → «Uten kategori», vises sist).
	const activeGroups = $derived.by(() => {
		const map = new Map<string, ThemeRow[]>();
		for (const t of data.active) {
			const key = t.parentTheme ?? '';
			(map.get(key) ?? map.set(key, []).get(key)!).push(t);
		}
		return [...map.entries()]
			.sort(([a], [b]) => {
				if (a === '') return 1;
				if (b === '') return -1;
				return a.localeCompare(b, 'nb');
			})
			.map(([parent, themes]) => ({ parent: parent || 'Uten kategori', themes }));
	});

	async function setArchived(id: string, archived: boolean) {
		if (busyId) return;
		busyId = id;
		errorMessage = '';
		try {
			const res = await fetch(`/api/tema/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ archived })
			});
			if (res.ok) {
				await invalidateAll();
			} else {
				const body = await res.json().catch(() => null);
				errorMessage = body?.error || 'Kunne ikke oppdatere temaet.';
			}
		} catch (err) {
			console.error('Failed to update theme archived state:', err);
			errorMessage = 'Kunne ikke oppdatere temaet.';
		} finally {
			busyId = null;
		}
	}
</script>

{#snippet themeCard(theme: ThemeRow)}
	{@const isExpanded = expandedId === theme.id}
	<li class="theme-card" class:expanded={isExpanded}>
		<button
			type="button"
			class="theme-row"
			aria-expanded={isExpanded}
			onclick={() => toggleExpanded(theme.id)}
		>
			<span class="theme-emoji">{theme.emoji ?? '📁'}</span>
			<span class="theme-info">
				<span class="theme-name">{theme.name}</span>
				{#if theme.dashboardLabel}<span class="theme-kind">{theme.dashboardLabel}</span>{/if}
			</span>
			<span class="chevron" class:open={isExpanded}>›</span>
		</button>

		{#if isExpanded}
			<div class="theme-details">
				{#if hasSettings(theme.kind)}
					<ThemeSettingsPanel {theme} />
				{/if}
				<div class="theme-actions">
					<a class="open-link" href={`/tema/${theme.id}`}>Åpne tema →</a>
					{#if theme.archived}
						<button
							type="button"
							class="action restore"
							disabled={busyId === theme.id}
							data-track="temaer:gjenopprett"
							onclick={() => void setArchived(theme.id, false)}
						>
							{busyId === theme.id ? '…' : 'Gjenopprett'}
						</button>
					{:else}
						<button
							type="button"
							class="action"
							disabled={busyId === theme.id}
							data-track="temaer:arkiver"
							onclick={() => void setArchived(theme.id, true)}
						>
							{busyId === theme.id ? '…' : 'Arkiver'}
						</button>
					{/if}
				</div>
			</div>
		{/if}
	</li>
{/snippet}

<svelte:head>
	<title>Temaer | Resonans</title>
</svelte:head>

<AppPage className="themes-page">
	<PageSection>
	<PageHeader title="Temaer" titleHref="/settings" titleLabel="Tilbake til innstillinger" />

	<main class="content">
		{#if errorMessage}
			<div class="alert error">{errorMessage}</div>
		{/if}

		{#if data.active.length === 0}
			<p class="empty">Ingen aktive temaer enda.</p>
		{:else}
			{#each activeGroups as group (group.parent)}
				<section class="group">
					<h2>{group.parent}</h2>
					<ul class="theme-list">
						{#each group.themes as theme (theme.id)}
							{@render themeCard(theme)}
						{/each}
					</ul>
				</section>
			{/each}
		{/if}

		{#if data.archived.length > 0}
			<section class="group archived">
				<h2>Arkiverte</h2>
				<p class="muted">Arkiverte temaer er skjult fra forsiden, men dataene er beholdt.</p>
				<ul class="theme-list">
					{#each data.archived as theme (theme.id)}
						{@render themeCard(theme)}
					{/each}
				</ul>
			</section>
		{/if}
	</main>
	</PageSection>
</AppPage>

<style>
	:global(.themes-page) {
		color: var(--text-secondary);
	}

	.content {
		padding: 1.5rem 1rem;
	}

	.alert.error {
		padding: 1rem;
		border-radius: 8px;
		margin-bottom: 1.5rem;
		font-size: 0.9rem;
		background: var(--error-bg);
		color: var(--error-text);
		border: 1px solid var(--error-border);
	}

	.empty,
	.muted {
		color: var(--text-tertiary);
	}

	.empty {
		font-style: italic;
	}

	.group {
		margin-bottom: 1.75rem;
	}

	.group h2 {
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-tertiary);
		margin: 0 0 0.6rem;
	}

	.muted {
		margin: 0 0 0.75rem;
		font-size: 0.85rem;
	}

	.theme-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.theme-card {
		background: #171717;
		border-radius: 10px;
		border: 1px solid transparent;
		transition: border-color 0.15s;
	}

	.theme-card.expanded {
		border-color: #2a2a2a;
	}

	.theme-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		padding: 0.8rem 0.9rem;
		background: none;
		border: none;
		text-align: left;
		color: inherit;
		cursor: pointer;
		border-radius: 10px;
		font: inherit;
	}

	.theme-emoji {
		font-size: 1.25rem;
		flex-shrink: 0;
		width: 28px;
		text-align: center;
	}

	.theme-info {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
	}

	.theme-name {
		font-weight: 500;
		color: var(--text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.theme-kind {
		font-size: 0.72rem;
		color: var(--text-tertiary);
		flex-shrink: 0;
	}

	.chevron {
		font-size: 1.2rem;
		color: var(--text-tertiary);
		line-height: 1;
		flex-shrink: 0;
		transition: transform 0.18s ease;
	}

	.chevron.open {
		transform: rotate(90deg);
		color: var(--accent-primary);
	}

	.theme-details {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 0.25rem 0.9rem 0.9rem;
	}

	.theme-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding-top: 0.6rem;
		border-top: 1px solid #232323;
	}

	.open-link {
		font-size: 0.82rem;
		color: var(--accent-primary);
		text-decoration: none;
	}

	.action {
		flex-shrink: 0;
		background: none;
		border: 1px solid var(--border-color);
		color: var(--text-secondary);
		border-radius: 8px;
		padding: 0.4rem 0.8rem;
		font: inherit;
		font-size: 0.8rem;
		cursor: pointer;
	}

	.action:hover:not(:disabled) {
		border-color: var(--accent-primary);
		color: var(--text-primary);
	}

	.action:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.action.restore {
		color: var(--accent-primary);
		border-color: var(--accent-primary);
	}
</style>
