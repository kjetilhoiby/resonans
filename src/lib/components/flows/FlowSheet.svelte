<script lang="ts">
	import type { Flow, FlowContext } from '$lib/flows/types';
	import Icon from '$lib/components/ui/Icon.svelte';
	import TriageCard from '$lib/components/composed/TriageCard.svelte';
	import ChatStatusWidget from '$lib/components/domain/ChatStatusWidget.svelte';
	import ChatInput from '$lib/components/ui/ChatInput.svelte';
	import { ChatState } from '$lib/client/chat-state.svelte';
	import type { WeatherStatusWidget } from '$lib/ai/tools/weather-forecast';
	import { onMount, tick, untrack } from 'svelte';
	import { fly, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';

	const PLAN_KLAR_MARKER = '[PLAN_KLAR]';
	function parseChatMessage(raw: string): { text: string; confirmAction?: string } {
		let text = raw;
		let confirmAction: string | undefined;

		if (text.includes(PLAN_KLAR_MARKER)) {
			text = text.replace(PLAN_KLAR_MARKER, '').trim();
			confirmAction = 'Ja, lagre planen';
		}

		// Reformater <oppgaver>...</oppgaver>-blokker som bullet-liste for visning.
		// Rå-teksten beholdes på meldingen så onComplete kan parse markørene direkte.
		text = text.replace(/<oppgaver>\s*([\s\S]*?)\s*<\/oppgaver>/gi, (_match, block: string) => {
			const items = block
				.split('\n')
				.map((l) => l.trim().replace(/^[-*•·]\s*/, '').replace(/^\d+[.)]\s*/, '').trim())
				.filter((l) => l.length > 0);
			if (items.length === 0) return '';
			return items.map((i) => `- ${i}`).join('\n');
		});

		return { text, confirmAction };
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
		/** Trigget når brukeren tapper en steg-spesifikk secondaryAction-knapp i footeren */
		onsecondaryaction?: (action: { id: string; data: Record<string, any> }) => void;
	}

	let { flow, context = {}, onclose, oncomplete, onsecondaryaction }: Props = $props();

	function handleSecondaryAction() {
		const action = currentStep?.secondaryAction;
		if (!action) return;
		onsecondaryaction?.({ id: action.id, data: { ...flowData } });
	}

	// ── Core state ───────────────────────────────────────────────────
	let currentStepIndex = $state(0);
	let flowData = $state<Record<string, any>>({ ...(context.initialData ?? {}) });
	let completing = $state(false);
	let completionError = $state('');
	let autoAdvanceTimer = $state<ReturnType<typeof setTimeout> | null>(null);
	let pyramidExpanded = $state(false);

	// ── Chat state ───────────────────────────────────────────────────
	interface RichChatMsg {
		role: 'user' | 'assistant';
		text: string;
		rawText?: string;
		statusWidget?: WeatherStatusWidget | null;
		confirmAction?: string;
	}
	let chatMessages = $state<RichChatMsg[]>([]);
	let chatMessagesEl = $state<HTMLDivElement | null>(null);

	// ChatState leverer streaming-tilstand; chatMessages styres lokalt for å støtte confirmAction
	const flowChat = new ChatState({
		systemPrompt: () => {
			const step = currentStep;
			if (!step) return undefined;
			if (context.systemPrompts?.[step.id]) return context.systemPrompts[step.id];
			const built = step.buildPrompts?.(flowData);
			if (built?.systemPrompt) return built.systemPrompt;
			return step.systemPrompt ?? undefined;
		},
		onAssistantMessage: (msg, _data) => {
			const parsed = parseChatMessage(msg.text);
			chatMessages = [...chatMessages, {
				role: 'assistant' as const,
				text: parsed.text,
				rawText: msg.text,
				confirmAction: parsed.confirmAction,
				statusWidget: msg.statusWidget
			}];
			return false; // FlowSheet styrer chatMessages selv
		}
	});

	// ── Checklist state ──────────────────────────────────────────────
	let checklistItems = $state<ChecklistItem[]>([]);
	let checklistCustomInput = $state('');
	let checklistCustomInputEl = $state<HTMLInputElement | null>(null);
	let loadingAiSuggestions = $state(false);
	let refinementInput = $state('');
	let refinementInputEl = $state<HTMLInputElement | null>(null);
	let refinementHistory = $state<string[]>([]);

	// ── Decision-list state ──────────────────────────────────────────
	let decisions = $state<Record<string, 'carryover' | 'unsolved'>>({});

	// ── Weather ──────────────────────────────────────────────────────
	let weather = $state<WeatherData | null>(null);

	// ── Validation ───────────────────────────────────────────────────
	let validationError = $state<string | null>(null);

	// ── Derived ──────────────────────────────────────────────────────
	const isFocus = $derived(flow?.focus === true);
	const totalSteps = $derived(flow?.steps?.length ?? 1);
	const currentStep = $derived(flow?.steps?.[currentStepIndex]);
	const isFirstStep = $derived(currentStepIndex === 0);
	function findNextStepIndex(from: number, data: Record<string, any>): number {
		const steps = flow?.steps;
		if (!steps) return from + 1;
		let i = from + 1;
		while (i < steps.length) {
			const s = steps[i];
			if (s.skipIf && s.skipIf(data)) i++;
			else return i;
		}
		return steps.length; // means "no further step exists"
	}
	function findPreviousStepIndex(from: number, data: Record<string, any>): number {
		const steps = flow?.steps;
		if (!steps) return from - 1;
		let i = from - 1;
		while (i >= 0) {
			const s = steps[i];
			if (s.skipIf && s.skipIf(data)) i--;
			else return i;
		}
		return -1;
	}
	const isLastStep = $derived(
		flow?.steps ? findNextStepIndex(currentStepIndex, flowData) >= flow.steps.length : true
	);

	const canProceed = $derived.by(() => {
		if (!currentStep) return false;
	if (currentStep?.type === 'chat') return chatMessages.some((m) => m.role === 'assistant');		if (currentStep.type === 'checklist') return true; // always, even 0 selected
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
		if (context.dreamReasons) flowData['_dreamReasons'] = context.dreamReasons;
		if (context.slot) flowData['_slot'] = context.slot;

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
		clearAutoAdvance();
		pyramidExpanded = false;

		if (step.type === 'chat') {
			const built = step.buildPrompts?.(flowData);
			const prompt = context.prompts?.[step.id] ?? built?.prompt ?? step.prompt;
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
				refinementInput = '';
				refinementHistory = [];
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

	async function fetchAiSuggestions(headline: string | undefined, refinementPrompt?: string) {
		if (!headline?.trim() && !refinementPrompt?.trim()) return;
		loadingAiSuggestions = true;
		try {
			const alreadyHave = checklistItems.map((i) => i.text);
			const res = await fetch('/api/day-plan/suggestions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					headline: headline?.trim() ?? '',
					dayLabel: context.dayLabel ?? '',
					carryovers: context.carryovers ?? [],
					weekTasks: context.weekTasks ?? [],
					...(refinementPrompt ? { refinementPrompt } : {})
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

	async function sendRefinementPrompt() {
		const prompt = refinementInput.trim();
		if (!prompt || loadingAiSuggestions) return;
		refinementHistory = [...refinementHistory, prompt];
		refinementInput = '';
		const fieldValue = currentStep?.aiSuggestionsFromField ? flowData[currentStep.aiSuggestionsFromField] : undefined;
		await fetchAiSuggestions(fieldValue, prompt);
		await tick();
		refinementInputEl?.focus();
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

	// ── Auto-advance ────────────────────────────────────────────────
	function clearAutoAdvance() {
		if (autoAdvanceTimer) {
			clearTimeout(autoAdvanceTimer);
			autoAdvanceTimer = null;
		}
	}

	function startAutoAdvance() {
		clearAutoAdvance();
		const step = currentStep;
		if (!step?.autoAdvance) return;
		const delay = typeof step.autoAdvance === 'object' ? step.autoAdvance.delayMs : 600;
		autoAdvanceTimer = setTimeout(() => {
			autoAdvanceTimer = null;
			void handleNext();
		}, delay);
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
		if (flowChat.loading) return;
		if (!isAutoSend) chatMessages = [...chatMessages, { role: 'user', text }];
		await scrollChatToBottom();
		await flowChat.send(text);
		await scrollChatToBottom();
	}

	function handlePrevious() {
		const prev = findPreviousStepIndex(currentStepIndex, flowData);
		if (prev >= 0) {
			currentStepIndex = prev;
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

		if (currentStep.type === 'chat') {
			const lastAssistant = [...chatMessages].reverse().find((m) => m.role === 'assistant');
			if (lastAssistant) {
				flowData = {
					...flowData,
					[`${currentStep.id}_lastMessage`]: lastAssistant.rawText ?? lastAssistant.text
				};
			}
			if (chatMessages.length > 0) {
				flowData = { ...flowData, [`${currentStep.id}_thread`]: chatMessages.map((m) => ({ role: m.role, text: m.text })) };
			}
		}

		if (isLastStep) {
			await handleComplete();
		} else {
			currentStepIndex = findNextStepIndex(currentStepIndex, flowData);
		}
	}

	async function handleComplete() {
		completing = true;
		completionError = '';
		try {
			await flow?.onComplete?.(flowData, context);
			await oncomplete?.({ ...flowData, conversationId: flowChat.conversationId ?? undefined });
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
{#if !isFocus}
<div
	class="fs-backdrop"
	transition:fade={{ duration: 200 }}
	onclick={handleClose}
	role="presentation"
></div>
{/if}

<!-- Sheet -->
<div
	class="fs-sheet"
	class:fs-focus={isFocus}
	transition:fly={{ y: isFocus ? 0 : 60, duration: 380, easing: cubicOut }}
	role="dialog"
	aria-modal="true"
	aria-label={flow.name}
>
	<!-- Header -->
	<div class="fs-header" class:fs-focus-header={isFocus}>
		{#if isFocus}
			<button class="fs-focus-close" onclick={handleClose} aria-label="Lukk">
				<Icon name="close" size={20} />
			</button>
			{#if totalSteps > 1}
				<div class="fs-dots">
					{#each Array(totalSteps) as _, i}
						<span class="fs-dot" class:fs-dot-active={i === currentStepIndex} class:fs-dot-done={i < currentStepIndex}></span>
					{/each}
				</div>
			{/if}
			<span class="fs-focus-counter">{currentStepIndex + 1}/{totalSteps}</span>
		{:else}
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
			<span class="fs-progress-label">{currentStepIndex + 1}/{totalSteps}</span>
		{/if}
	</div>

	<!-- Progress bar (non-focus only) -->
	{#if !isFocus && totalSteps > 1}
		<div class="fs-progress-bar">
			<div
				class="fs-progress-fill"
				style:width="{((currentStepIndex + 1) / totalSteps) * 100}%"
			></div>
		</div>
	{/if}

	<!-- Body -->
	<div class="fs-body" class:fs-focus-body={isFocus}>
		{#if currentStep}
			{#if currentStep.title}
				<h3 class="fs-step-title" class:fs-focus-title={isFocus}>{currentStep.title}</h3>
			{/if}
			{#if isFocus && currentStep.prompt && currentStep.type !== 'mixed'}
				<p class="fs-focus-prompt">{currentStep.prompt}</p>
			{/if}

			<!-- ── CHAT ─────────────────────────────────────── -->
			{#if currentStep.type === 'chat'}
				<div class="fs-chat-area">
					<div class="fs-chat-messages" bind:this={chatMessagesEl} aria-live="polite">
						{#if chatMessages.length === 0 && !flowChat.loading}
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
								{#if msg.confirmAction && i === chatMessages.length - 1 && !flowChat.loading}
									<button
										type="button"
										class="fs-chat-confirm"
										onclick={() => void sendChatMessage(msg.confirmAction!)}
									>{msg.confirmAction}</button>
								{/if}
							{/if}
						{/each}
						{#if flowChat.loading}
							{#if flowChat.streamingText}
								<TriageCard text={flowChat.streamingText} streaming={true} />
							{:else}
								<TriageCard loading={true} steps={flowChat.streamingSteps} />
							{/if}
						{/if}
					</div>
					<ChatInput
						placeholder="Skriv svar…"
						disabled={flowChat.loading}
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
					<div class="fs-form" class:fs-focus-form={isFocus}>
						{#each currentStep.fields as field (field.id)}
							<label class="fs-form-field" class:fs-focus-field={isFocus}>
								{#if !isFocus}
								<span class="fs-form-label">
									{field.label}{#if field.required}<span class="fs-required">*</span>{/if}
								</span>
								{/if}

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
									{@const selOptions = field.optionsFn ? field.optionsFn(flowData, context) : (field.options ?? [])}
									<select
										class="fs-form-select"
										value={flowData[field.id] ?? ''}
										onchange={(e) => handleFieldChange(field.id, e.currentTarget.value)}
									>
										<option value="">Velg…</option>
										{#each selOptions as opt (opt.value)}
											<option value={opt.value}>{opt.label}</option>
										{/each}
									</select>
								{:else if field.type === 'slider'}
									{@const sliderVal = flowData[field.id] ?? field.defaultValue ?? field.min ?? 0}
									{@const sliderMin = field.min ?? 0}
									{@const sliderMax = field.max ?? 100}
									{@const sliderPct = ((sliderVal - sliderMin) / (sliderMax - sliderMin)) * 100}
									{#if isFocus}
										<div class="fs-focus-slider-display">
											{#if field.helperLabels && field.helperLabels[sliderVal] !== undefined}
												<span class="fs-focus-slider-label">{field.helperLabels[sliderVal]}</span>
											{/if}
										</div>
										<div class="fs-focus-slider-track">
											<div class="fs-focus-slider-fill" style:width="{sliderPct}%"></div>
											<input
												type="range"
												class="fs-focus-slider"
												min={sliderMin}
												max={sliderMax}
												step={field.step ?? 1}
												value={sliderVal}
												oninput={(e) => { clearAutoAdvance(); handleFieldChange(field.id, parseFloat(e.currentTarget.value)); }}
												onpointerup={startAutoAdvance}
												ontouchend={startAutoAdvance}
											/>
										</div>
									{:else}
									<div class="fs-slider-wrap">
										<input
											type="range"
											class="fs-slider"
											min={sliderMin}
											max={sliderMax}
											step={field.step ?? 1}
											value={sliderVal}
											oninput={(e) => { clearAutoAdvance(); handleFieldChange(field.id, parseFloat(e.currentTarget.value)); }}
											onpointerup={startAutoAdvance}
											ontouchend={startAutoAdvance}
										/>
										<span class="fs-slider-val">{sliderVal}</span>
									</div>
									{#if field.helperLabels && field.helperLabels[sliderVal] !== undefined}
										<p class="fs-slider-helper">{field.helperLabels[sliderVal]}</p>
									{/if}
									{/if}
								{:else if field.type === 'multiselect'}
									{@const groups = field.optionGroupsFn ? field.optionGroupsFn(flowData) : null}
									{#if groups}
										{#each groups as group}
											{#if group.isActive}
												<p class="fs-pyramid-label fs-pyramid-active">{group.label}</p>
												<div class="fs-multiselect" class:fs-focus-grid={isFocus}>
													{#each group.options as opt (opt.value)}
														{@const sel = Array.isArray(flowData[field.id]) && flowData[field.id].includes(opt.value)}
														<button
															type="button"
															class="fs-ms-opt"
															class:selected={sel}
															class:fs-focus-card={isFocus}
															onclick={() => {
																const cur: string[] = Array.isArray(flowData[field.id]) ? flowData[field.id] : [];
																handleFieldChange(field.id, sel ? cur.filter((v) => v !== opt.value) : [...cur, opt.value]);
															}}
														>{opt.label}</button>
													{/each}
												</div>
											{/if}
										{/each}
										<button type="button" class="fs-pyramid-toggle" onclick={() => pyramidExpanded = !pyramidExpanded}>
											{pyramidExpanded ? 'Skjul andre nivåer' : 'Vis andre nivåer'}
										</button>
										{#if pyramidExpanded}
											{#each groups as group}
												{#if !group.isActive}
													<p class="fs-pyramid-label">{group.label}</p>
													<div class="fs-multiselect" class:fs-focus-grid={isFocus}>
														{#each group.options as opt (opt.value)}
															{@const sel = Array.isArray(flowData[field.id]) && flowData[field.id].includes(opt.value)}
															<button
																type="button"
																class="fs-ms-opt"
																class:selected={sel}
																class:fs-focus-card={isFocus}
																onclick={() => {
																	const cur: string[] = Array.isArray(flowData[field.id]) ? flowData[field.id] : [];
																	handleFieldChange(field.id, sel ? cur.filter((v) => v !== opt.value) : [...cur, opt.value]);
																}}
															>{opt.label}</button>
														{/each}
													</div>
												{/if}
											{/each}
										{/if}
									{:else}
										{@const msOptions = field.optionsFn ? field.optionsFn(flowData, context) : (field.options ?? [])}
										<div class="fs-multiselect" class:fs-focus-grid={isFocus}>
											{#each msOptions as opt (opt.value)}
												{@const sel = Array.isArray(flowData[field.id]) && flowData[field.id].includes(opt.value)}
												<button
													type="button"
													class="fs-ms-opt"
													class:selected={sel}
													class:fs-focus-card={isFocus}
													onclick={() => {
														const cur: string[] = Array.isArray(flowData[field.id]) ? flowData[field.id] : [];
														handleFieldChange(field.id, sel ? cur.filter((v) => v !== opt.value) : [...cur, opt.value]);
													}}
												>{opt.label}</button>
											{/each}
										</div>
									{/if}
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

				{#if currentStep.enableAiRefinement && currentStep.aiSuggestionsFromField}
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
							bind:value={refinementInput}
							type="text"
							class="fs-refinement-input"
							placeholder="Be om flere forslag… f.eks. «mer om hvile»"
							disabled={loadingAiSuggestions}
							onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void sendRefinementPrompt(); } }}
						/>
						<button
							type="button"
							class="fs-refinement-btn"
							onclick={() => void sendRefinementPrompt()}
							disabled={!refinementInput.trim() || loadingAiSuggestions}
							aria-label="Hent forslag"
						>↑</button>
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
					><Icon name="plus" size={16} /></button>
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
	<div class="fs-footer" class:fs-focus-footer={isFocus}>
		{#if isFocus}
			{#if !isFirstStep}
				<button class="fs-focus-back" onclick={handlePrevious} disabled={completing} aria-label="Tilbake">
					<Icon name="back" size={20} />
				</button>
			{/if}
			<div class="fs-focus-spacer"></div>
			{#if currentStep?.secondaryAction}
				<button
					class="fs-focus-secondary"
					onclick={handleSecondaryAction}
					disabled={completing}
					aria-label={currentStep.secondaryAction.label ?? 'Tilleggshandling'}
				>
					<span class="fs-focus-secondary-icon">{currentStep.secondaryAction.icon}</span>
				</button>
			{/if}
			<button
				class="fs-focus-next"
				onclick={() => void handleNext()}
				disabled={!canProceed || completing}
				aria-label={isLastStep ? 'Fullfør' : 'Neste'}
			>
				{#if completing}
					<span class="fs-focus-next-text">…</span>
				{:else if isLastStep}
					<span class="fs-focus-next-text">✓</span>
				{:else}
					<span class="fs-focus-next-arrow">›</span>
				{/if}
			</button>
		{:else}
			{#if !isFirstStep}
				<button class="fs-btn fs-btn-ghost" onclick={handlePrevious} disabled={completing}>← Tilbake</button>
			{/if}
			{#if currentStep?.secondaryAction}
				<button
					class="fs-btn fs-btn-secondary"
					onclick={handleSecondaryAction}
					disabled={completing}
					aria-label={currentStep.secondaryAction.label ?? 'Tilleggshandling'}
				>
					{currentStep.secondaryAction.icon}
					{#if currentStep.secondaryAction.label}<span class="fs-btn-secondary-label">{currentStep.secondaryAction.label}</span>{/if}
				</button>
			{/if}
			<button
				class="fs-btn fs-btn-primary"
				onclick={() => void handleNext()}
				disabled={!canProceed || completing}
			>
				{#if completing}Lagrer…
			{:else if currentStep?.type === 'checklist' && currentStep.enableAiRefinement}Ferdig →
			{:else if isLastStep}Fullfør
			{:else}Neste →{/if}
			</button>
		{/if}
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
	.fs-slider-helper { margin: 4px 0 8px; font-size: 0.85rem; color: #94a3b8; font-style: italic; }
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

	/* ═══════════════════════════════════════════════════════════════
	   FOCUS MODE — fullscreen immersive
	   ═══════════════════════════════════════════════════════════════ */
	.fs-sheet.fs-focus {
		position: fixed;
		inset: 0;
		border-radius: 0;
		border-top: none;
		max-height: none;
		max-width: none;
		background: #0b0b0f;
	}

	/* Header: dots + counter */
	.fs-focus-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: max(env(safe-area-inset-top, 16px), 16px) 20px 12px;
		border-bottom: none;
	}
	.fs-focus-close {
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 50%;
		width: 40px;
		height: 40px;
		color: #888;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		transition: color 0.15s, background 0.15s;
	}
	.fs-focus-close:hover { color: #ccc; background: rgba(255, 255, 255, 0.1); }

	.fs-dots {
		display: flex;
		gap: 6px;
		align-items: center;
	}
	.fs-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.1);
		transition: all 0.3s ease;
	}
	.fs-dot-active {
		background: #8ba0f5;
		width: 10px;
		height: 10px;
	}
	.fs-dot-done {
		background: rgba(139, 160, 245, 0.4);
	}
	.fs-focus-counter {
		font-size: 0.75rem;
		color: rgba(255, 255, 255, 0.2);
		font-variant-numeric: tabular-nums;
		min-width: 40px;
		text-align: right;
	}

	/* Body: centered content */
	.fs-focus-body {
		justify-content: center;
		align-items: center;
		padding: 24px 28px;
		text-align: center;
		gap: 20px;
	}

	/* Title & prompt */
	.fs-focus-title {
		font-size: 1.6rem;
		font-weight: 700;
		color: #e8ecf4;
		letter-spacing: -0.02em;
		line-height: 1.25;
	}
	.fs-focus-prompt {
		font-size: 1rem;
		color: #64748b;
		line-height: 1.5;
		margin: 0;
		max-width: 320px;
	}

	/* Form */
	.fs-focus-form {
		gap: 24px;
		align-items: center;
		width: 100%;
		max-width: 360px;
	}
	.fs-focus-field {
		align-items: center;
		width: 100%;
	}

	/* Slider: big display + pill track */
	.fs-focus-slider-display {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 3rem;
		margin-bottom: 20px;
	}
	.fs-focus-slider-label {
		font-size: 1.5rem;
		font-weight: 700;
		color: #e8ecf4;
		line-height: 1.2;
		text-align: center;
	}

	.fs-focus-slider-track {
		position: relative;
		width: 100%;
		height: 44px;
		border-radius: 22px;
		background: rgba(255, 255, 255, 0.06);
		overflow: hidden;
	}
	.fs-focus-slider-fill {
		position: absolute;
		top: 0;
		left: 0;
		height: 100%;
		background: linear-gradient(90deg, #1a1a2e, #4b6ef5);
		border-radius: 22px;
		transition: width 0.08s ease-out;
		pointer-events: none;
	}
	.fs-focus-slider {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		-webkit-appearance: none;
		appearance: none;
		background: transparent;
		cursor: pointer;
		margin: 0;
	}
	.fs-focus-slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: #fff;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
		cursor: grab;
	}
	.fs-focus-slider::-moz-range-thumb {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: #fff;
		border: none;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
		cursor: grab;
	}
	/* Multiselect: card grid */
	.fs-focus-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 10px;
		width: 100%;
	}
	.fs-ms-opt.fs-focus-card {
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 14px;
		padding: 16px 8px;
		font-size: 0.85rem;
		font-weight: 500;
		color: #94a3b8;
		display: flex;
		align-items: center;
		justify-content: center;
		text-align: center;
		min-height: 56px;
		transition: all 0.15s ease;
	}
	.fs-ms-opt.fs-focus-card:hover {
		background: rgba(255, 255, 255, 0.07);
		border-color: rgba(255, 255, 255, 0.15);
	}
	.fs-ms-opt.fs-focus-card.selected {
		background: rgba(75, 110, 245, 0.12);
		border-color: rgba(75, 110, 245, 0.4);
		color: #c8d4ef;
	}

	/* Footer: floating buttons */
	.fs-focus-footer {
		border-top: none;
		padding: 16px 28px max(env(safe-area-inset-bottom, 28px), 28px);
		justify-content: space-between;
		align-items: center;
	}
	.fs-focus-spacer { flex: 1; }
	.fs-focus-back {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: #888;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.15s;
	}
	.fs-focus-back:hover:not(:disabled) { color: #ccc; background: rgba(255, 255, 255, 0.1); }
	.fs-focus-back:disabled { opacity: 0.3; cursor: default; }

	.fs-focus-next {
		width: 56px;
		height: 56px;
		border-radius: 50%;
		background: #e8ecf4;
		border: none;
		color: #0b0b0f;
		font-size: 1.5rem;
		font-weight: 700;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.15s;
		box-shadow: 0 4px 16px rgba(232, 236, 244, 0.15);
	}
	.fs-focus-next:hover:not(:disabled) { background: #fff; box-shadow: 0 4px 20px rgba(255, 255, 255, 0.2); }
	.fs-focus-next:disabled { opacity: 0.25; cursor: default; }
	.fs-focus-next-arrow { font-size: 1.8rem; line-height: 1; }
	.fs-focus-next-text { font-size: 1.3rem; }

	.fs-focus-secondary {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.12);
		color: #cbd5e1;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.15s;
		margin-right: 10px;
	}
	.fs-focus-secondary:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.1);
		border-color: rgba(255, 255, 255, 0.2);
		color: #fff;
	}
	.fs-focus-secondary:disabled { opacity: 0.3; cursor: default; }
	.fs-focus-secondary-icon { font-size: 1.5rem; line-height: 1; font-weight: 400; }

	.fs-btn-secondary {
		background: rgba(255, 255, 255, 0.06);
		color: #cbd5e1;
		border: 1px solid rgba(255, 255, 255, 0.12);
		padding: 8px 14px;
		border-radius: 10px;
		font-weight: 500;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.fs-btn-secondary:hover:not(:disabled) { background: rgba(255, 255, 255, 0.1); }
	.fs-btn-secondary:disabled { opacity: 0.3; cursor: default; }
	.fs-btn-secondary-label { font-size: 0.85rem; }

	/* Focus-mode textarea */
	.fs-focus-form .fs-form-textarea {
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 14px;
		padding: 16px;
		font-size: 1rem;
		color: #ddd;
		text-align: left;
		width: 100%;
		min-height: 120px;
	}
	.fs-focus-form .fs-form-textarea:focus {
		border-color: rgba(75, 110, 245, 0.4);
	}
	.fs-focus-form .fs-form-textarea::placeholder {
		color: #475569;
	}

	/* Focus-mode: chat step gets more space */
	.fs-focus-body .fs-chat-area {
		width: 100%;
		max-width: 480px;
		text-align: left;
	}

	/* Pyramid group labels */
	.fs-pyramid-label {
		font-size: 0.72rem;
		font-weight: 600;
		color: #475569;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin: 12px 0 6px;
		text-align: left;
		width: 100%;
	}
	.fs-pyramid-active {
		color: #8ba0f5;
	}
	.fs-pyramid-toggle {
		background: none;
		border: none;
		color: #475569;
		font-size: 0.8rem;
		cursor: pointer;
		padding: 8px 0;
		width: 100%;
		text-align: center;
		transition: color 0.15s;
	}
	.fs-pyramid-toggle:hover {
		color: #8ba0f5;
	}
</style>
