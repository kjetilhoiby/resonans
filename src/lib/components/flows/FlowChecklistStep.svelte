<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import type { FlowChecklistItem, WeatherData } from './flow-helpers';

	interface Props {
		checklistItems: FlowChecklistItem[];
		weather: WeatherData | null;
		loadingAiSuggestions: boolean;
		enableAiRefinement: boolean;
		hasAiSuggestionsField: boolean;
		refinementHistory: string[];
		refinementInput: string;
		checklistCustomInput: string;
		refinementInputEl?: HTMLInputElement | null;
		checklistCustomInputEl?: HTMLInputElement | null;
		onToggle: (id: string) => void;
		onAddCustom: () => void;
		onRefinementSend: () => void;
		onRefinementInputChange: (value: string) => void;
		onCustomInputChange: (value: string) => void;
	}

	let {
		checklistItems,
		weather,
		loadingAiSuggestions,
		enableAiRefinement,
		hasAiSuggestionsField,
		refinementHistory,
		refinementInput,
		checklistCustomInput,
		refinementInputEl = $bindable(null),
		checklistCustomInputEl = $bindable(null),
		onToggle,
		onAddCustom,
		onRefinementSend,
		onRefinementInputChange,
		onCustomInputChange
	}: Props = $props();
</script>

{#if weather?.current?.temperatureC != null}
	<div class="fs-weather-chip">
		{#each weather.slots as slot (slot.hour)}<span>{slot.emoji}</span>{/each}
		<span class="fs-weather-sep">·</span>
		<span>{Math.round(weather.current.temperatureC)}°</span>
	</div>
{/if}

{#if checklistItems.length > 0}
	<ul class="fs-checklist">
		{#each checklistItems as item (item.id)}
			<li>
				<button
					type="button"
					class="fs-cl-item"
					class:selected={item.selected}
					onclick={() => onToggle(item.id)}
				>
					<span class="fs-cl-check">{item.selected ? '✓' : ''}</span>
					<span class="fs-cl-text">{item.text}</span>
					{#if item.source !== 'custom'}
						<span class="fs-cl-badge">
							{item.source === 'carryover' ? 'overligger' : item.source === 'week' ? 'ukesmål' : 'forslag'}
						</span>
					{/if}
				</button>
			</li>
		{/each}
	</ul>
{/if}

{#if loadingAiSuggestions}
	<div class="fs-ai-loading">
		<span class="fs-ai-dot"></span>Henter forslag…
	</div>
{/if}

{#if enableAiRefinement && hasAiSuggestionsField}
	{#if refinementHistory.length > 0}
		<div class="fs-refinement-history" aria-live="polite">
			{#each refinementHistory as prompt (prompt)}
				<span class="fs-refinement-chip">✦ {prompt}</span>
			{/each}
		</div>
	{/if}
	<div class="fs-refinement-row">
		<input
			bind:this={refinementInputEl}
			value={refinementInput}
			oninput={(e) => onRefinementInputChange(e.currentTarget.value)}
			type="text"
			class="fs-refinement-input"
			placeholder="Be om flere forslag… f.eks. «mer om hvile»"
			disabled={loadingAiSuggestions}
			onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onRefinementSend(); } }}
		/>
		<button
			type="button"
			class="fs-refinement-btn"
			onclick={onRefinementSend}
			disabled={!refinementInput.trim() || loadingAiSuggestions}
			aria-label="Hent forslag"
		>↑</button>
	</div>
{/if}

<div class="fs-add-row">
	<input
		bind:this={checklistCustomInputEl}
		value={checklistCustomInput}
		oninput={(e) => onCustomInputChange(e.currentTarget.value)}
		type="text"
		class="fs-add-input"
		placeholder="Legg til oppgave…"
		onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAddCustom(); } }}
	/>
	<button
		type="button"
		class="fs-add-btn"
		onclick={onAddCustom}
		disabled={!checklistCustomInput.trim()}
	><Icon name="plus" size={16} /></button>
</div>

<style>
	/* Weather chip */
	.fs-weather-chip {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 0.8rem;
		color: #7a8a9a;
		background: #0e1318;
		border: 1px solid #1a2030;
		border-radius: 20px;
		padding: 5px 12px;
		width: fit-content;
	}
	.fs-weather-sep { color: #2a3040; }

	/* Checklist */
	.fs-checklist { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
	.fs-cl-item {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 10px 12px;
		background: #141414;
		border: 1px solid #1e1e1e;
		border-radius: 10px;
		cursor: pointer;
		text-align: left;
		color: #555;
		transition: all 0.1s;
	}
	.fs-cl-item.selected { background: #0d1828; border-color: #2a4080; color: #c8d4ef; }
	.fs-cl-check {
		width: 18px; height: 18px;
		border-radius: 5px;
		border: 1.5px solid #2a2a2a;
		display: flex; align-items: center; justify-content: center;
		font-size: 0.65rem; font-weight: 700;
		flex-shrink: 0;
		transition: all 0.1s;
	}
	.fs-cl-item.selected .fs-cl-check { border-color: #4b6ef5; background: #4b6ef5; color: #fff; }
	.fs-cl-text { flex: 1; font-size: 0.9rem; }
	.fs-cl-badge {
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #3a3a4a;
		flex-shrink: 0;
	}
	.fs-cl-item.selected .fs-cl-badge { color: #4a5a8a; }

	.fs-ai-loading {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 0.8rem;
		color: #444;
		padding: 4px 0;
	}
	.fs-ai-dot {
		width: 6px; height: 6px;
		border-radius: 50%;
		background: #4b6ef5;
		animation: fsPulse 1s ease-in-out infinite;
	}
	@keyframes fsPulse {
		0%, 100% { opacity: 0.3; transform: scale(0.8); }
		50% { opacity: 1; transform: scale(1); }
	}

	.fs-add-row { display: flex; gap: 8px; align-items: center; }
	.fs-add-input {
		flex: 1;
		background: #141414;
		border: 1px solid #1e1e1e;
		border-radius: 8px;
		color: #ccc;
		font-size: 0.88rem;
		padding: 9px 12px;
		font-family: inherit;
		transition: border-color 0.12s;
	}
	.fs-add-input:focus { outline: none; border-color: #4b6ef5; }
	.fs-add-btn {
		width: 36px; height: 36px;
		background: #141414;
		border: 1px solid #2a2a2a;
		border-radius: 50%;
		color: #666;
		cursor: pointer;
		display: flex; align-items: center; justify-content: center;
		flex-shrink: 0;
		transition: all 0.1s;
	}
	.fs-add-btn:not(:disabled):hover { background: #1a1a1a; color: #ccc; }
	.fs-add-btn:disabled { opacity: 0.3; cursor: default; }

	/* Refinement */
	.fs-refinement-history {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		padding: 4px 0 2px;
	}
	.fs-refinement-chip {
		font-size: 0.7rem;
		color: #6070c0;
		background: #0e1020;
		border: 1px solid #1e2240;
		border-radius: 999px;
		padding: 2px 10px;
	}
	.fs-refinement-row {
		display: flex;
		gap: 8px;
		align-items: center;
		border: 1px solid #1e2240;
		border-radius: 10px;
		padding: 4px 4px 4px 12px;
		background: #0a0a14;
	}
	.fs-refinement-input {
		flex: 1;
		background: none;
		border: none;
		color: #aaa;
		font: inherit;
		font-size: 0.82rem;
		outline: none;
		min-width: 0;
	}
	.fs-refinement-input::placeholder { color: #3a3a5a; }
	.fs-refinement-input:disabled { opacity: 0.5; }
	.fs-refinement-btn {
		width: 28px;
		height: 28px;
		border-radius: 8px;
		border: none;
		background: #2a3080;
		color: #aab0ff;
		font-size: 1rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		transition: background 0.12s;
	}
	.fs-refinement-btn:not(:disabled):hover { background: #3a40a0; }
	.fs-refinement-btn:disabled { opacity: 0.3; cursor: default; }
</style>
