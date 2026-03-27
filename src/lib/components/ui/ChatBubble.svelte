<!--
  ChatBubble — én chatmelding i stoisk mørk stil.

  Props:
    role      'user' | 'bot'
    text      meldingstekst
    branch    valgfri "→ Trening & helse"-tag under botmeldinger
    actions   valgfri liste med handlingsknapper [{label, onclick}]
-->
<script lang="ts">
	interface Action {
		label: string;
		onclick: () => void;
	}

	interface Props {
		role: 'user' | 'bot';
		text: string;
		branch?: string;
		actions?: Action[];
	}

	let { role, text, branch, actions }: Props = $props();
</script>

<div class="row row-{role}">
	<div class="bubble bubble-{role}">{text}</div>
	{#if branch}
		<div class="branch-tag">→ {branch}</div>
	{/if}
	{#if actions && actions.length}
		<div class="action-row">
			{#each actions as a}
				<button class="action-btn" onclick={a.onclick}>{a.label}</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.row {
		display: flex;
		flex-direction: column;
		margin-bottom: 8px;
	}

	.row-user {
		align-items: flex-end;
	}

	.row-bot {
		align-items: flex-start;
	}

	.bubble {
		max-width: 82%;
		padding: 8px 12px;
		border-radius: 14px;
		font-size: 0.8rem;
		line-height: 1.45;
	}

	.bubble-user {
		background: #1a1a2e;
		color: #ccc;
		border-bottom-right-radius: 3px;
	}

	.bubble-bot {
		background: #111;
		color: #aaa;
		border: 1px solid #222;
		border-bottom-left-radius: 3px;
	}

	.branch-tag {
		font-size: 0.62rem;
		color: #555;
		margin-top: 3px;
		padding-left: 2px;
	}

	.action-row {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 6px;
		padding-left: 2px;
	}

	.action-btn {
		padding: 5px 12px;
		border-radius: 999px;
		border: 1px solid #2a2a2a;
		background: transparent;
		color: #888;
		font: inherit;
		font-size: 0.72rem;
		cursor: pointer;
		transition: border-color 0.12s, color 0.12s, background 0.12s;
	}

	.action-btn:hover {
		border-color: #555;
		color: #ccc;
		background: #1a1a1a;
	}
</style>
