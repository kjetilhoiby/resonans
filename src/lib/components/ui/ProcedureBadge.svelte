<!--
  ProcedureBadge — liten pill som viser at en oppskrift finnes for en oppgave.
-->
<script lang="ts">
	interface Props {
		emoji?: string | null;
		title?: string;
		onclick: () => void;
	}

	let { emoji, title, onclick }: Props = $props();
</script>

<button
	class="pb-badge"
	{onclick}
	aria-label={title ? `Oppskrift: ${title}` : 'Oppskrift tilgjengelig'}
	title={title ?? 'Oppskrift tilgjengelig'}
>
	{emoji ?? '📋'}
</button>

<style>
	.pb-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		background: #1a1e2e;
		border: 1px solid #2a2e3e;
		border-radius: 6px;
		font-size: 0.72rem;
		cursor: pointer;
		flex-shrink: 0;
		transition: border-color 0.12s, background 0.12s;
		line-height: 1;
	}
	.pb-badge:hover {
		border-color: #7c8ef5;
		background: #1e2238;
	}
</style>
