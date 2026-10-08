<!--
  Samtale-oppfølgingsliste for HomeChatZone.
  Viser nylige samtaler (stjernemerkede + vanlige) med rename/kontekstmeny.
  Aksesserer delt state via getContext(HOME_CTX).
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { getContext } from 'svelte';
	import CollapsibleSection from '../../ui/CollapsibleSection.svelte';
	import ConversationContextMenu from '../../ui/ConversationContextMenu.svelte';
	import { getThemeHueStyle } from '$lib/domain/theme-hues';
	import { HOME_CTX, type HomeContext } from './home-context';

	const ctx = getContext<HomeContext>(HOME_CTX);
</script>

{#if ctx.followUpConversations.length > 0}
	<div class="followup-list" aria-label="Nylige samtaler å følge opp">
		{#snippet followupItem(convo: typeof ctx.followUpConversations[0])}
			<div class="followup-item-wrap" style={convo.linkedTheme ? getThemeHueStyle(convo.linkedTheme.name) : undefined}>
				{#if ctx.homeEditingConversationId === convo.id}
					<!-- svelte-ignore a11y_autofocus -->
					<input
						class="followup-rename-input"
						data-track="hjem-samtaler:gi-nytt-navn"
						bind:value={ctx.homeEditingTitle}
						onkeydown={(e) => {
							if (e.key === 'Enter') ctx.commitHomeConversationRename(convo.id);
							if (e.key === 'Escape') ctx.cancelHomeConversationRename();
						}}
						onblur={() => ctx.commitHomeConversationRename(convo.id)}
						autofocus
					/>
				{:else}
					<button class="followup-item" onclick={() => goto(`/samtaler?conversation=${convo.id}`)}>
						<span class="followup-title">{convo.title}</span>
						<span class="followup-date">{ctx.formatFollowUpDate(convo.updatedAt)}</span>
						{#if convo.preview}
							<span class="followup-preview">{convo.preview}</span>
						{/if}
					</button>
				{/if}
				<ConversationContextMenu
					conversationId={convo.id}
					starred={convo.starred}
					archived={convo.archived}
					currentThemeId={convo.linkedTheme?.id ?? null}
					themes={ctx.themes}
					onStarred={ctx.setHomeConversationStarred}
					onArchived={ctx.setHomeConversationArchived}
					onDeleted={ctx.removeHomeConversation}
					onMovedToTheme={ctx.moveHomeConversationTheme}
					onStartRename={() => ctx.startHomeConversationRename(convo.id, convo.title)}
				/>
			</div>
		{/snippet}

		{#if ctx.followUpStarred.length > 0}
			<CollapsibleSection title="Stjernemerkede" count={ctx.followUpStarred.length} defaultOpen={true}>
				{#each ctx.followUpStarred as convo (convo.id)}
					{@render followupItem(convo)}
				{/each}
			</CollapsibleSection>
		{/if}

		<CollapsibleSection title="Samtaler" count={ctx.followUpRegular.length} defaultOpen={true}>
			{#if ctx.followUpRegular.length === 0}
				<p class="followup-empty">Ingen umerkede samtaler.</p>
			{:else}
				{#each ctx.followUpRegular as convo (convo.id)}
					{@render followupItem(convo)}
				{/each}
			{/if}
		</CollapsibleSection>
	</div>
{/if}

<style>
	.followup-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
		opacity: 0.58;
		margin-top: 2px;
	}

	.followup-item-wrap {
		display: flex;
		align-items: stretch;
		border: 1px solid var(--border-subtle);
		border-radius: 10px;
		overflow: visible;
		transition: border-color 0.15s ease, color 0.15s ease;
	}

	.followup-item-wrap:hover {
		border-color: var(--border-color);
	}

	.followup-item {
		text-align: left;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		grid-template-areas:
			'title date'
			'preview preview';
		gap: 3px 10px;
		padding: 9px 10px;
		background: transparent;
		border: none;
		border-radius: 10px 0 0 10px;
		color: var(--text-tertiary);
		cursor: pointer;
		transition: opacity 0.15s ease, color 0.15s ease;
		flex: 1;
		min-width: 0;
	}

	.followup-item:hover {
		opacity: 0.9;
		color: var(--text-secondary);
	}

	.followup-rename-input {
		flex: 1;
		min-width: 0;
		background: var(--bg-input);
		border: 1px solid var(--border-color);
		border-radius: 8px;
		padding: 9px 10px;
		margin: 4px;
		color: var(--text-primary);
		font: inherit;
		font-size: 0.79rem;
		font-weight: 600;
		outline: none;
	}

	.followup-empty {
		margin: 0;
		padding: 8px 10px;
		font-size: 0.72rem;
		color: var(--text-muted);
		font-style: italic;
	}

	.followup-title {
		grid-area: title;
		font-size: 0.79rem;
		font-weight: 600;
		letter-spacing: -0.01em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.followup-date {
		grid-area: date;
		font-size: 0.7rem;
		color: var(--text-muted);
	}

	.followup-preview {
		grid-area: preview;
		font-size: 0.72rem;
		line-height: 1.3;
		color: var(--text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
