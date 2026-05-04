<script lang="ts">
	interface Theme {
		id: string;
		name: string;
		emoji: string | null;
	}

	interface Props {
		conversationId: string;
		starred: boolean;
		archived: boolean;
		currentThemeId?: string | null;
		themes?: Theme[];
		onStarred?: (id: string, starred: boolean) => void;
		onArchived?: (id: string, archived: boolean) => void;
		onRenamed?: (id: string, title: string) => void;
		onMovedToTheme?: (id: string, themeId: string | null) => void;
		onDeleted?: (id: string) => void;
		onStartRename?: () => void;
	}

	let {
		conversationId,
		starred,
		archived,
		currentThemeId = null,
		themes = [],
		onStarred,
		onArchived,
		onRenamed,
		onMovedToTheme,
		onDeleted,
		onStartRename
	}: Props = $props();

	let open = $state(false);
	let showThemePicker = $state(false);
	let menuEl: HTMLDivElement | undefined = $state();

	function close() {
		open = false;
		showThemePicker = false;
	}

	function handleWindowPointerDown(e: PointerEvent) {
		if (menuEl && !menuEl.contains(e.target as Node)) {
			close();
		}
	}

	async function patchConversation(updates: Record<string, unknown>) {
		await fetch(`/api/conversations/${conversationId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(updates)
		});
	}

	async function handleStar() {
		close();
		const newVal = !starred;
		onStarred?.(conversationId, newVal);
		await patchConversation({ starred: newVal });
	}

	async function handleArchive() {
		close();
		const newVal = !archived;
		onArchived?.(conversationId, newVal);
		await patchConversation({ archived: newVal });
	}

	async function handleMoveToTheme(themeId: string | null) {
		close();
		onMovedToTheme?.(conversationId, themeId);
		await patchConversation({ themeId });
	}

	async function handleDelete() {
		close();
		if (!confirm('Er du sikker på at du vil slette samtalen permanent?')) return;
		onDeleted?.(conversationId);
		await fetch(`/api/conversations/${conversationId}`, { method: 'DELETE' });
	}

	function handleRename() {
		close();
		onStartRename?.();
	}
</script>

<svelte:window onpointerdown={open ? handleWindowPointerDown : undefined} />

<div class="ctx-wrap" bind:this={menuEl}>
	<button
		class="ctx-trigger"
		onclick={(e) => { e.stopPropagation(); open = !open; showThemePicker = false; }}
		aria-label="Handlinger"
		title="Handlinger"
	>
		<span>•••</span>
	</button>

	{#if open}
		<div class="ctx-menu" role="menu">
			{#if !showThemePicker}
				<button class="ctx-item" role="menuitem" onclick={handleRename}>
					✏️ Gi nytt navn
				</button>
				<button class="ctx-item" role="menuitem" onclick={handleStar}>
					{starred ? '☆ Fjern stjerne' : '★ Stjernemerk'}
				</button>
				<button class="ctx-item" role="menuitem" onclick={handleArchive}>
					{archived ? '📤 Avarkiver' : '📥 Arkiver'}
				</button>
				{#if themes.length > 0}
					<button class="ctx-item" role="menuitem" onclick={(e) => { e.stopPropagation(); showThemePicker = true; }}>
						🗂 Flytt til tema ▸
					</button>
				{/if}
				<div class="ctx-divider"></div>
				<button class="ctx-item ctx-item--danger" role="menuitem" onclick={handleDelete}>
					🗑 Slett samtale
				</button>
			{:else}
				<button class="ctx-item ctx-item--back" role="menuitem" onclick={(e) => { e.stopPropagation(); showThemePicker = false; }}>
					◂ Tilbake
				</button>
				<div class="ctx-divider"></div>
				{#if currentThemeId}
					<button class="ctx-item" role="menuitem" onclick={() => handleMoveToTheme(null)}>
						Ingen tema
					</button>
				{/if}
				{#each themes as theme}
					{#if theme.id !== currentThemeId}
						<button class="ctx-item" role="menuitem" onclick={() => handleMoveToTheme(theme.id)}>
							{theme.emoji ?? ''} {theme.name}
						</button>
					{/if}
				{/each}
			{/if}
		</div>
	{/if}
</div>

<style>
	.ctx-wrap {
		position: relative;
		display: inline-flex;
	}

	.ctx-trigger {
		background: transparent;
		border: 1px solid transparent;
		cursor: pointer;
		padding: 0.25rem 0.5rem;
		border-radius: 6px;
		color: var(--color-text-secondary, #6f6f6f);
		font-size: 0.75rem;
		letter-spacing: 0.1em;
		line-height: 1;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.ctx-trigger:hover {
		background: #171717;
		border-color: #262626;
		color: #cfcfcf;
	}

	.ctx-menu {
		position: absolute;
		right: 0;
		top: calc(100% + 4px);
		background: #141414;
		border: 1px solid #252525;
		border-radius: 10px;
		box-shadow: 0 10px 32px rgba(0, 0, 0, 0.42);
		min-width: 180px;
		z-index: 100;
		overflow: hidden;
		padding: 4px;
	}

	.ctx-item {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		width: 100%;
		padding: 0.5rem 0.75rem;
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
		font-size: 0.875rem;
		color: #d6d6d6;
		border-radius: 6px;
		white-space: nowrap;
	}

	.ctx-item:hover {
		background: #202020;
	}

	.ctx-item--danger {
		color: #e06b6b;
	}

	.ctx-item--danger:hover {
		background: #2a1616;
	}

	.ctx-item--back {
		color: #8e8e8e;
		font-size: 0.8rem;
	}

	.ctx-divider {
		height: 1px;
		background: #262626;
		margin: 4px 0;
	}
</style>
