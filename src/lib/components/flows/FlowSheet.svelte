<script lang="ts">
	import type { Flow, FlowContext } from '$lib/flows/types';
	import { ChatState } from '$lib/client/chat-state.svelte';
	import { onMount, tick, untrack } from 'svelte';
	import { fly, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';

	import {
		parseChatMessage,
		findNextStepIndex,
		findPreviousStepIndex,
		buildChecklistItems,
		selectedTasks,
		flowDraftKey,
		parseFlowDraft,
		serializeFlowDraft,
		type FlowChecklistItem,
		type WeatherData,
		type RichChatMsg
	} from './flow-helpers';

	import FlowSheetHeader from './FlowSheetHeader.svelte';
	import FlowSheetFooter from './FlowSheetFooter.svelte';
	import FlowChatStep from './FlowChatStep.svelte';
	import FlowFormStep from './FlowFormStep.svelte';
	import FlowChecklistStep from './FlowChecklistStep.svelte';
	import FlowDecisionListStep from './FlowDecisionListStep.svelte';
	import { flowSheetApi, type FlowSheetApi } from './flow-sheet-api';

	// ── Props ────────────────────────────────────────────────────────
	interface Props {
		flow: Flow | null;
		context?: FlowContext;
		onclose?: () => void;
		oncomplete?: (data: Record<string, any>) => void | Promise<void>;
		onsecondaryaction?: (action: { id: string; data: Record<string, any> }) => void;
		/** Nettverkslag (vær + AI-forslag) — injiseres som mock på /design. Default: ekte API. */
		api?: FlowSheetApi;
	}

	let { flow, context = {}, onclose, oncomplete, onsecondaryaction, api = flowSheetApi }: Props = $props();

	// ── Core state ───────────────────────────────────────────────────
	let currentStepIndex = $state(0);
	let flowData = $state<Record<string, any>>({ ...(context.initialData ?? {}) });
	let completing = $state(false);
	let completionError = $state('');
	let autoAdvanceTimer = $state<ReturnType<typeof setTimeout> | null>(null);
	let pyramidExpanded = $state(false);

	// ── Chat state ───────────────────────────────────────────────────
	let chatMessages = $state<RichChatMsg[]>([]);
	let chatMessagesEl = $state<HTMLDivElement | null>(null);

	const flowChat = new ChatState({
		preferredModel: () => flow?.chatModel,
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
			return false;
		}
	});

	// ── Checklist state ──────────────────────────────────────────────
	let checklistItems = $state<FlowChecklistItem[]>([]);
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
	const isLastStep = $derived(
		flow?.steps ? findNextStepIndex(flow, currentStepIndex, flowData) >= flow.steps.length : true
	);

	const canProceed = $derived.by(() => {
		if (!currentStep) return false;
	if (currentStep?.type === 'chat') return chatMessages.some((m) => m.role === 'assistant');	if (currentStep.type === 'checklist') return true;
		if (currentStep.type === 'decision-list') return true;
		const fields = currentStep.fields ?? [];
		return fields.every((field) => {
			if (!field.required) return true;
			const value = flowData[field.id];
			return value !== undefined && value !== null && value !== '';
		});
	});

	const openItemsForDecision = $derived.by(() => {
		const step = currentStep;
		if (step?.type !== 'decision-list') return [];
		return step.openItemsKey ? (context as Record<string, any>)[step.openItemsKey] ?? [] : [];
	});

	const carryoverCount = $derived(
		Object.values(decisions).filter((v) => v === 'carryover').length
	);

	// ── Utkast (resumable flows) ─────────────────────────────────────
	let restoredFlowId = $state<string | null>(null);
	let draftNotice = $state(false);

	// Gjenopprett lagret utkast når en resumable flow åpnes
	$effect(() => {
		const f = flow;
		if (!f?.resumable || restoredFlowId === f.id) return;
		restoredFlowId = f.id;
		untrack(() => {
			if (typeof localStorage === 'undefined') return;
			const draft = parseFlowDraft(localStorage.getItem(flowDraftKey(f.id)), f.id);
			if (!draft) return;
			// Utkastets svar i bunn — initialData (kontekst per åpning) skal alltid være fersk
			flowData = { ...draft.data, ...(context.initialData ?? {}) };
			currentStepIndex = Math.max(0, Math.min(draft.stepIndex, (f.steps?.length ?? 1) - 1));
			draftNotice = true;
			setTimeout(() => (draftNotice = false), 5000);
		});
	});

	// Lagre fortløpende — JSON.stringify leser hele flowData og sporer dermed alle felt
	$effect(() => {
		const f = flow;
		if (!f?.resumable) return;
		const snapshot = serializeFlowDraft(f.id, currentStepIndex, flowData);
		untrack(() => {
			if (completing || typeof localStorage === 'undefined') return;
			try {
				localStorage.setItem(flowDraftKey(f.id), snapshot);
			} catch {
				// Full/blokkert storage — utkast er best effort
			}
		});
	});

	// ── Lifecycle ────────────────────────────────────────────────────
	onMount(async () => {
		if (context.existingHeadline) flowData['headline'] = context.existingHeadline;
		if (context.dreamReasons) flowData['_dreamReasons'] = context.dreamReasons;
		if (context.slot) flowData['_slot'] = context.slot;

		if (context.dayIso) {
			void api.fetchDayWeather(context.dayIso).then((d) => {
				if (d) weather = d;
			});
		}
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
				checklistItems = buildChecklistItems(context as Record<string, any>, step.itemsKey, step.extraItemsKey);
				flowData['selectedTasks'] = selectedTasks(checklistItems);
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
	function toggleChecklistItem(id: string) {
		checklistItems = checklistItems.map((i) => i.id === id ? { ...i, selected: !i.selected } : i);
		flowData['selectedTasks'] = selectedTasks(checklistItems);
	}

	function addCustomChecklistItem() {
		const text = checklistCustomInput.trim();
		if (!text) return;
		const key = text.toLowerCase();
		if (!checklistItems.some((i) => i.text.trim().toLowerCase() === key)) {
			const newItem: FlowChecklistItem = { id: `custom:${Date.now()}`, text, source: 'custom', selected: true };
			checklistItems = [...checklistItems, newItem];
			flowData['selectedTasks'] = selectedTasks(checklistItems);
		}
		checklistCustomInput = '';
		checklistCustomInputEl?.focus();
	}

	async function fetchAiSuggestions(headline: string | undefined, refinementPrompt?: string) {
		if (!headline?.trim() && !refinementPrompt?.trim()) return;
		loadingAiSuggestions = true;
		try {
			const alreadyHave = checklistItems.map((i) => i.text);
			const suggestions = await api.fetchDaySuggestions({
				headline: headline?.trim() ?? '',
				dayLabel: context.dayLabel ?? '',
				carryovers: context.carryovers ?? [],
				weekTasks: context.weekTasks ?? [],
				...(refinementPrompt ? { refinementPrompt } : {})
			});
			const toAdd = suggestions.filter((s) => {
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

	function handleSecondaryAction() {
		const action = currentStep?.secondaryAction;
		if (!action) return;
		onsecondaryaction?.({ id: action.id, data: { ...flowData } });
	}

	async function scrollChatToBottom() {
		await tick();
		if (chatMessagesEl) chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
	}

	async function sendChatMessage(text: string, isAutoSend = false) {
		if (flowChat.loading) return;
		if (!isAutoSend) chatMessages = [...chatMessages, { role: 'user', text }];
		await scrollChatToBottom();
		await flowChat.send(text);
		await scrollChatToBottom();
	}

	function handlePrevious() {
		const prev = findPreviousStepIndex(flow, currentStepIndex, flowData);
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
			currentStepIndex = findNextStepIndex(flow, currentStepIndex, flowData);
		}
	}

	async function handleComplete() {
		completing = true;
		completionError = '';
		try {
			await flow?.onComplete?.(flowData, context);
			if (flow?.resumable && typeof localStorage !== 'undefined') {
				try {
					localStorage.removeItem(flowDraftKey(flow.id));
				} catch {
					// best effort
				}
			}
			await oncomplete?.({ ...flowData, conversationId: flowChat.conversationId ?? undefined });
			onclose?.();
		} catch {
			completionError = 'Noe gikk galt. Prøv igjen.';
			completing = false;
		}
	}

	function handleClose() { onclose?.(); }
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
	<FlowSheetHeader
		{isFocus}
		flowIcon={flow.icon}
		flowName={flow.name}
		{totalSteps}
		{currentStepIndex}
		{weather}
		onclose={handleClose}
	/>

	{#if draftNotice}
		<div class="fs-draft-notice" transition:fade={{ duration: 200 }}>
			Fortsetter der du slapp — utkastet var lagret
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

			<!-- CHAT -->
			{#if currentStep.type === 'chat'}
				<FlowChatStep
					{chatMessages}
					{flowChat}
					autoSendLabel={currentStep.autoSend ? 'Starter…' : 'Si hva du tenker på…'}
					bind:chatMessagesEl
					onsend={(text) => void sendChatMessage(text)}
				/>
			{/if}

			<!-- FORM / MIXED -->
			{#if currentStep.type === 'form' || currentStep.type === 'mixed'}
				{#if currentStep.type === 'mixed' && currentStep.prompt}
					<p class="fs-step-prompt">{currentStep.prompt}</p>
				{/if}
				{#if currentStep.fields}
					<FlowFormStep
						fields={currentStep.fields}
						{flowData}
						{context}
						{isFocus}
						{pyramidExpanded}
						onFieldChange={handleFieldChange}
						onPyramidToggle={() => pyramidExpanded = !pyramidExpanded}
						onAutoAdvanceClear={clearAutoAdvance}
						onAutoAdvanceStart={startAutoAdvance}
					/>
				{/if}
			{/if}

			<!-- CHECKLIST -->
			{#if currentStep.type === 'checklist'}
				<FlowChecklistStep
					{checklistItems}
					{weather}
					{loadingAiSuggestions}
					enableAiRefinement={currentStep.enableAiRefinement ?? false}
					hasAiSuggestionsField={!!currentStep.aiSuggestionsFromField}
					{refinementHistory}
					{refinementInput}
					{checklistCustomInput}
					bind:refinementInputEl
					bind:checklistCustomInputEl
					onToggle={toggleChecklistItem}
					onAddCustom={addCustomChecklistItem}
					onRefinementSend={() => void sendRefinementPrompt()}
					onRefinementInputChange={(v) => refinementInput = v}
					onCustomInputChange={(v) => checklistCustomInput = v}
				/>
			{/if}

			<!-- DECISION-LIST -->
			{#if currentStep.type === 'decision-list'}
				<FlowDecisionListStep
					openItems={openItemsForDecision}
					{decisions}
					{carryoverCount}
					onToggle={toggleDecision}
				/>
			{/if}

			{#if validationError}
				<p class="fs-validation-error">{validationError}</p>
			{/if}
			{#if completionError}
				<p class="fs-validation-error">{completionError}</p>
			{/if}
		{/if}
	</div>

	<FlowSheetFooter
		{isFocus}
		{isFirstStep}
		{isLastStep}
		{canProceed}
		{completing}
		{currentStep}
		onprevious={handlePrevious}
		onnext={() => void handleNext()}
		onsecondary={handleSecondaryAction}
	/>
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

	.fs-draft-notice {
		align-self: center;
		margin: 6px 16px 0;
		padding: 5px 12px;
		border-radius: 999px;
		background: var(--card-bg-inset, #0d0d0d);
		border: 1px solid var(--card-border, #222);
		font-size: var(--font-size-caption, 0.72rem);
		color: var(--text-secondary, #aaa);
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

	/* ═══════ FOCUS MODE ═══════ */
	.fs-sheet.fs-focus {
		position: fixed;
		inset: 0;
		border-radius: 0;
		border-top: none;
		max-height: none;
		max-width: none;
		background: #0b0b0f;
	}

	.fs-focus-body {
		justify-content: center;
		align-items: center;
		padding: 24px 28px;
		text-align: center;
		gap: 20px;
	}

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

	/* Focus-mode: chat step gets more space */
	.fs-focus-body :global(.fs-chat-area) {
		width: 100%;
		max-width: 480px;
		text-align: left;
	}

</style>
