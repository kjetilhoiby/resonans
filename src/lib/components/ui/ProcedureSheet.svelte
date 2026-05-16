<!--
  ProcedureSheet — full-screen overlay for å vise en oppskrift/fremgangsmåte.

  Har to tabs:
  - Fremgangsmåte: markdown-formatert prosedyre
  - Sjekkliste: trinnene som kan brukes på en sjekkliste
-->
<script lang="ts">
	import { fly, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import Icon from '$lib/components/ui/Icon.svelte';

	interface ProcedureStep {
		id: string;
		text: string;
		sortOrder: number;
		isOptional: boolean;
	}

	interface Procedure {
		id: string;
		title: string;
		emoji: string | null;
		summary: string | null;
		domain: string | null;
		shared: boolean;
		version: number;
		steps: ProcedureStep[];
		metadata: {
			appliedCount?: number;
			sourceConversationTitle?: string;
		};
		conversationId: string | null;
		createdAt: string;
		updatedAt: string;
	}

	interface Props {
		procedure: Procedure;
		onclose: () => void;
		onApply?: (procedureId: string) => void;
		onStartChat?: (conversationId: string | null) => void;
		onChanged?: () => void;
	}

	let { procedure, onclose, onApply, onStartChat, onChanged }: Props = $props();

	let activeTab = $state<'guide' | 'checklist'>('guide');
	let editing = $state(false);
	let editSteps = $state<string[]>(procedure.steps.map(s => s.text));
	let newStepText = $state('');
	let sharing = $state(procedure.shared);

	function renderMarkdown(md: string): string {
		return md
			.replace(/^### (.+)$/gm, '<h3>$1</h3>')
			.replace(/^## (.+)$/gm, '<h2>$1</h2>')
			.replace(/^# (.+)$/gm, '<h1>$1</h1>')
			.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
			.replace(/\*(.+?)\*/g, '<em>$1</em>')
			.replace(/^- (.+)$/gm, '<li>$1</li>')
			.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
			.replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
			.replace(/\n{2,}/g, '</p><p>')
			.replace(/^/, '<p>')
			.replace(/$/, '</p>')
			.replace(/<p><(h[1-3]|ul|ol|li)/g, '<$1')
			.replace(/<\/(h[1-3]|ul|ol|li)><\/p>/g, '</$1>');
	}

	async function toggleShared() {
		sharing = !sharing;
		await fetch(`/api/procedures/${procedure.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ shared: sharing })
		});
		onChanged?.();
	}

	function startEdit() {
		editSteps = procedure.steps.map(s => s.text);
		editing = true;
	}

	function addStep() {
		const text = newStepText.trim();
		if (!text) return;
		editSteps = [...editSteps, text];
		newStepText = '';
	}

	function removeStep(idx: number) {
		editSteps = editSteps.filter((_, i) => i !== idx);
	}

	function moveStep(idx: number, dir: -1 | 1) {
		const target = idx + dir;
		if (target < 0 || target >= editSteps.length) return;
		const arr = [...editSteps];
		[arr[idx], arr[target]] = [arr[target], arr[idx]];
		editSteps = arr;
	}

	async function saveEdit() {
		await fetch(`/api/procedures/${procedure.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ steps: editSteps })
		});
		procedure.steps = editSteps.map((text, i) => ({
			id: `temp-${i}`,
			text,
			sortOrder: i,
			isOptional: false
		}));
		editing = false;
		onChanged?.();
	}

	function cancelEdit() {
		editing = false;
		editSteps = procedure.steps.map(s => s.text);
	}
</script>

<div
	class="ps-backdrop"
	transition:fade={{ duration: 200 }}
	onclick={onclose}
	role="presentation"
></div>

<div
	class="ps-sheet"
	transition:fly={{ y: 40, duration: 350, easing: cubicOut }}
	role="dialog"
	aria-modal="true"
>
	<div class="ps-header">
		<div class="ps-header-left">
			{#if procedure.emoji}
				<span class="ps-header-emoji">{procedure.emoji}</span>
			{/if}
			<div>
				<h2 class="ps-title">{procedure.title}</h2>
				<p class="ps-subtitle">
					v{procedure.version}
					{#if procedure.metadata?.appliedCount}
						 · brukt {procedure.metadata.appliedCount} {procedure.metadata.appliedCount === 1 ? 'gang' : 'ganger'}
					{/if}
				</p>
			</div>
		</div>
		<button class="ps-close-btn" onclick={onclose} aria-label="Lukk"><Icon name="close" size={14} /></button>
	</div>

	<div class="ps-tabs">
		<button
			class="ps-tab"
			class:active={activeTab === 'guide'}
			onclick={() => { activeTab = 'guide'; }}
		>Fremgangsmåte</button>
		<button
			class="ps-tab"
			class:active={activeTab === 'checklist'}
			onclick={() => { activeTab = 'checklist'; }}
		>Sjekkliste ({procedure.steps.length})</button>
	</div>

	<div class="ps-content">
		{#if activeTab === 'guide'}
			{#if procedure.summary}
				<div class="ps-markdown">
					{@html renderMarkdown(procedure.summary)}
				</div>
			{:else}
				<p class="ps-empty">Ingen fremgangsmåte skrevet ennå. Start en chat for å bygge den opp.</p>
			{/if}
		{:else}
			{#if editing}
				<ul class="ps-step-list">
					{#each editSteps as step, idx}
						<li class="ps-step-edit">
							<span class="ps-step-num">{idx + 1}.</span>
							<span class="ps-step-text">{step}</span>
							<div class="ps-step-actions">
								<button class="ps-step-btn" onclick={() => moveStep(idx, -1)} disabled={idx === 0} aria-label="Flytt opp">↑</button>
								<button class="ps-step-btn" onclick={() => moveStep(idx, 1)} disabled={idx === editSteps.length - 1} aria-label="Flytt ned">↓</button>
								<button class="ps-step-btn ps-step-btn-danger" onclick={() => removeStep(idx)} aria-label="Fjern">×</button>
							</div>
						</li>
					{/each}
				</ul>
				<div class="ps-add-step">
					<input
						class="ps-add-input"
						type="text"
						placeholder="Nytt trinn..."
						bind:value={newStepText}
						onkeydown={(e) => { if (e.key === 'Enter') addStep(); }}
					/>
					<button class="ps-add-btn" onclick={addStep} disabled={!newStepText.trim()}>+</button>
				</div>
				<div class="ps-edit-actions">
					<button class="ps-btn ps-btn-secondary" onclick={cancelEdit}>Avbryt</button>
					<button class="ps-btn ps-btn-primary" onclick={saveEdit}>Lagre</button>
				</div>
			{:else}
				{#if procedure.steps.length > 0}
					<ol class="ps-step-list">
						{#each procedure.steps as step}
							<li class="ps-step">
								<span class="ps-step-text">{step.text}</span>
								{#if step.isOptional}
									<span class="ps-optional-badge">valgfritt</span>
								{/if}
							</li>
						{/each}
					</ol>
				{:else}
					<p class="ps-empty">Ingen trinn ennå.</p>
				{/if}
			{/if}
		{/if}
	</div>

	<div class="ps-actions">
		{#if !editing}
			{#if onApply}
				<button class="ps-btn ps-btn-primary" onclick={() => onApply?.(procedure.id)}>
					Bruk oppskrift
				</button>
			{/if}
			{#if onStartChat}
				<button class="ps-btn ps-btn-secondary" onclick={() => onStartChat?.(procedure.conversationId)}>
					Start chat
				</button>
			{/if}
			<button class="ps-btn ps-btn-ghost" onclick={startEdit} aria-label="Rediger trinn">
				Rediger
			</button>
			<button
				class="ps-btn ps-btn-ghost"
				class:ps-shared={sharing}
				onclick={toggleShared}
			>
				{sharing ? 'Delt' : 'Del'}
			</button>
		{/if}
	</div>
</div>

<style>
	.ps-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0,0,0,0.6);
		z-index: 200;
	}

	.ps-sheet {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		max-height: 90dvh;
		background: #111;
		border-radius: 24px 24px 0 0;
		border-top: 1px solid #222;
		z-index: 201;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		max-width: 520px;
		margin: 0 auto;
	}

	.ps-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 20px 20px 12px;
		flex-shrink: 0;
	}

	.ps-header-left {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.ps-header-emoji { font-size: 1.8rem; line-height: 1; }

	.ps-title {
		font-size: 1rem;
		font-weight: 700;
		color: #eee;
		margin: 0 0 2px;
		letter-spacing: -0.01em;
	}

	.ps-subtitle {
		font-size: 0.72rem;
		color: #555;
		margin: 0;
	}

	.ps-close-btn {
		width: 32px;
		height: 32px;
		background: #1e1e1e;
		border: 1px solid #2a2a2a;
		border-radius: 50%;
		color: #666;
		font-size: 0.75rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}
	.ps-close-btn:hover { color: #ccc; border-color: #555; }

	/* Tabs */
	.ps-tabs {
		display: flex;
		gap: 0;
		padding: 0 20px;
		border-bottom: 1px solid #222;
		flex-shrink: 0;
	}

	.ps-tab {
		flex: 1;
		padding: 10px 0;
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		color: #666;
		font-size: 0.82rem;
		font-weight: 600;
		cursor: pointer;
		text-align: center;
		transition: color 0.15s, border-color 0.15s;
	}
	.ps-tab.active {
		color: #ccc;
		border-bottom-color: #7c8ef5;
	}

	/* Content */
	.ps-content {
		flex: 1;
		overflow-y: auto;
		padding: 16px 20px;
		-webkit-overflow-scrolling: touch;
	}

	.ps-markdown {
		color: #bbb;
		font-size: 0.88rem;
		line-height: 1.7;
	}
	.ps-markdown :global(h1),
	.ps-markdown :global(h2),
	.ps-markdown :global(h3) {
		color: #ddd;
		margin: 16px 0 8px;
	}
	.ps-markdown :global(h2) { font-size: 1rem; }
	.ps-markdown :global(h3) { font-size: 0.92rem; }
	.ps-markdown :global(strong) { color: #ddd; }
	.ps-markdown :global(ul), .ps-markdown :global(ol) {
		padding-left: 20px;
		margin: 8px 0;
	}
	.ps-markdown :global(li) { margin-bottom: 4px; }
	.ps-markdown :global(p) { margin: 8px 0; }

	.ps-empty {
		color: #555;
		font-size: 0.85rem;
		text-align: center;
		padding: 32px 0;
	}

	/* Step list */
	.ps-step-list {
		list-style: none;
		margin: 0;
		padding: 0;
		counter-reset: step;
	}

	.ps-step {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 10px 0;
		border-bottom: 1px solid #1a1a1a;
		counter-increment: step;
		color: #bbb;
		font-size: 0.88rem;
	}
	.ps-step::before {
		content: counter(step) ".";
		color: #555;
		font-weight: 600;
		min-width: 22px;
		flex-shrink: 0;
	}

	.ps-step-text { flex: 1; }

	.ps-optional-badge {
		font-size: 0.65rem;
		color: #666;
		background: #1e1e1e;
		padding: 2px 6px;
		border-radius: 4px;
		flex-shrink: 0;
	}

	/* Edit mode */
	.ps-step-edit {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 0;
		border-bottom: 1px solid #1a1a1a;
		color: #bbb;
		font-size: 0.88rem;
	}

	.ps-step-num {
		color: #555;
		font-weight: 600;
		min-width: 22px;
	}

	.ps-step-actions {
		display: flex;
		gap: 4px;
		flex-shrink: 0;
	}

	.ps-step-btn {
		width: 28px;
		height: 28px;
		background: #1e1e1e;
		border: 1px solid #2a2a2a;
		border-radius: 6px;
		color: #666;
		font-size: 0.75rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.ps-step-btn:hover { color: #ccc; border-color: #444; }
	.ps-step-btn:disabled { opacity: 0.3; cursor: default; }
	.ps-step-btn-danger:hover { color: #e55; border-color: #a33; }

	.ps-add-step {
		display: flex;
		gap: 8px;
		margin-top: 12px;
	}

	.ps-add-input {
		flex: 1;
		padding: 8px 12px;
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 8px;
		color: #ccc;
		font-size: 0.85rem;
		outline: none;
	}
	.ps-add-input::placeholder { color: #444; }
	.ps-add-input:focus { border-color: #7c8ef5; }

	.ps-add-btn {
		width: 36px;
		height: 36px;
		background: #7c8ef5;
		border: none;
		border-radius: 8px;
		color: #fff;
		font-size: 1.1rem;
		cursor: pointer;
		flex-shrink: 0;
	}
	.ps-add-btn:disabled { opacity: 0.3; cursor: default; }

	.ps-edit-actions {
		display: flex;
		gap: 8px;
		margin-top: 16px;
		justify-content: flex-end;
	}

	/* Actions bar */
	.ps-actions {
		display: flex;
		gap: 8px;
		padding: 12px 20px 20px;
		flex-shrink: 0;
		border-top: 1px solid #1a1a1a;
		flex-wrap: wrap;
	}

	.ps-btn {
		padding: 8px 16px;
		border: none;
		border-radius: 10px;
		font-size: 0.82rem;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.12s;
	}
	.ps-btn:active { opacity: 0.7; }

	.ps-btn-primary {
		background: #7c8ef5;
		color: #fff;
	}
	.ps-btn-secondary {
		background: #1e1e1e;
		color: #bbb;
		border: 1px solid #2a2a2a;
	}
	.ps-btn-ghost {
		background: none;
		color: #555;
		padding: 8px 12px;
	}
	.ps-btn-ghost:hover { color: #888; }
	.ps-shared { color: #5fa080; }
</style>
