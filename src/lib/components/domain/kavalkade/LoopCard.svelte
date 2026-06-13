<!--
  LoopCard — «Dette ville du i fjor»: fjorårets bursdagsmål + spådom holdt
  opp mot hva som faktisk skjedde. Ærlige status-merker (achieved: true/false/null).
-->
<script lang="ts">
	import type { LoopView, LoopPromiseView } from './types';

	interface Props {
		loop: LoopView;
	}

	let { loop }: Props = $props();

	const nf = new Intl.NumberFormat('nb-NO');

	function statusLabel(p: LoopPromiseView): string {
		if (p.achieved === true) return 'Oppnådd';
		if (p.achieved === false) return 'Ikke nådd';
		return p.status === 'active' ? 'Pågår' : 'Uvisst';
	}

	function statusClass(p: LoopPromiseView): string {
		if (p.achieved === true) return 'is-hit';
		if (p.achieved === false) return 'is-miss';
		return 'is-unknown';
	}

	function resultText(p: LoopPromiseView): string | null {
		if (p.targetValue === null) return null;
		const target = `${nf.format(p.targetValue)}${p.unit ? ` ${p.unit}` : ''}`;
		if (p.actualValue === null) return `mål: ${target}`;
		return `${nf.format(p.actualValue)}${p.unit ? ` ${p.unit}` : ''} av ${target}`;
	}
</script>

<div class="kv-loop">
	{#if loop.promises.length > 0}
		<ul class="kv-loop-list">
			{#each loop.promises as promise (promise.title)}
				<li class="kv-loop-row">
					<div class="kv-loop-main">
						<span class="kv-loop-title">{promise.title}</span>
						{#if resultText(promise)}
							<span class="kv-loop-result">{resultText(promise)}</span>
						{/if}
					</div>
					<span class={`kv-loop-status ${statusClass(promise)}`}>{statusLabel(promise)}</span>
				</li>
			{/each}
		</ul>
	{/if}
	{#if loop.prophecyExcerpt}
		<blockquote class="kv-loop-prophecy">
			<span class="kv-loop-prophecy-label">Spådommen for i år lød:</span>
			{loop.prophecyExcerpt}
		</blockquote>
	{/if}
</div>

<style>
	.kv-loop {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.kv-loop-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.kv-loop-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		background: var(--card-bg-inset);
		border-radius: var(--radius-md, 10px);
		padding: 9px 12px;
	}

	.kv-loop-main {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.kv-loop-title {
		font-size: var(--font-size-body);
		color: var(--text-primary);
	}

	.kv-loop-result {
		font-size: var(--font-size-caption);
		color: var(--text-secondary);
		font-variant-numeric: tabular-nums;
	}

	.kv-loop-status {
		flex-shrink: 0;
		font-size: var(--font-size-caption);
		font-weight: 600;
		padding: 3px 9px;
		border-radius: 999px;
	}

	.kv-loop-status.is-hit {
		background: rgba(74, 222, 128, 0.14);
		color: #4ade80;
	}

	.kv-loop-status.is-miss {
		background: rgba(240, 180, 41, 0.14);
		color: #f0b429;
	}

	.kv-loop-status.is-unknown {
		background: var(--card-bg-inset);
		color: var(--text-tertiary, var(--text-secondary));
		border: 1px solid var(--card-border, #222);
	}

	.kv-loop-prophecy {
		margin: 0;
		padding: 10px 12px;
		border-left: 2px solid var(--accent-muted);
		border-radius: var(--radius-md, 10px);
		background: var(--card-bg-inset);
		font-style: italic;
		font-size: var(--font-size-body);
		color: var(--text-primary);
	}

	.kv-loop-prophecy-label {
		display: block;
		font-style: normal;
		font-size: var(--font-size-caption);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-secondary);
		margin-bottom: 4px;
	}
</style>
