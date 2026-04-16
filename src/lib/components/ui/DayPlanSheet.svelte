<!--
  DayPlanSheet — 2-step guided day planning sheet.
  Trinn 1: Enlinjer (hva handler dagen om?)
  Trinn 2: Dagsoppgaver (checkable task list from context + custom)
-->
<script lang="ts">
	import { fly, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { onMount } from 'svelte';

	interface PlanItem {
		id: string;
		text: string;
		source: 'carryover' | 'week' | 'custom' | 'ai';
		selected: boolean;
	}

	interface WeatherSlot {
		hour: number;
		emoji: string;
		conditionCode: string;
		tempC: number | null;
	}

	interface WeatherSummary {
		slots: WeatherSlot[];
		current: { temperatureC: number | null; conditionCode: string };
	}

	interface Props {
		dayIso: string;
		dayLabel: string;
		weekDashedKey: string;
		carryovers: string[];
		weekTasks: string[];
		existingHeadline?: string;
		onclose: () => void;
		onsaved: () => void;
	}

	let {
		dayIso,
		dayLabel,
		weekDashedKey,
		carryovers,
		weekTasks,
		existingHeadline = '',
		onclose,
		onsaved
	}: Props = $props();

	let step = $state<1 | 2>(1);
	let headline = $state(existingHeadline);
	let saving = $state(false);
	let error = $state('');
	let customInput = $state('');
	let headlineEl = $state<HTMLTextAreaElement | null>(null);
	let customInputEl = $state<HTMLInputElement | null>(null);
	let loadingSuggestions = $state(false);
	let weather = $state<WeatherSummary | null>(null);

	let items = $state<PlanItem[]>(buildItems());

	function buildItems(): PlanItem[] {
		const seen = new Set<string>();
		const result: PlanItem[] = [];
		for (const text of carryovers) {
			const key = text.trim().toLowerCase();
			if (!seen.has(key) && text.trim()) {
				seen.add(key);
				result.push({ id: `carry:${key}`, text: text.trim(), source: 'carryover', selected: true });
			}
		}
		for (const text of weekTasks) {
			const key = text.trim().toLowerCase();
			if (!seen.has(key) && text.trim()) {
				seen.add(key);
				result.push({ id: `week:${key}`, text: text.trim(), source: 'week', selected: false });
			}
		}
		return result;
	}

	onMount(() => {
		headlineEl?.focus();
		void fetchWeather();
	});

	async function fetchWeather() {
		try {
			const res = await fetch(`/api/day-plan/weather?day=${dayIso}`);
			if (!res.ok) return;
			const data = await res.json();
			if (!data.error) weather = data as WeatherSummary;
		} catch {
			// silently ignore
		}
	}

	function goToStep2() {
		if (!headline.trim()) {
			headlineEl?.focus();
			return;
		}
		step = 2;
		void fetchWeatherAndSuggestions();
	}

	async function fetchWeatherAndSuggestions() {
		// Only fetch suggestions here; weather was already fetched on mount
		const [weatherResult] = await Promise.allSettled([
			Promise.resolve(null),
			(async () => {
				loadingSuggestions = true;
				try {
					const alreadyHave = items.map((i) => i.text);
					const res = await fetch('/api/day-plan/suggestions', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							headline: headline.trim(),
							dayLabel,
							carryovers,
							weekTasks
						})
					});
					if (!res.ok) return;
					const data = await res.json() as { suggestions: string[] };
					const toAdd = (data.suggestions ?? []).filter((s) => {
						const key = s.trim().toLowerCase();
						return key && !alreadyHave.some((t) => t.trim().toLowerCase() === key);
					});
					if (toAdd.length > 0) {
						items = [
							...items,
							...toAdd.map((text) => ({
								id: `ai:${text.toLowerCase()}`,
								text,
								source: 'ai' as const,
								selected: false
							}))
						];
					}
				} finally {
					loadingSuggestions = false;
				}
			})()
		]);

		// weather already set from onMount
		void weatherResult;
	}

	function toggleItem(id: string) {
		items = items.map((i) => (i.id === id ? { ...i, selected: !i.selected } : i));
	}

	function addCustom() {
		const text = customInput.trim();
		if (!text) return;
		const key = text.toLowerCase();
		if (!items.some((i) => i.text.trim().toLowerCase() === key)) {
			items = [...items, { id: `custom:${Date.now()}`, text, source: 'custom', selected: true }];
		}
		customInput = '';
		customInputEl?.focus();
	}

	async function save() {
		if (saving) return;
		saving = true;
		error = '';

		const selectedTasks = items.filter((i) => i.selected).map((i) => i.text);

		try {
			const res = await fetch('/api/day-plan', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ dayIso, weekDashedKey, headline: headline.trim(), tasks: selectedTasks })
			});
			if (!res.ok) throw new Error('Lagring feilet');
			onsaved();
			onclose();
		} catch {
			error = 'Noe gikk galt. Prøv igjen.';
			saving = false;
		}
	}
