<!--
  PeriodPills — horisontal pill-velger for tidsperioder.

  Props:
    options   array av strenger, f.eks. ['uke', 'måned', 'kvartal']
    value     valgt verdi (bind-vennlig via onchange)
    onchange  callback når bruker bytter periode

  Eksempel:
    <PeriodPills options={['7d','30d','90d']} value={period} onchange={(v) => period = v} />
-->
<script lang="ts">
	interface Props {
		options: string[];
		value: string;
		onchange?: (v: string) => void;
	}

	let { options, value, onchange }: Props = $props();
</script>

<div class="period-pills" role="group">
	{#each options as opt}
		<button
			class="period-btn"
			class:active={value === opt}
			onclick={() => onchange?.(opt)}
			aria-pressed={value === opt}
		>{opt}</button>
	{/each}
</div>

<style>
	.period-pills {
		display: flex;
		gap: 6px;
	}

	.period-btn {
		padding: 6px 11px;
		border-radius: 999px;
		border: 1px solid #2a2a2a;
		background: #111;
		color: #444;
		font: inherit;
		font-size: 0.8rem;
		font-weight: 600;
		text-transform: none;
		cursor: pointer;
		transition: border-color 0.12s, color 0.12s, background 0.12s;
		white-space: nowrap;
		line-height: 1.3;
	}

	.period-btn.active {
		border-color: #555;
		color: #ccc;
		background: #1a1a1a;
	}

	.period-btn:hover {
		border-color: #444;
		color: #aaa;
	}
</style>
