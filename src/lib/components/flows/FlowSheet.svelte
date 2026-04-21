<script lang="ts">
	import type { Flow, FlowContext } from '$lib/flows/types';
	import Icon from '$lib/components/ui/Icon.svelte';
	import TriageCard from '$lib/components/composed/TriageCard.svelte';
	import ChatStatusWidget from '$lib/components/domain/ChatStatusWidget.svelte';
	import ChatInput from '$lib/components/ui/ChatInput.svelte';
	import { streamProxyChat } from '$lib/client/proxy-chat-stream';
	import type { WeatherStatusWidget } from '$lib/ai/tools/weather-forecast';
	import { onMount, tick, untrack } from 'svelte';
	import { fly, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';

	const PLAN_KLAR_MARKER = '[PLAN_KLAR]';
	function parseChatMessage(raw: string): { text: string; confirmAction?: string } {
		if (raw.includes(PLAN_KLAR_MARKER)) {
			return { text: raw.replace(PLAN_KLAR_MARKER, '').trim(), confirmAction: 'Ja, lagre planen' };
		}
		return { text: raw };
	}

	// ── Checklist item ──────────────────────────────────────────────
	interface ChecklistItem {
		id: string;
		text: string;
		source: 'carryover' | 'week' | 'custom' | 'ai';
		selected: boolean;
	}

	// ── Weather ─────────────────────────────────────────────────────
	interface WeatherSlot { hour: number; emoji: string; tempC: number | null }
	interface WeatherData {
		slots: WeatherSlot[];
		current: { temperatureC: number | null };
	}

	// ── Props ────────────────────────────────────────────────────────
	interface Props {
		flow: Flow | null;
		context?: FlowContext;
		onclose?: () => void;
		oncomplete?: (data: Record<string, any>) => void | Promise<void>;
	}

	let { flow, context = {}, onclose, oncomplete }: Props = $props();

	// ── Core state ───────────────────────────────────────────────────
	let currentStepIndex = $state(0);
	let flowData = $state<Record<string, any>>({});
	let completing = $state(false);
	let completionError = $state('');

	// ── Chat state ───────────────────────────────────────────────────
	interface RichChatMsg {
		role: 'user' | 'assistant';
		text: string;
		statusWidget?: WeatherStatusWidget | null;
		confirmAction?: string;
	}
	let chatMessages = $state<RichChatMsg[]>([]);
	let flowConversationId = $state<string | null>(null);
	let chatLoading = $state(false);
	let chatStreamingText = $state('');
	let chatStreamingStatus = $state('');
	let chatMessagesEl = $state<HTMLDivElement | null>(null);

	// ── Checklist state ──────────────────────────────────────────────
	let checklistItems = $state<ChecklistItem[]>([]);
	let checklistCustomInput = $state('');
	let checklistCustomInputEl = $state<HTMLInputElement | null>(null);
	let loadingAiSuggestions = $state(false);

	// ── Decision-list state ──────────────────────────────────────────
	let decisions = $state<Record<string, 'carryover' | 'unsolved'>>({});

	// ── Weather ──────────────────────────────────────────────────────
	let weather = $state<WeatherData | null>(null);

	// ── Validation ───────────────────────────────────────────────────
	let validationError = $state<string | null>(null);

	// ── Derived ──────────────────────────────────────────────────────
	const currentStep = $derived(flow?.steps?.[currentStepIndex]);
	const isFirstStep = $derived(currentStepIndex === 0);
	const isLastStep = $derived(flow?.steps ? currentStepIndex === flow.steps.length - 1 : true);

	const canProceed = $derived.by(() => {
		if (!currentStep) return false;
	if (currentStep?.type === 'chat') return chatMessages.some((m) => m.role === 'assistant');
		if (currentStep.type === 'checklist') return true; // always, even 0 selected
		if (currentStep.type === 'decision-list') return true;
		const fields = currentStep.fields ?? [];
		return fields.every((field) => {
			if (!field.required) return true;
			const value = flowData[field.id];
			return value !== undefined && value !== null && value !== '';
		});
	});

	// ── Lifecycle ────────────────────────────────────────────────────
	onMount(async () => {
		// Seed initial flowData from context
		if (context.existingHeadline) flowData['headline'] = context.existingHeadline;

		// Fetch weather if we have a day context
		if (context.dayIso) {
			fetch(`/api/day-plan/weather?day=${context.dayIso}`)
				.then((r) => r.json())
				.then((d) => { if (!d.error) weather = d as WeatherData; })
				.catch(() => {});
		}
		// Chat init is handled by $effect below
	});

	// When step changes, init step-specific state
	$effect(() => {
		const step = currentStep;
		if (!step) return;

		validationError = null;

		if (step.type === 'chat') {
			const prompt = context.prompts?.[step.id] ?? step.prompt;
			untrack(() => {
				chatMessages = [];
				if (step.autoSend && prompt) {
					void sendChatMessage(prompt, true);
				} else if (prompt) {
					chatMessages = [{ role: 'assistant', text: prompt }];
				}
			});
		}

		if (step.type === 'checklist') {
			untrack(() => {
				initChecklistStep(step.itemsKey, step.extraItemsKey);
				if (step.aiSuggestionsFromField) {
					const fieldValue = flowData[step.aiSuggestionsFromField!];
					void fetchAiSuggestions(fieldValue);
				}
			});
		}

		if (step.type === 'decision-list') {
			untrack(() => initDecisionListStep(step.openItemsKey));
		}
	});

	// ── Checklist helpers ────────────────────────────────────────────
	function initChecklistStep(itemsKey?: string, extraItemsKey?: string) {
		const seen = new Set<string>();
		const result: ChecklistItem[] = [];

		const primary: string[] = itemsKey ? (context as Record<string, any>)[itemsKey] ?? [] : [];
		for (const text of primary) {
			const key = text.trim().toLowerCase();
			if (key && !seen.has(key)) {
				seen.add(key);
				result.push({ id: `primary:${key}`, text: text.trim(), source: 'carryover', selected: true });
			}
		}

		const extra: string[] = extraItemsKey ? (context as Record<string, any>)[extraItemsKey] ?? [] : [];
		for (const text of extra) {
			const key = text.trim().toLowerCase();
			if (key && !seen.has(key)) {
				seen.add(key);
				result.push({ id: `extra:${key}`, text: text.trim(), source: 'week', selected: false });
			}
		}

		checklistItems = result;
		flowData['selectedTasks'] = result.filter((i) => i.selected).map((i) => i.text);
	}

	function toggleChecklistItem(id: string) {
		checklistItems = checklistItems.map((i) => i.id === id ? { ...i, selected: !i.selected } : i);
		flowData['selectedTasks'] = checklistItems.filter((i) => i.selected).map((i) => i.text);
	}

	function addCustomChecklistItem() {
		const text = checklistCustomInput.trim();
		if (!text) return;
		const key = text.toLowerCase();
		if (!checklistItems.some((i) => i.text.trim().toLowerCase() === key)) {
			const newItem: ChecklistItem = { id: `custom:${Date.now()}`, text, source: 'custom', selected: true };
			checklistItems = [...checklistItems, newItem];
			flowData['selectedTasks'] = checklistItems.filter((i) => i.selected).map((i) => i.text);
		}
		checklistCustomInput = '';
		checklistCustomInputEl?.focus();
	}

	async function fetchAiSuggestions(headline: string | undefined) {
		if (!headline?.trim()) return;
		loadingAiSuggestions = true;
		try {
			const alreadyHave = checklistItems.map((i) => i.text);
			const res = await fetch('/api/day-plan/suggestions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					headline: headline.trim(),
					dayLabel: context.dayLabel ?? '',
					carryovers: context.carryovers ?? [],
					weekTasks: context.weekTasks ?? []
				})
			});
			if (!res.ok) return;
			const data = await res.json() as { suggestions: string[] };
			const toAdd = (data.suggestions ?? []).filter((s) => {
				const key = s.trim().toLowerCase();
				return key && !alreadyHave.some((t) => t.trim().toLowerCase() === key);
			});
			if (toAdd.length > 0) {
				checklistItems = [
					...checklistItems,
					...toAdd.map((text) => ({
						id: `ai:${text.toLowerCase()}`,
						text,
						source: 'ai' as const,
						selected: false
					}))
				];
			}
		} finally {
			loadingAiSuggestions = false;
		}
	}

	// ── Decision-list helpers ────────────────────────────────────────
	function initDecisionListStep(openItemsKey?: string) {
		const items: Array<{ id: string; text: string }> =
			openItemsKey ? (context as Record<string, any>)[openItemsKey] ?? [] : [];
		decisions = Object.fromEntries(items.map((i) => [i.id, 'carryover' as const]));
		flowData['decisions'] = decisions;
		flowData['carryoverIds'] = items.filter((i) => decisions[i.id] === 'carryover').map((i) => i.id);
	}

	function toggleDecision(id: string) {
		decisions = {
			...decisions,
			[id]: decisions[id] === 'carryover' ? 'unsolved' : 'carryover'
		};
		const openItems: Array<{ id: string }> = context.openItems ?? [];
		flowData['decisions'] = decisions;
		flowData['carryoverIds'] = openItems.filter((i) => decisions[i.id] === 'carryover').map((i) => i.id);
	}

	// ── Navigation ───────────────────────────────────────────────────
	function handleFieldChange(fieldId: string, value: unknown) {
		flowData[fieldId] = value;
		validationError = null;
	}

	async function scrollChatToBottom() {
		await tick();
		if (chatMessagesEl) chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
	}

	/** userMessage=undefined means AI-initiated (autoSend prompt) */
	async function sendChatMessage(text: string, isAutoSend = false) {
		if (chatLoading) return;
		if (!isAutoSend) chatMessages = [...chatMessages, { role: 'user', text }];
		chatLoading = true;
		chatStreamingText = '';
		chatStreamingStatus = 'Starter...';
		await scrollChatToBottom();
		try {
			const data = await streamProxyChat({
				message: text,
				conversationId: flowConversationId,
				forceNewConversation: !flowConversationId,
				systemPrompt: context.systemPrompts?.[currentStep?.id ?? ''] ?? currentStep?.systemPrompt,
				onStatus: async (status) => { chatStreamingStatus = status; await scrollChatToBottom(); },
				onToken: async (token) => { chatStreamingStatus = ''; chatStreamingText += token; await scrollChatToBottom(); }
			});
			if (data.conversationId && !flowConversationId) flowConversationId = data.conversationId;
			const parsed = parseChatMessage(String(data.message ?? ''));
			chatMessages = [...chatMessages, { role: 'assistant', ...parsed, statusWidget: data.statusWidget ?? data.metadata?.statusWidget ?? null }];
		} catch {
			chatMessages = [...chatMessages, { role: 'assistant', text: 'Beklager, noe gikk galt.' }];
		} finally {
			chatStreamingText = '';
			chatStreamingStatus = '';
			chatLoading = false;
			await scrollChatToBottom();
		}
	}

	function handlePrevious() {
		if (currentStepIndex > 0) {
			currentStepIndex--;
			chatMessages = [];
		}
	}

	async function handleNext() {
		if (!currentStep) return;

		if (currentStep.validation) {
			const result = currentStep.validation(flowData);
			if (typeof result === 'string') { validationError = result; return; }
			if (result === false) { validationError = 'Fyll ut alle påkrevde felt.'; return; }
		}

		validationError = null;

		if (isLastStep) {
			await handleComplete();
		} else {
			currentStepIndex++;
		}
	}

	async function handleComplete() {
		completing = true;
		completionError = '';
		try {
			await flow?.onComplete?.(flowData, context);
			await oncomplete?.(flowData);
			onclose?.();
		} catch {
			completionError = 'Noe gikk galt. Prøv igjen.';
			completing = false;
		}
	}

	function handleClose() { onclose?.(); }

	// ── Helpers ──────────────────────────────────────────────────────
	const openItemsForDecision = $derived.by(() => {
		const step = currentStep;
		if (step?.type !== 'decision-list') return [];
		return step.openItemsKey ? (context as Record<string, any>)[step.openItemsKey] ?? [] : [];
	});

	const carryoverCount = $derived(
		Object.values(decisions).filter((v) => v === 'carryover').length
	);
