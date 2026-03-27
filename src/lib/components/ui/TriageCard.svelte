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
			<p class="tc-text">{text}</p>
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
		white-space: pre-wrap;
		word-break: break-word;
		background: #111;
		border: 1px solid #242424;
		border-radius: 4px 14px 14px 14px;
		padding: 10px 14px;
		margin: 0;
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
