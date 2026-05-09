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

	// Tokeniserer teksten i [tekst, mention, tekst, mention, …] slik at
	// `@PersonName` kan vises som en stylet pille.
	type Segment = { kind: 'text'; value: string } | { kind: 'mention'; value: string };

	const segments = $derived.by<Segment[]>(() => {
		const out: Segment[] = [];
		const re = /@([\p{L}][\p{L}\p{N}_-]{1,40})/gu;
		let last = 0;
		let m: RegExpExecArray | null;
		while ((m = re.exec(text)) !== null) {
			if (m.index > last) out.push({ kind: 'text', value: text.slice(last, m.index) });
			out.push({ kind: 'mention', value: m[1] });
			last = m.index + m[0].length;
		}
		if (last < text.length) out.push({ kind: 'text', value: text.slice(last) });
		return out.length ? out : [{ kind: 'text', value: text }];
	});
</script>

<div class="row row-{role}">
	<div class="bubble bubble-{role}">
		{#each segments as seg}
			{#if seg.kind === 'mention'}<span class="mention">@{seg.value}</span>{:else}{seg.value}{/if}
		{/each}
	</div>
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

	.mention {
		display: inline;
		padding: 1px 6px;
		margin: 0 1px;
		border-radius: 6px;
		background: rgba(124, 142, 245, 0.18);
		color: #b9c2ff;
		font-weight: 500;
	}
</style>
