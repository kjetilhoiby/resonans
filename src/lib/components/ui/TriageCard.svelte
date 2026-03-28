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

	interface Action {
		label: string;
		onclick: () => void;
	}

	interface Props {
		text?: string;
		actions?: Action[];
		loading?: boolean;
	}

	let { text = '', actions = [], loading = false }: Props = $props();

	marked.setOptions({
		breaks: true,
		gfm: true
	});

	const htmlContent = $derived(marked.parse(text) as string);
</script>

{#if loading}
	<div class="tc-skeleton">
		<div class="tc-sk-line tc-sk-long"></div>
		<div class="tc-sk-line tc-sk-medium"></div>
		<div class="tc-sk-line tc-sk-short"></div>
	</div>
{:else}
	<div class="tc-card" role="status" aria-live="polite">
		<!-- Avatar + boble -->
		<div class="tc-header">
			<span class="tc-avatar" aria-label="Resonans AI">◈</span>
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
		font-size: 0.85rem;
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

	/* Skeleton */
	.tc-skeleton {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 10px 14px;
		background: #111;
		border: 1px solid #242424;
		border-radius: 4px 14px 14px 14px;
		max-width: 65%;
		align-self: flex-start;
	}

	.tc-sk-line {
		height: 12px;
		border-radius: 6px;
		background: linear-gradient(90deg, #1a1a1a 25%, #252525 50%, #1a1a1a 75%);
		background-size: 200% 100%;
		animation: shimmer 1.4s infinite;
	}

	.tc-sk-long {
		width: 95%;
	}
	.tc-sk-medium {
		width: 72%;
	}
	.tc-sk-short {
		width: 48%;
	}

	@keyframes shimmer {
		0% {
			background-position: 200% 0;
		}
		100% {
			background-position: -200% 0;
		}
	}
</style>