</script>

<!-- Backdrop -->
<div
	class="dps-backdrop"
	transition:fade={{ duration: 200 }}
	onclick={onclose}
	role="presentation"
></div>

<!-- Sheet -->
<div
	class="dps-sheet"
	transition:fly={{ y: 60, duration: 380, easing: cubicOut }}
	role="dialog"
	aria-modal="true"
	aria-label="Planlegg dag"
>
	<!-- Header -->
	<div class="dps-header">
		<div class="dps-title-group">
			<span class="dps-title">Planlegg {dayLabel}</span>
			{#if weather?.slots?.length}
				<span class="dps-title-weather" aria-hidden="true">
					{#each weather.slots as slot (slot.hour)}{slot.emoji}{/each}
				</span>
			{/if}
		</div>
		<button class="dps-close" onclick={onclose} aria-label="Lukk">✕</button>
	</div>

	<!-- Step indicator -->
	<div class="dps-steps" aria-hidden="true">
		<div class="dps-step" class:active={step >= 1} class:done={step > 1}>
			<div class="dps-step-dot">{step > 1 ? '✓' : '1'}</div>
			<span class="dps-step-label">Enlinjer</span>
		</div>
		<div class="dps-step-line" class:done={step > 1}></div>
		<div class="dps-step" class:active={step >= 2}>
			<div class="dps-step-dot">2</div>
			<span class="dps-step-label">Oppgaver</span>
		</div>
	</div>

	<!-- Step content -->
	<div class="dps-content">
		{#if step === 1}
			<div
				class="dps-step-body"
				in:fly={{ y: 10, duration: 220, easing: cubicOut }}
			>
				<p class="dps-question">Hva handler {dayLabel} om?</p>
				<textarea
					bind:this={headlineEl}
					bind:value={headline}
					class="dps-textarea"
					rows="3"
					placeholder="F.eks: Holde familien flytende mens Nils er syk. Lave jobbambisjoner."
					onkeydown={(e) => {
						if (e.key === 'Enter' && !e.shiftKey) {
							e.preventDefault();
							goToStep2();
						}
					}}
				></textarea>
				<div class="dps-actions">
					<button
						class="dps-btn-primary"
						type="button"
						onclick={goToStep2}
						disabled={!headline.trim()}
					>
						Neste →
					</button>
				</div>
			</div>
		{:else}
			<div
				class="dps-step-body"
				in:fly={{ y: 10, duration: 220, easing: cubicOut }}
			>
				<p class="dps-headline-preview">{headline}</p>

				{#if weather?.current?.temperatureC != null}
					<div class="dps-weather-chip">
						{#each weather.slots as slot (slot.hour)}<span class="dps-weather-slot-icon">{slot.emoji}</span>{/each}
						<span class="dps-weather-sep">·</span>
						<span>{Math.round(weather.current.temperatureC)}°</span>
					</div>
				{/if}

				<p class="dps-question">Dagsoppgaver</p>

				{#if items.length > 0}
					<ul class="dps-item-list">
						{#each items as item (item.id)}
							<li>
								<button
									type="button"
									class="dps-item"
									class:selected={item.selected}
									onclick={() => toggleItem(item.id)}
								>
									<span class="dps-item-check">{item.selected ? '✓' : ''}</span>
									<span class="dps-item-text">{item.text}</span>
									{#if item.source !== 'custom'}
										<span class="dps-item-badge">
											{item.source === 'carryover' ? 'overligger' : item.source === 'week' ? 'ukesmål' : 'forslag'}
										</span>
									{/if}
								</button>
							</li>
						{/each}
					</ul>
				{/if}

				{#if loadingSuggestions}
					<div class="dps-suggestions-loading">
						<span class="dps-loading-dot"></span>
						Henter forslag…
					</div>
				{/if}

				<div class="dps-add-row">
					<input
						bind:this={customInputEl}
						bind:value={customInput}
						class="dps-add-input"
						type="text"
						placeholder="Legg til oppgave…"
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault();
								addCustom();
							}
						}}
					/>
					<button
						type="button"
						class="dps-add-btn"
						onclick={addCustom}
						disabled={!customInput.trim()}
					>+</button>
				</div>

				{#if error}
					<p class="dps-error">{error}</p>
				{/if}

				<div class="dps-actions">
					<button type="button" class="dps-btn-ghost" onclick={() => (step = 1)}>
						← Tilbake
					</button>
					<button
						class="dps-btn-primary"
						type="button"
						onclick={() => void save()}
						disabled={saving}
					>
						{saving ? 'Lagrer…' : 'Lagre plan'}
					</button>
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.dps-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		z-index: 200;
	}

	.dps-sheet {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		background: #0f0f0f;
		border-radius: 20px 20px 0 0;
		border-top: 1px solid #1e1e1e;
		z-index: 201;
		display: flex;
		flex-direction: column;
		max-height: 85dvh;
		max-width: 520px;
		margin: 0 auto;
		overflow: hidden;
	}

	.dps-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px 20px 12px;
		border-bottom: 1px solid #1a1a1a;
		flex-shrink: 0;
	}

	.dps-title-group {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.dps-title {
		font-size: 0.9rem;
		font-weight: 700;
		color: #eee;
		letter-spacing: -0.01em;
		white-space: nowrap;
	}

	.dps-title-weather {
		display: flex;
		align-items: center;
		gap: 2px;
		font-size: 0.95rem;
		line-height: 1;
	}

	.dps-close {
		width: 30px;
		height: 30px;
		background: #1e1e1e;
		border: 1px solid #2a2a2a;
		border-radius: 50%;
		color: #666;
		font-size: 0.7rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: color 0.12s, border-color 0.12s;
	}
	.dps-close:hover { color: #ccc; border-color: #555; }

	/* Step indicator */
	.dps-steps {
		display: flex;
		align-items: center;
		padding: 14px 28px 10px;
		border-bottom: 1px solid #141414;
		flex-shrink: 0;
	}

	.dps-step {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 5px;
	}

	.dps-step-dot {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		border: 2px solid #2a2a2a;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.75rem;
		font-weight: 700;
		color: #444;
		background: transparent;
		transition: all 0.2s;
	}

	.dps-step.active .dps-step-dot {
		border-color: #4b6ef5;
		color: #4b6ef5;
	}

	.dps-step.done .dps-step-dot {
		border-color: #4b6ef5;
		background: #4b6ef5;
		color: #fff;
	}

	.dps-step-label {
		font-size: 0.7rem;
		color: #3a3a3a;
		font-weight: 500;
	}

	.dps-step.active .dps-step-label,
	.dps-step.done .dps-step-label {
		color: #7a8fdf;
	}

	.dps-step-line {
		flex: 1;
		height: 2px;
		background: #1e1e1e;
		margin: 0 8px 16px;
		transition: background 0.2s;
	}

	.dps-step-line.done {
		background: #4b6ef5;
	}

	/* Content */
	.dps-content {
		flex: 1;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
	}

	.dps-step-body {
		padding: 20px 20px 36px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.dps-question {
		font-size: 0.95rem;
		font-weight: 600;
		color: #dde;
		margin: 0;
	}

	.dps-headline-preview {
		font-size: 0.85rem;
		color: #8ba0f5;
		font-style: italic;
		margin: 0;
		padding: 9px 13px;
		background: #0c1020;
		border-radius: 8px;
		border-left: 3px solid #4b6ef5;
		line-height: 1.5;
	}

	.dps-textarea {
		width: 100%;
		background: #141414;
		border: 1px solid #2a2a2a;
		border-radius: 10px;
		color: #ddd;
		font-size: 0.95rem;
		line-height: 1.5;
		padding: 12px 14px;
		resize: none;
		font-family: inherit;
		transition: border-color 0.12s;
		box-sizing: border-box;
	}

	.dps-textarea:focus {
		outline: none;
		border-color: #4b6ef5;
	}

	/* Task list */
	.dps-item-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.dps-item {
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
		color: #666;
		transition: background 0.1s, border-color 0.1s, color 0.1s;
	}

	.dps-item.selected {
		background: #0d1828;
		border-color: #2a4080;
		color: #c8d4ef;
	}

	.dps-item-check {
		width: 18px;
		height: 18px;
		border-radius: 5px;
		border: 1.5px solid #2a2a2a;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.65rem;
		font-weight: 700;
		flex-shrink: 0;
		transition: all 0.1s;
	}

	.dps-item.selected .dps-item-check {
		border-color: #4b6ef5;
		background: #4b6ef5;
		color: #fff;
	}

	.dps-item-text {
		flex: 1;
		font-size: 0.9rem;
	}

	.dps-item-badge {
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #3a3a4a;
		flex-shrink: 0;
	}

	.dps-item.selected .dps-item-badge {
		color: #4a5a8a;
	}

	/* Add row */
	.dps-add-row {
		display: flex;
		gap: 8px;
		align-items: center;
	}

	.dps-add-input {
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

	.dps-add-input:focus {
		outline: none;
		border-color: #4b6ef5;
	}

	.dps-add-btn {
		width: 36px;
		height: 36px;
		background: #141414;
		border: 1px solid #1e1e1e;
		border-radius: 8px;
		color: #666;
		font-size: 1.1rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		transition: background 0.1s, color 0.1s;
	}

	.dps-add-btn:not(:disabled):hover { background: #1a1a1a; color: #ccc; }
	.dps-add-btn:disabled { opacity: 0.3; cursor: default; }

	/* Actions */
	.dps-actions {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		margin-top: 4px;
	}

	.dps-btn-primary {
		background: #4b6ef5;
		border: none;
		border-radius: 10px;
		color: #fff;
		font-size: 0.9rem;
		font-weight: 600;
		padding: 11px 22px;
		cursor: pointer;
		transition: background 0.12s, opacity 0.12s;
	}

	.dps-btn-primary:hover:not(:disabled) { background: #3d5ee0; }
	.dps-btn-primary:disabled { opacity: 0.45; cursor: default; }

	.dps-btn-ghost {
		background: transparent;
		border: 1px solid #2a2a2a;
		border-radius: 10px;
		color: #555;
		font-size: 0.9rem;
		padding: 11px 16px;
		cursor: pointer;
		transition: border-color 0.12s, color 0.12s;
	}

	.dps-btn-ghost:hover { border-color: #444; color: #aaa; }

	.dps-error {
		color: #e88;
		font-size: 0.85rem;
		margin: 0;
	}

	/* Weather chip */
	.dps-weather-chip {
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

	.dps-weather-slot-icon {
		font-size: 0.9rem;
		line-height: 1;
	}

	.dps-weather-sep {
		color: #2a3040;
	}

	/* AI suggestions loading */
	.dps-suggestions-loading {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 0.8rem;
		color: #444;
		padding: 6px 0;
	}

	.dps-loading-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #4b6ef5;
		animation: dps-pulse 1s ease-in-out infinite;
	}

	@keyframes dps-pulse {
		0%, 100% { opacity: 0.3; transform: scale(0.8); }
		50% { opacity: 1; transform: scale(1); }
	}
</style>