</script>

<!-- Backdrop -->
{#if flow}
<div
	class="fs-backdrop"
	transition:fade={{ duration: 200 }}
	onclick={handleClose}
	role="presentation"
></div>

<!-- Sheet -->
<div
	class="fs-sheet"
	transition:fly={{ y: 60, duration: 380, easing: cubicOut }}
	role="dialog"
	aria-modal="true"
	aria-label={flow.name}
>
	<!-- Header -->
	<div class="fs-header">
		<button class="fs-close" onclick={handleClose} aria-label="Lukk">
			<Icon name="close" size={18} />
		</button>
		<div class="fs-title-group">
			<span class="fs-icon">{flow.icon}</span>
			<span class="fs-title">{flow.name}</span>
			{#if weather?.slots?.length}
				<span class="fs-weather" aria-hidden="true">
					{#each weather.slots as slot (slot.hour)}{slot.emoji}{/each}
				</span>
			{/if}
		</div>
		<span class="fs-progress-label">{currentStepIndex + 1}/{flow.steps?.length ?? 1}</span>
	</div>

	<!-- Progress bar -->
	{#if (flow.steps?.length ?? 0) > 1}
		<div class="fs-progress-bar">
			<div
				class="fs-progress-fill"
				style:width="{((currentStepIndex + 1) / (flow.steps?.length ?? 1)) * 100}%"
			></div>
		</div>
	{/if}

	<!-- Body -->
	<div class="fs-body">
		{#if currentStep}
			{#if currentStep.title}
				<h3 class="fs-step-title">{currentStep.title}</h3>
			{/if}

			<!-- ── CHAT ─────────────────────────────────────── -->
			{#if currentStep.type === 'chat'}
				<div class="fs-chat-area">
					<div class="fs-chat-messages" bind:this={chatMessagesEl} aria-live="polite">
						{#if chatMessages.length === 0 && !chatLoading}
							<p class="fs-chat-empty">{currentStep.autoSend ? 'Starter…' : 'Si hva du tenker på…'}</p>
						{/if}
						{#each chatMessages as msg, i (i)}
							{#if msg.role === 'user'}
								<div class="fs-chat-bubble-user">{msg.text}</div>
							{:else}
								<TriageCard text={msg.text} />
								{#if msg.statusWidget}
									<ChatStatusWidget widget={msg.statusWidget} />
								{/if}
								{#if msg.confirmAction && i === chatMessages.length - 1 && !chatLoading}
									<button
										type="button"
										class="fs-chat-confirm"
										onclick={() => void sendChatMessage(msg.confirmAction!)}
									>{msg.confirmAction}</button>
								{/if}
							{/if}
						{/each}
						{#if chatLoading}
							{#if chatStreamingText}
								<TriageCard text={chatStreamingText} streaming={true} />
							{:else}
								<TriageCard loading={true} status={chatStreamingStatus} />
							{/if}
						{/if}
					</div>
					<ChatInput
						placeholder="Skriv svar…"
						disabled={chatLoading}
						onsubmit={(text) => void sendChatMessage(text)}
					/>
				</div>
			{/if}

			<!-- ── FORM / MIXED ──────────────────────────────── -->
			{#if currentStep.type === 'form' || currentStep.type === 'mixed'}
				{#if currentStep.type === 'mixed' && currentStep.prompt}
					<p class="fs-step-prompt">{currentStep.prompt}</p>
				{/if}
				{#if currentStep.fields}
					<div class="fs-form">
						{#each currentStep.fields as field (field.id)}
							<label class="fs-form-field">
								<span class="fs-form-label">
									{field.label}{#if field.required}<span class="fs-required">*</span>{/if}
								</span>

								{#if field.type === 'text'}
									<input
										type="text"
										class="fs-form-input"
										placeholder={field.placeholder}
										value={flowData[field.id] ?? ''}
										oninput={(e) => handleFieldChange(field.id, e.currentTarget.value)}
									/>
								{:else if field.type === 'textarea'}
									<textarea
										class="fs-form-textarea"
										placeholder={field.placeholder}
										rows="4"
										value={flowData[field.id] ?? ''}
										oninput={(e) => handleFieldChange(field.id, e.currentTarget.value)}
									></textarea>
								{:else if field.type === 'number'}
									<input
										type="number"
										class="fs-form-input"
										placeholder={field.placeholder}
										min={field.min}
										max={field.max}
										step={field.step}
										value={flowData[field.id] ?? field.defaultValue ?? ''}
										oninput={(e) => handleFieldChange(field.id, e.currentTarget.value ? parseFloat(e.currentTarget.value) : null)}
									/>
								{:else if field.type === 'date'}
									<input
										type="date"
										class="fs-form-input"
										value={flowData[field.id] ?? ''}
										oninput={(e) => handleFieldChange(field.id, e.currentTarget.value)}
									/>
								{:else if field.type === 'select'}
									<select
										class="fs-form-select"
										value={flowData[field.id] ?? ''}
										onchange={(e) => handleFieldChange(field.id, e.currentTarget.value)}
									>
										<option value="">Velg…</option>
										{#each field.options ?? [] as opt (opt.value)}
											<option value={opt.value}>{opt.label}</option>
										{/each}
									</select>
								{:else if field.type === 'slider'}
									<div class="fs-slider-wrap">
										<input
											type="range"
											class="fs-slider"
											min={field.min ?? 0}
											max={field.max ?? 100}
											step={field.step ?? 1}
											value={flowData[field.id] ?? field.defaultValue ?? field.min ?? 0}
											oninput={(e) => handleFieldChange(field.id, parseFloat(e.currentTarget.value))}
										/>
										<span class="fs-slider-val">{flowData[field.id] ?? field.defaultValue ?? field.min ?? 0}</span>
									</div>
								{:else if field.type === 'multiselect'}
									<div class="fs-multiselect">
										{#each field.options ?? [] as opt (opt.value)}
											{@const sel = Array.isArray(flowData[field.id]) && flowData[field.id].includes(opt.value)}
											<button
												type="button"
												class="fs-ms-opt"
												class:selected={sel}
												onclick={() => {
													const cur: string[] = Array.isArray(flowData[field.id]) ? flowData[field.id] : [];
													handleFieldChange(field.id, sel ? cur.filter((v) => v !== opt.value) : [...cur, opt.value]);
												}}
											>{opt.label}</button>
										{/each}
									</div>
								{/if}
							</label>
						{/each}
					</div>
				{/if}
			{/if}

			<!-- ── CHECKLIST ──────────────────────────────────── -->
			{#if currentStep.type === 'checklist'}
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
									onclick={() => toggleChecklistItem(item.id)}
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

				<div class="fs-add-row">
					<input
						bind:this={checklistCustomInputEl}
						bind:value={checklistCustomInput}
						type="text"
						class="fs-add-input"
						placeholder="Legg til oppgave…"
						onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomChecklistItem(); } }}
					/>
					<button
						type="button"
						class="fs-add-btn"
						onclick={addCustomChecklistItem}
						disabled={!checklistCustomInput.trim()}
					>+</button>
				</div>
			{/if}

			<!-- ── DECISION-LIST ──────────────────────────────── -->
			{#if currentStep.type === 'decision-list'}
				{#if openItemsForDecision.length === 0}
					<p class="fs-empty">Alle oppgaver er fullført 🎉</p>
				{:else}
					<p class="fs-hint">Trykk for å veksle. Pil = ta med til neste dag, × = la stå.</p>
					<ul class="fs-decision-list">
						{#each openItemsForDecision as item (item.id)}
							{@const isCarryover = decisions[item.id] === 'carryover'}
							<li>
								<button
									type="button"
									class="fs-dec-item"
									class:carryover={isCarryover}
									onclick={() => toggleDecision(item.id)}
								>
									<span class="fs-dec-text">{item.text}</span>
									<span class="fs-dec-action">{isCarryover ? '→' : '×'}</span>
								</button>
							</li>
						{/each}
					</ul>
					{#if carryoverCount > 0}
						<p class="fs-carry-note">{carryoverCount} punkt{carryoverCount === 1 ? '' : 'er'} flyttes til neste dag</p>
					{/if}
				{/if}
			{/if}

			{#if validationError}
				<p class="fs-validation-error">{validationError}</p>
			{/if}
			{#if completionError}
				<p class="fs-validation-error">{completionError}</p>
			{/if}
		{/if}
	</div>

	<!-- Footer -->
	<div class="fs-footer">
		{#if !isFirstStep}
			<button class="fs-btn fs-btn-ghost" onclick={handlePrevious} disabled={completing}>← Tilbake</button>
		{/if}
		<button
			class="fs-btn fs-btn-primary"
			onclick={() => void handleNext()}
			disabled={!canProceed || completing}
		>
			{completing ? 'Lagrer…' : isLastStep ? 'Fullfør' : 'Neste →'}
		</button>
	</div>
</div>
{/if}

<style>
	.fs-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		z-index: 200;
	}

	.fs-sheet {
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
		max-height: 88dvh;
		max-width: 520px;
		margin: 0 auto;
		overflow: hidden;
	}

	/* Header */
	.fs-header {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 16px 20px 12px;
		border-bottom: 1px solid #1a1a1a;
		flex-shrink: 0;
	}

	.fs-close {
		background: #1e1e1e;
		border: 1px solid #2a2a2a;
		border-radius: 50%;
		width: 30px;
		height: 30px;
		color: #666;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		transition: color 0.12s, border-color 0.12s;
	}
	.fs-close:hover { color: #ccc; border-color: #555; }

	.fs-title-group {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		min-width: 0;
	}
	.fs-icon { font-size: 1.1rem; }
	.fs-title {
		font-size: 0.9rem;
		font-weight: 700;
		color: #eee;
		letter-spacing: -0.01em;
		white-space: nowrap;
	}
	.fs-weather {
		display: flex;
		gap: 2px;
		font-size: 0.9rem;
		line-height: 1;
	}
	.fs-progress-label {
		font-size: 0.75rem;
		color: #3a3a4a;
		font-weight: 500;
		flex-shrink: 0;
	}

	/* Progress bar */
	.fs-progress-bar {
		height: 2px;
		background: #141414;
		flex-shrink: 0;
	}
	.fs-progress-fill {
		height: 100%;
		background: #4b6ef5;
		transition: width 0.3s ease;
	}

	/* Body */
	.fs-body {
		flex: 1;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
		padding: 20px 20px 8px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.fs-step-title {
		font-size: 0.95rem;
		font-weight: 600;
		color: #dde;
		margin: 0;
	}
	.fs-step-prompt {
		font-size: 0.88rem;
		color: #7a8090;
		line-height: 1.5;
		margin: 0;
	}
	.fs-empty {
		font-size: 1rem;
		color: #7a9a7a;
		text-align: center;
		padding: 12px 0;
		margin: 0;
	}
	.fs-hint {
		font-size: 0.8rem;
		color: #3a3a4a;
		margin: 0;
	}

	/* Chat */
	.fs-chat-area {
		display: flex;
		flex-direction: column;
		gap: 8px;
		flex: 1;
		min-height: 0;
	}
	.fs-chat-messages {
		flex: 1;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding-bottom: 4px;
		min-height: 200px;
	}
	.fs-chat-empty {
		font-size: 0.88rem;
		color: #3a3a4a;
		text-align: center;
		padding: 20px 0;
		margin: 0;
	}
	.fs-chat-bubble-user {
		background: #0d1828;
		border: 1px solid #2a4080;
		color: #c8d4ef;
		padding: 9px 13px;
		border-radius: 12px;
		max-width: 86%;
		font-size: 0.88rem;
		line-height: 1.45;
		align-self: flex-end;
	}
	.fs-chat-confirm {
		background: #0d1828;
		border: 1px solid #2a4080;
		color: #8bb4ef;
		padding: 9px 16px;
		border-radius: 8px;
		font-size: 0.88rem;
		cursor: pointer;
		font-family: inherit;
		transition: background 0.12s, border-color 0.12s;
		align-self: flex-start;
	}
	.fs-chat-confirm:hover { background: #112038; border-color: #3a50a0; }

	/* Form */
	.fs-form { display: flex; flex-direction: column; gap: 14px; }
	.fs-form-field { display: flex; flex-direction: column; gap: 5px; }
	.fs-form-label { font-size: 0.82rem; font-weight: 500; color: #8899aa; }
	.fs-required { color: hsl(0 60% 60%); margin-left: 2px; }
	.fs-form-input,
	.fs-form-textarea,
	.fs-form-select {
		background: #141414;
		border: 1px solid #1e1e1e;
		border-radius: 10px;
		padding: 10px 12px;
		color: #ddd;
		font-size: 0.88rem;
		font-family: inherit;
		transition: border-color 0.12s;
	}
	.fs-form-input:focus, .fs-form-textarea:focus, .fs-form-select:focus {
		outline: none;
		border-color: #4b6ef5;
	}
	.fs-slider-wrap { display: flex; align-items: center; gap: 12px; }
	.fs-slider {
		flex: 1;
		height: 6px;
		border-radius: 3px;
		background: #1e1e1e;
		-webkit-appearance: none;
		appearance: none;
	}
	.fs-slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 18px; height: 18px;
		border-radius: 50%;
		background: #4b6ef5;
		cursor: pointer;
	}
	.fs-slider-val { font-size: 0.9rem; font-weight: 600; color: #8ba0f5; min-width: 36px; text-align: right; }
	.fs-multiselect { display: flex; flex-wrap: wrap; gap: 7px; }
	.fs-ms-opt {
		background: #141414;
		border: 1px solid #1e1e1e;
		color: #666;
		padding: 7px 13px;
		border-radius: 8px;
		font-size: 0.82rem;
		cursor: pointer;
		transition: all 0.1s;
	}
	.fs-ms-opt.selected { background: #0d1828; border-color: #2a4080; color: #c8d4ef; }

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
		border: 1px solid #1e1e1e;
		border-radius: 8px;
		color: #666;
		font-size: 1.1rem;
		cursor: pointer;
		display: flex; align-items: center; justify-content: center;
		flex-shrink: 0;
		transition: all 0.1s;
	}
	.fs-add-btn:not(:disabled):hover { background: #1a1a1a; color: #ccc; }
	.fs-add-btn:disabled { opacity: 0.3; cursor: default; }

	/* Decision list */
	.fs-decision-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
	.fs-dec-item {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 11px 14px;
		background: #141414;
		border: 1px solid #1e1e1e;
		border-radius: 10px;
		cursor: pointer;
		text-align: left;
		color: #555;
		transition: all 0.1s;
	}
	.fs-dec-item.carryover { background: #0d1828; border-color: #2a4080; color: #c8d4ef; }
	.fs-dec-text { flex: 1; font-size: 0.9rem; line-height: 1.4; }
	.fs-dec-action { font-size: 1rem; font-weight: 700; width: 22px; text-align: center; flex-shrink: 0; opacity: 0.7; }
	.fs-dec-item.carryover .fs-dec-action { color: #4b6ef5; opacity: 1; }
	.fs-carry-note { font-size: 0.8rem; color: #4a5a8a; margin: 0; }

	/* Validation */
	.fs-validation-error {
		color: #e88;
		font-size: 0.85rem;
		margin: 0;
		padding: 8px 12px;
		background: hsl(0 40% 10%);
		border: 1px solid hsl(0 40% 20%);
		border-radius: 8px;
	}

	/* Footer */
	.fs-footer {
		display: flex;
		gap: 10px;
		padding: 14px 20px 28px;
		border-top: 1px solid #1a1a1a;
		flex-shrink: 0;
	}
	.fs-btn {
		flex: 1;
		padding: 12px 18px;
		border-radius: 10px;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.12s;
	}
	.fs-btn:disabled { opacity: 0.45; cursor: default; }
	.fs-btn-primary { background: #4b6ef5; border: none; color: #fff; }
	.fs-btn-primary:hover:not(:disabled) { background: #3d5ee0; }
	.fs-btn-ghost { background: transparent; border: 1px solid #2a2a2a; color: #555; }
	.fs-btn-ghost:hover:not(:disabled) { border-color: #444; color: #aaa; }
</style>
