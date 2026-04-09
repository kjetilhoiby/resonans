<script lang="ts">
	import type { Flow, FlowStep, FlowFormField, FlowSession } from '$lib/flows/types';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { streamProxyChat } from '$lib/client/proxy-chat-stream';

	interface Props {
		flow: Flow | null;
		onclose?: () => void;
		oncomplete?: (data: Record<string, any>) => void;
	}

	let { flow, onclose, oncomplete }: Props = $props();

	let currentStepIndex = $state(0);
	let flowData = $state<Record<string, any>>({});
	let chatMessages = $state<Array<{ role: 'user' | 'assistant'; text: string }>>([]);
	let chatInput = $state('');
	let chatLoading = $state(false);
	let chatStreamingText = $state('');
	let validationError = $state<string | null>(null);

	const currentStep = $derived(flow?.steps?.[currentStepIndex]);
	const isFirstStep = $derived(currentStepIndex === 0);
	const isLastStep = $derived(flow?.steps ? currentStepIndex === flow.steps.length - 1 : true);
	const canProceed = $derived(() => {
		if (!currentStep) return false;
		if (currentStep.type === 'chat') {
			// For chat-steg, kan alltid gå videre etter AI har svart
			return chatMessages.length > 0;
		}
		// For form-steg, sjekk required fields
		const fields = currentStep.fields || [];
		return fields.every((field) => {
			if (!field.required) return true;
			const value = flowData[field.id];
			return value !== undefined && value !== null && value !== '';
		});
	});

	function handleClose() {
		onclose?.();
	}

	function handleFieldChange(fieldId: string, value: any) {
		flowData[fieldId] = value;
		validationError = null;
	}

	async function handleChatSubmit() {
		if (!chatInput.trim() || chatLoading) return;

		const userMessage = chatInput.trim();
		chatInput = '';
		chatMessages = [...chatMessages, { role: 'user', text: userMessage }];
		chatLoading = true;
		chatStreamingText = '';

		try {
			const data = await streamProxyChat({
				message: userMessage,
				onToken: (token) => {
					chatStreamingText += token;
				}
			});

			chatMessages = [...chatMessages, { role: 'assistant', text: data.message }];
		} catch (error) {
			chatMessages = [
				...chatMessages,
				{ role: 'assistant', text: 'Beklager, noe gikk galt. Prøv igjen.' }
			];
		} finally {
			chatLoading = false;
			chatStreamingText = '';
		}
	}

	function handlePrevious() {
		if (currentStepIndex > 0) {
			currentStepIndex--;
			validationError = null;
		}
	}

	function handleNext() {
		if (!currentStep) return;

		// Valider steg
		if (currentStep.validation) {
			const result = currentStep.validation(flowData);
			if (typeof result === 'string') {
				validationError = result;
				return;
			}
			if (result === false) {
				validationError = 'Vennligst fyll ut alle påkrevde felt.';
				return;
			}
		}

		// Sjekk required fields for form-steg
		if (currentStep.type === 'form' || currentStep.type === 'mixed') {
			const fields = currentStep.fields || [];
			const missingRequired = fields.find((field) => {
				if (!field.required) return false;
				const value = flowData[field.id];
				return value === undefined || value === null || value === '';
			});

			if (missingRequired) {
				validationError = `Feltet "${missingRequired.label}" er påkrevd.`;
				return;
			}
		}

		validationError = null;

		if (isLastStep) {
			handleComplete();
		} else {
			currentStepIndex++;
			// Reset chat for nytt steg
			if (currentStep?.type === 'chat') {
				chatMessages = [];
				if (currentStep.prompt) {
					chatMessages = [{ role: 'assistant', text: currentStep.prompt }];
				}
			}
		}
	}

	function handleComplete() {
		oncomplete?.(flowData);
		onclose?.();
	}

	// Initialiser første chat-steg hvis relevant
	$effect(() => {
		if (flow && currentStepIndex === 0 && currentStep?.type === 'chat' && currentStep.prompt) {
			chatMessages = [{ role: 'assistant', text: currentStep.prompt }];
		}
	});
</script>

