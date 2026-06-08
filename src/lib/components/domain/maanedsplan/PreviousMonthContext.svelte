<script lang="ts">
	interface Props {
		monthName: string;
		previousMonthSummary: {
			monthKey: string;
			monthName: string;
			note: string;
			reflection: string;
		};
		hasPrevContext: boolean;
		openingFlow: boolean;
		onplanmonth: () => void;
	}

	let { monthName, previousMonthSummary, hasPrevContext, openingFlow, onplanmonth }: Props = $props();
</script>

<section class="mp-card mp-prev-context">
	{#if hasPrevContext}
		<p class="mp-subhead">Fra {previousMonthSummary.monthName}</p>
		{#if previousMonthSummary.reflection}
			<p class="mp-prev-text">"{previousMonthSummary.reflection}"</p>
		{:else if previousMonthSummary.note}
			<p class="mp-prev-text">"{previousMonthSummary.note}"</p>
		{/if}
	{/if}
	<button
		type="button"
		class="mp-plan-btn"
		onclick={onplanmonth}
		disabled={openingFlow}
	>
		{openingFlow ? 'Laster…' : `Planlegg ${monthName} →`}
	</button>
</section>

<style>
	.mp-card {
		background: linear-gradient(180deg, rgba(9, 11, 17, 0.95), rgba(8, 10, 15, 0.95));
		border-radius: 14px;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.mp-prev-context {
		border-left: 2px solid rgba(186, 198, 249, 0.12);
		border-radius: 0 10px 10px 0;
		padding-left: 14px;
		background: rgba(9, 11, 17, 0.5);
	}

	.mp-subhead {
		font-size: 0.72rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #70788f;
		font-weight: 650;
		margin: 0;
	}

	.mp-prev-text {
		font-size: 0.85rem;
		color: #8a90a3;
		font-style: italic;
		margin: 0;
		line-height: 1.5;
	}

	.mp-plan-btn {
		align-self: flex-start;
		height: 36px;
		padding: 0 18px;
		border-radius: 10px;
		border: none;
		background: #3a4adf;
		color: #fff;
		font: inherit;
		font-size: 0.88rem;
		font-weight: 650;
		cursor: pointer;
		transition: background 0.12s, opacity 0.12s;
	}
	.mp-plan-btn:hover:not(:disabled) { background: #4d5ef0; }
	.mp-plan-btn:disabled { opacity: 0.55; cursor: default; }
</style>
