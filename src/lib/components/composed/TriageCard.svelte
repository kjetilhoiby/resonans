<!--
  TriageCard — bot-spørsmål med handling-knapper.
  Fase 3: vises i stedet for vanlig ChatBubble når bot-svaret
  inneholder action-valg.

  Props:
    text     spørsmåls- eller oppsummeringsteksten
    actions  liste av { label, onclick } knapper
    loading  viser pulserende skjelett mens svar kommer
-->
<script lang="ts">
	import { marked } from 'marked';
	import Icon from '../ui/Icon.svelte';

	interface Action {
		label: string;
		onclick: () => void;
	}

	interface Props {
		text?: string;
		actions?: Action[];
		loading?: boolean;
		streaming?: boolean;
		status?: string;
		steps?: string[];
		stopped?: boolean;
	}

	let { text = '', actions = [], loading = false, streaming = false, status = '', steps = [], stopped = false }: Props = $props();

	let stepsExpanded = $state(false);

	marked.setOptions({
		breaks: true,
		gfm: true
	});

	const htmlContent = $derived(marked.parse(text) as string);
</script>

{#if loading}
	<div class="tc-card tc-card-loading" role="status" aria-live="polite" aria-label="Tenker…">
		<div class="tc-header">
			<span class="tc-avatar" aria-hidden="true"><Icon name="chat" size={15} /></span>
			<div class="tc-thinking-wrap">
				<div class="tc-thinking-row">
					<span class="tc-thinking-label">Tenker</span>
					<span class="tc-thinking-dots" aria-hidden="true">
						<span></span><span></span><span></span>
					</span>
					{#if steps.length > 0}
						<button
							class="tc-expand-btn"
							onclick={() => (stepsExpanded = !stepsExpanded)}
							aria-expanded={stepsExpanded}
							aria-label="Vis detaljer"
						>
							<span class="tc-chevron" class:rotated={stepsExpanded}>›</span>
						</button>
					{/if}
				</div>
				{#if stepsExpanded && steps.length > 0}
					<div class="tc-steps" role="list">
						{#each steps as step}
							<p class="tc-step" role="listitem">{step}</p>
						{/each}
					</div>
				{:else if steps.length > 0}
					<p class="tc-latest-step">{steps[steps.length - 1]}</p>
				{/if}
			</div>
		</div>
	</div>
{:else if stopped && text}
	<div class="tc-card tc-card-stopped" role="status">
		<div class="tc-header">
			<span class="tc-avatar" aria-label="Resonans AI"><Icon name="chat" size={15} decorative={false} title="Resonans AI" /></span>
			<div class="tc-text tc-text-stopped">{@html htmlContent}</div>
		</div>
		<div class="tc-stopped-badge">Avbrutt</div>
	</div>
{:else if streaming && text}
	<div class="tc-card" role="status" aria-live="polite">
		<div class="tc-header">
			<span class="tc-avatar" aria-label="Resonans AI"><Icon name="chat" size={15} decorative={false} title="Resonans AI" /></span>
			<div class="tc-text">{@html htmlContent}<span class="tc-cursor" aria-hidden="true">▌</span></div>
		</div>
	</div>
{:else}
	<div class="tc-card" role="status" aria-live="polite">
		<!-- Avatar + boble -->
		<div class="tc-header">
			<span class="tc-avatar" aria-label="Resonans AI"><Icon name="chat" size={15} decorative={false} title="Resonans AI" /></span>
			<div class="tc-text">{@html htmlContent}</div>
		</div>

		<!-- Handling-knapper -->
		{#if actions.length > 0}
			<div class="tc-actions" role="group" aria-label="Valg">
				{#each actions as action}
					<button class="tc-btn" onclick={action.onclick}>
						{action.label}
					</button>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.tc-card {
		max-width: 80%;
		align-self: flex-start;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.tc-header {
		display: flex;
		align-items: flex-start;
		gap: 8px;
	}

	.tc-avatar {
		width: 22px;
		height: 22px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: #7c8ef5;
		flex-shrink: 0;
		margin-top: 2px;
		line-height: 1.5;
	}

	.tc-text {
		font-size: 0.88rem;
		line-height: 1.55;
		color: #c0c0c0;
		word-break: break-word;
		background: #111;
		border: 1px solid #242424;
		border-radius: 4px 14px 14px 14px;
		padding: 10px 14px;
		margin: 0;
	}

	.tc-text :global(p) {
		margin: 0.45rem 0;
	}

	.tc-text :global(p:first-child) {
		margin-top: 0;
	}

	.tc-text :global(p:last-child) {
		margin-bottom: 0;
	}

	.tc-text :global(ul),
	.tc-text :global(ol) {
		margin: 0.55rem 0;
		padding-left: 1.35rem;
	}

	.tc-text :global(li) {
		margin: 0.2rem 0;
	}

	.tc-text :global(code) {
		background: rgba(255, 255, 255, 0.06);
		padding: 0.12rem 0.3rem;
		border-radius: 0.28rem;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.9em;
	}

	.tc-text :global(pre) {
		background: #151515;
		border: 1px solid #232323;
		padding: 0.8rem;
		border-radius: 0.55rem;
		overflow-x: auto;
		margin: 0.6rem 0;
	}

	.tc-text :global(pre code) {
		background: transparent;
		padding: 0;
	}

	.tc-text :global(strong) {
		font-weight: 700;
		color: #f0f0f0;
	}

	.tc-text :global(em) {
		font-style: italic;
	}

	.tc-text :global(h1),
	.tc-text :global(h2),
	.tc-text :global(h3),
	.tc-text :global(h4) {
		margin: 0.8rem 0 0.4rem;
		font-weight: 700;
		color: #f0f0f0;
		letter-spacing: -0.02em;
	}

	.tc-text :global(h1) { font-size: 1.25em; }
	.tc-text :global(h2) { font-size: 1.14em; }
	.tc-text :global(h3) { font-size: 1.03em; }
	.tc-text :global(h4) { font-size: 0.96em; }

	.tc-text :global(blockquote) {
		border-left: 3px solid #38446e;
		padding-left: 0.8rem;
		margin: 0.6rem 0;
		color: #9da6c7;
	}

	.tc-text :global(a) {
		color: #9eabff;
		text-decoration: none;
	}

	.tc-text :global(a:hover) {
		text-decoration: underline;
	}

	.tc-text :global(hr) {
		border: none;
		border-top: 1px solid #292929;
		margin: 0.8rem 0;
	}

	.tc-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 7px;
		padding-left: 26px;
	}

	.tc-btn {
		background: #1a1a1a;
		border: 1px solid #3a3a3a;
		color: #9eabff;
		font: inherit;
		font-size: 0.78rem;
		padding: 6px 14px;
		border-radius: 99px;
		cursor: pointer;
		transition: background 0.12s, border-color 0.12s, color 0.12s;
	}

	.tc-btn:hover {
		background: #222;
		border-color: #7c8ef5;
		color: #c0ccff;
	}

	.tc-card-loading {
		max-width: 65%;
	}

	.tc-thinking-wrap {
		display: flex;
		flex-direction: column;
		gap: 4px;
		background: #111;
		border: 1px solid #242424;
		border-radius: 4px 14px 14px 14px;
		padding: 10px 14px;
	}

	.tc-thinking-row {
		display: flex;
		align-items: center;
		gap: 5px;
	}

	.tc-thinking-label {
		font-size: 0.85rem;
		color: #707070;
		font-weight: 500;
	}

	.tc-thinking-dots {
		display: inline-flex;
		align-items: center;
		gap: 3px;
	}

	.tc-thinking-dots span {
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: #505050;
		animation: tcThinkDot 1.6s ease-in-out infinite;
	}

	.tc-thinking-dots span:nth-child(2) { animation-delay: 0.25s; }
	.tc-thinking-dots span:nth-child(3) { animation-delay: 0.5s; }

	@keyframes tcThinkDot {
		0%, 100% { opacity: 0.25; transform: scale(0.85); }
		50%       { opacity: 0.85; transform: scale(1.1); }
	}

	.tc-expand-btn {
		background: none;
		border: none;
		padding: 0 2px;
		cursor: pointer;
		line-height: 1;
		color: #484848;
		font-size: 1rem;
		transition: color 0.12s;
		margin-left: 2px;
	}
	.tc-expand-btn:hover { color: #aaa; }

	.tc-chevron {
		display: inline-block;
		transition: transform 0.18s;
		transform: rotate(0deg);
	}
	.tc-chevron.rotated { transform: rotate(90deg); }

	.tc-steps {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding-top: 4px;
		border-top: 1px solid #1e1e1e;
	}

	.tc-step {
		margin: 0;
		font-size: 0.73rem;
		color: #555;
		font-style: italic;
		line-height: 1.45;
	}

	.tc-latest-step {
		margin: 0;
		font-size: 0.73rem;
		color: #4a4a4a;
		font-style: italic;
		line-height: 1.45;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 28ch;
	}

	/* ── Stopped variant ───────────────────────────────────── */
	.tc-card-stopped {
		opacity: 0.7;
	}

	.tc-text-stopped {
		color: #888;
	}

	.tc-stopped-badge {
		margin-left: 30px;
		font-size: 0.68rem;
		color: #555;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		font-weight: 600;
	}

	.tc-cursor {
		display: inline;
		color: #7c8ef5;
		opacity: 1;
		margin-left: 1px;
		animation: tcCursorBlink 0.9s step-end infinite;
		font-size: 0.9em;
	}

	@keyframes tcCursorBlink {
		0%, 100% { opacity: 1; }
		50% { opacity: 0; }
	}
</style>