{#if flow}
	<div class="flow-sheet-overlay">
		<div class="flow-sheet">
			<!-- Header -->
			<div class="flow-sheet-header">
				<button class="flow-sheet-back" onclick={handleClose} aria-label="Lukk">
					<Icon name="close" size={20} />
				</button>
				<div class="flow-sheet-title-wrap">
					<span class="flow-sheet-icon">{flow.icon}</span>
					<h2 class="flow-sheet-title">{flow.name}</h2>
				</div>
				<div class="flow-sheet-progress">
					{currentStepIndex + 1}/{flow.steps?.length || 1}
				</div>
			</div>

			<!-- Progress bar -->
			{#if flow.steps && flow.steps.length > 1}
				<div class="flow-sheet-progress-bar">
					<div
						class="flow-sheet-progress-fill"
						style:width="{((currentStepIndex + 1) / flow.steps.length) * 100}%"
					></div>
				</div>
			{/if}

			<!-- Body -->
			<div class="flow-sheet-body">
				{#if currentStep}
					{#if currentStep.title}
						<h3 class="flow-step-title">{currentStep.title}</h3>
					{/if}

					<!-- Chat-steg -->
					{#if currentStep.type === 'chat'}
						<div class="flow-chat-area">
							<div class="flow-chat-messages">
								{#each chatMessages as msg}
									<div class="flow-chat-message" class:user={msg.role === 'user'}>
										{msg.text}
									</div>
								{/each}
								{#if chatLoading && chatStreamingText}
									<div class="flow-chat-message assistant streaming">
										{chatStreamingText}
									</div>
								{/if}
							</div>
							<div class="flow-chat-input-wrap">
								<input
									type="text"
									class="flow-chat-input"
									placeholder="Skriv svar..."
									bind:value={chatInput}
									onkeydown={(e) => e.key === 'Enter' && handleChatSubmit()}
									disabled={chatLoading}
								/>
								<button
									class="flow-chat-send"
									onclick={handleChatSubmit}
									disabled={!chatInput.trim() || chatLoading}
								>
								<Icon name="forward" size={18} />
								</button>
							</div>
						</div>
					{/if}

					<!-- Form-steg (eller mixed med prompt først) -->
					{#if currentStep.type === 'form' || currentStep.type === 'mixed'}
						{#if currentStep.type === 'mixed' && currentStep.prompt}
							<p class="flow-step-prompt">{currentStep.prompt}</p>
						{/if}
						{#if currentStep.fields}
							<div class="flow-form">
								{#each currentStep.fields as field}
									<label class="flow-form-field">
										<span class="flow-form-label">
											{field.label}
											{#if field.required}<span class="required">*</span>{/if}
										</span>

										{#if field.type === 'text'}
											<input
												type="text"
												class="flow-form-input"
												placeholder={field.placeholder}
												value={flowData[field.id] || ''}
												oninput={(e) =>
													handleFieldChange(field.id, e.currentTarget.value)}
											/>
										{:else if field.type === 'textarea'}
											<textarea
												class="flow-form-textarea"
												placeholder={field.placeholder}
												rows="4"
												value={flowData[field.id] || ''}
												oninput={(e) =>
													handleFieldChange(field.id, e.currentTarget.value)}
											></textarea>
										{:else if field.type === 'number'}
											<input
												type="number"
												class="flow-form-input"
												placeholder={field.placeholder}
												min={field.min}
												max={field.max}
												step={field.step}
												value={flowData[field.id] ?? field.defaultValue ?? ''}
												oninput={(e) =>
													handleFieldChange(
														field.id,
														e.currentTarget.value ? parseFloat(e.currentTarget.value) : null
													)}
											/>
										{:else if field.type === 'date'}
											<input
												type="date"
												class="flow-form-input"
												value={flowData[field.id] || ''}
												oninput={(e) =>
													handleFieldChange(field.id, e.currentTarget.value)}
											/>
										{:else if field.type === 'select'}
											<select
												class="flow-form-select"
												value={flowData[field.id] || ''}
												onchange={(e) =>
													handleFieldChange(field.id, e.currentTarget.value)}
											>
												<option value="">Velg...</option>
												{#each field.options || [] as option}
													<option value={option.value}>{option.label}</option>
												{/each}
											</select>
										{:else if field.type === 'slider'}
											<div class="flow-form-slider-wrap">
												<input
													type="range"
													class="flow-form-slider"
													min={field.min ?? 0}
													max={field.max ?? 100}
													step={field.step ?? 1}
													value={flowData[field.id] ?? field.defaultValue ?? field.min ?? 0}
													oninput={(e) =>
														handleFieldChange(
															field.id,
															parseFloat(e.currentTarget.value)
														)}
												/>
												<span class="flow-form-slider-value"
													>{flowData[field.id] ?? field.defaultValue ?? field.min ?? 0}</span
												>
											</div>
										{:else if field.type === 'multiselect'}
											<div class="flow-form-multiselect">
												{#each field.options || [] as option}
													{@const selected =
														Array.isArray(flowData[field.id]) &&
														flowData[field.id].includes(option.value)}
													<button
														class="flow-form-option"
														class:selected
														onclick={() => {
															const current = Array.isArray(flowData[field.id])
															? (flowData[field.id] as string[])
															: [];
														const newValue = selected
															? current.filter((v: string) => v !== option.value)
																: [...current, option.value];
															handleFieldChange(field.id, newValue);
														}}
													>
														{option.label}
													</button>
												{/each}
											</div>
										{/if}
									</label>
								{/each}
							</div>
						{/if}
					{/if}

					{#if validationError}
						<p class="flow-validation-error">{validationError}</p>
					{/if}
				{/if}
			</div>

			<!-- Footer -->
			<div class="flow-sheet-footer">
				{#if !isFirstStep}
					<button class="flow-btn flow-btn-secondary" onclick={handlePrevious}>
						← Forrige
					</button>
				{/if}
				<button
					class="flow-btn flow-btn-primary"
					onclick={handleNext}
					disabled={currentStep?.type !== 'chat' && !canProceed()}
				>
					{isLastStep ? 'Fullfør' : 'Neste →'}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.flow-sheet-overlay {
		position: fixed;
		inset: 0;
		background: hsla(228 30% 8% / 0.96);
		backdrop-filter: blur(8px);
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
		animation: fadeIn 0.2s ease;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	.flow-sheet {
		background: hsl(228 20% 11%);
		border: 1px solid hsl(228 22% 20%);
		border-radius: 18px;
		width: 100%;
		max-width: 600px;
		max-height: 90vh;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		animation: slideUp 0.3s ease;
	}

	@keyframes slideUp {
		from {
			opacity: 0;
			transform: translateY(20px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.flow-sheet-header {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 16px 20px;
		border-bottom: 1px solid hsl(228 20% 18%);
		flex-shrink: 0;
	}

	.flow-sheet-back {
		background: transparent;
		border: none;
		color: hsl(228 30% 68%);
		cursor: pointer;
		padding: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: color 0.15s ease;
	}

	.flow-sheet-back:hover {
		color: hsl(228 40% 82%);
	}

	.flow-sheet-title-wrap {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: 1;
	}

	.flow-sheet-icon {
		font-size: 1.5rem;
	}

	.flow-sheet-title {
		font-size: 1.05rem;
		font-weight: 600;
		color: hsl(228 50% 92%);
		margin: 0;
	}

	.flow-sheet-progress {
		font-size: 0.8rem;
		color: hsl(228 25% 62%);
		font-weight: 500;
	}

	.flow-sheet-progress-bar {
		height: 3px;
		background: hsl(228 20% 18%);
		flex-shrink: 0;
	}

	.flow-sheet-progress-fill {
		height: 100%;
		background: hsl(228 80% 58%);
		transition: width 0.3s ease;
	}

	.flow-sheet-body {
		flex: 1;
		overflow-y: auto;
		padding: 24px 20px;
	}

	.flow-step-title {
		font-size: 1.1rem;
		font-weight: 600;
		color: hsl(228 50% 90%);
		margin: 0 0 16px;
	}

	.flow-step-prompt {
		font-size: 0.9rem;
		color: hsl(228 30% 72%);
		line-height: 1.5;
		margin: 0 0 20px;
	}

	/* Chat area */
	.flow-chat-area {
		display: flex;
		flex-direction: column;
		gap: 12px;
		min-height: 300px;
	}

	.flow-chat-messages {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.flow-chat-message {
		padding: 10px 14px;
		border-radius: 12px;
		max-width: 85%;
		line-height: 1.4;
		font-size: 0.88rem;
	}

	.flow-chat-message.user {
		background: hsl(228 60% 22%);
		color: hsl(228 50% 92%);
		align-self: flex-end;
	}

	.flow-chat-message:not(.user) {
		background: hsl(228 20% 16%);
		color: hsl(228 30% 78%);
		border: 1px solid hsl(228 20% 22%);
		align-self: flex-start;
	}

	.flow-chat-message.streaming {
		opacity: 0.9;
	}

	.flow-chat-input-wrap {
		display: flex;
		gap: 8px;
	}

	.flow-chat-input {
		flex: 1;
		background: hsl(228 20% 14%);
		border: 1px solid hsl(228 22% 24%);
		border-radius: 10px;
		padding: 10px 14px;
		color: hsl(228 40% 90%);
		font-size: 0.88rem;
	}

	.flow-chat-input:focus {
		outline: none;
		border-color: hsl(228 50% 42%);
	}

	.flow-chat-send {
		background: hsl(228 60% 28%);
		border: 1px solid hsl(228 50% 38%);
		color: hsl(228 50% 92%);
		border-radius: 10px;
		padding: 10px 14px;
		cursor: pointer;
		transition:
			background 0.15s ease,
			border-color 0.15s ease;
	}

	.flow-chat-send:hover:not(:disabled) {
		background: hsl(228 60% 32%);
		border-color: hsl(228 55% 44%);
	}

	.flow-chat-send:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Form */
	.flow-form {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.flow-form-field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.flow-form-label {
		font-size: 0.85rem;
		font-weight: 500;
		color: hsl(228 35% 78%);
	}

	.flow-form-label .required {
		color: hsl(0 60% 60%);
		margin-left: 2px;
	}

	.flow-form-input,
	.flow-form-textarea,
	.flow-form-select {
		background: hsl(228 20% 14%);
		border: 1px solid hsl(228 22% 24%);
		border-radius: 10px;
		padding: 10px 12px;
		color: hsl(228 40% 90%);
		font-size: 0.88rem;
		font-family: inherit;
	}

	.flow-form-input:focus,
	.flow-form-textarea:focus,
	.flow-form-select:focus {
		outline: none;
		border-color: hsl(228 50% 42%);
	}

	.flow-form-slider-wrap {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.flow-form-slider {
		flex: 1;
		height: 6px;
		border-radius: 3px;
		background: hsl(228 20% 18%);
		-webkit-appearance: none;
		appearance: none;
	}

	.flow-form-slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: hsl(228 70% 58%);
		cursor: pointer;
	}

	.flow-form-slider::-moz-range-thumb {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: hsl(228 70% 58%);
		cursor: pointer;
		border: none;
	}

	.flow-form-slider-value {
		font-size: 0.9rem;
		font-weight: 600;
		color: hsl(228 50% 82%);
		min-width: 40px;
		text-align: right;
	}

	.flow-form-multiselect {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.flow-form-option {
		background: hsl(228 20% 16%);
		border: 1px solid hsl(228 22% 26%);
		color: hsl(228 30% 75%);
		padding: 8px 14px;
		border-radius: 8px;
		font-size: 0.82rem;
		cursor: pointer;
		transition:
			background 0.15s ease,
			border-color 0.15s ease,
			color 0.15s ease;
	}

	.flow-form-option:hover {
		background: hsl(228 22% 19%);
		border-color: hsl(228 26% 32%);
	}

	.flow-form-option.selected {
		background: hsl(228 55% 22%);
		border-color: hsl(228 60% 36%);
		color: hsl(228 55% 88%);
	}

	.flow-validation-error {
		color: hsl(0 70% 70%);
		font-size: 0.82rem;
		margin: 12px 0 0;
		padding: 8px 12px;
		background: hsl(0 40% 14%);
		border: 1px solid hsl(0 45% 24%);
		border-radius: 8px;
	}

	/* Footer */
	.flow-sheet-footer {
		display: flex;
		gap: 10px;
		padding: 16px 20px;
		border-top: 1px solid hsl(228 20% 18%);
		flex-shrink: 0;
	}

	.flow-btn {
		flex: 1;
		padding: 11px 18px;
		border-radius: 10px;
		font-size: 0.88rem;
		font-weight: 600;
		cursor: pointer;
		transition:
			background 0.15s ease,
			border-color 0.15s ease,
			transform 0.1s ease;
	}

	.flow-btn:active {
		transform: scale(0.98);
	}

	.flow-btn-primary {
		background: hsl(228 70% 58%);
		border: 1px solid hsl(228 70% 64%);
		color: white;
	}

	.flow-btn-primary:hover:not(:disabled) {
		background: hsl(228 70% 52%);
		border-color: hsl(228 70% 58%);
	}

	.flow-btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.flow-btn-secondary {
		background: transparent;
		border: 1px solid hsl(228 24% 28%);
		color: hsl(228 40% 78%);
	}

	.flow-btn-secondary:hover {
		background: hsl(228 20% 16%);
		border-color: hsl(228 28% 34%);
	}
</style>
