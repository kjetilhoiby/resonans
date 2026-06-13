<script lang="ts">
	import { AppPage, PageHeader, PageSection } from '$lib/components/ui';
	import { invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let busyId = $state<string | null>(null);
	let errorMessage = $state('');

	type ThemeRow = PageData['active'][number];

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

<svelte:head>
	<title>Temaer | Resonans</title>
</svelte:head>

<AppPage className="themes-page">
	<PageSection>
	<PageHeader title="Temaer" titleHref="/" titleLabel="Gå til forsiden" />

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
							<li class="theme-row">
								<a class="theme-link" href={`/tema/${theme.id}`}>
									<span class="theme-emoji">{theme.emoji ?? '📁'}</span>
									<span class="theme-name">{theme.name}</span>
									{#if theme.dashboardLabel}
										<span class="theme-kind">{theme.dashboardLabel}</span>
									{/if}
								</a>
								<button
									type="button"
									class="action"
									disabled={busyId === theme.id}
									data-track="temaer:arkiver"
									onclick={() => void setArchived(theme.id, true)}
								>
									{busyId === theme.id ? '…' : 'Arkiver'}
								</button>
							</li>
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
						<li class="theme-row">
							<a class="theme-link" href={`/tema/${theme.id}`}>
								<span class="theme-emoji">{theme.emoji ?? '📁'}</span>
								<span class="theme-name">{theme.name}</span>
								{#if theme.dashboardLabel}
									<span class="theme-kind">{theme.dashboardLabel}</span>
								{/if}
							</a>
							<button
								type="button"
								class="action restore"
								disabled={busyId === theme.id}
								data-track="temaer:gjenopprett"
								onclick={() => void setArchived(theme.id, false)}
							>
								{busyId === theme.id ? '…' : 'Gjenopprett'}
							</button>
						</li>
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

	.theme-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 0.9rem;
		background: #171717;
		border-radius: 10px;
	}

	.theme-link {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex: 1;
		min-width: 0;
		text-decoration: none;
		color: var(--text-primary);
	}

	.theme-emoji {
		font-size: 1.25rem;
		flex-shrink: 0;
	}

	.theme-name {
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.theme-kind {
		font-size: 0.72rem;
		color: var(--text-tertiary);
		background: #222;
		border-radius: 999px;
		padding: 0.1rem 0.5rem;
		flex-shrink: 0;
	}

	.action {
		flex-shrink: 0;
		background: none;
		border: 1px solid var(--border-color);
		color: var(--text-secondary);
		border-radius: 8px;
		padding: 0.4rem 0.75rem;
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
