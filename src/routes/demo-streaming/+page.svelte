<script lang="ts">
	import { streamingChat } from '$lib/client/streaming-chat';
	import type { Snippet } from 'svelte';

	interface ProgressEvent {
		stage: string;
		data: Record<string, any>;
		timestamp: number;
	}

	let userMessage = '';
	let currentChatMessage = '';
	let isStreaming = false;
	let conversationId: string | null = null;
	let progressHistory: ProgressEvent[] = [];
	let currentStage = '';
	let tokenCount = 0;

	$: displayMessage = currentChatMessage;
	$: stageLabel = {
		initialize: '⏳ Starter samtale...',
		conversation_ready: '✅ Samtale klar',
		routing: '🔄 Analyserer forespørsel...',
		routing_complete: '✅ Routing ferdig',
		checking_duplicates: '🔍 Sjekker duplikater...',
		duplicates_checked: '✅ Duplikat-sjekk ferdig',
		building_prompt: '📝 Forbereder instrukser...',
		prompt_ready: '✅ Instrukser klar',
		loading_history: '📚 Henter historie...',
		history_loaded: '✅ Historie klar',
		saving_message: '💾 Lagrer melding...',
		message_saved: '✅ Melding lagret',
		ready_for_completion: '🚀 Klar for svar...',
		streaming_start: '⚡ Starter streaming...',
		complete: '✨ Ferdig!'
	}[currentStage] || `📌 ${currentStage}`;

	async function handleSubmit() {
		if (!userMessage.trim() || isStreaming) return;

		isStreaming = true;
		currentChatMessage = '';
		progressHistory = [];
		tokenCount = 0;
		currentStage = 'initialize';

		try {
			await streamingChat({
				message: userMessage,
				conversationId,
				onProgress: (stage, data) => {
					currentStage = stage;
					progressHistory = [...progressHistory, { stage, data, timestamp: Date.now() }];
					console.log(`[${stage}]`, data);
				},
				onBuildingPrompt: () => {
					console.log('Building system prompt...');
				},
				onRerouting: () => {
					console.log('Routing complete, rereouting if needed...');
				},
				onLoadingContext: () => {
					console.log('Context loaded from history...');
				},
				onToken: (token) => {
					currentChatMessage += token;
					tokenCount += 1;
				},
				onComplete: (result) => {
					conversationId = result.metadata?.conversationId || conversationId;
					currentStage = 'complete';
					console.log('Chat complete:', result);
				},
				onError: (error) => {
					console.error('Error:', error);
					currentStage = 'error';
				}
			});

			userMessage = '';
		} catch (error) {
			console.error('Streaming error:', error);
		} finally {
			isStreaming = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSubmit();
		}
	}
</script>

<div class="streaming-chat-demo">
	<!-- Header -->
	<div class="header">
		<h1>⚡ Streaming Chat Demo</h1>
		<p>Progressive feedback + token-streaming fra backend</p>
		{#if conversationId}
			<p class="conversation-id">
				Samtaleid: <code>{conversationId.slice(0, 8)}...</code>
			</p>
		{/if}
	</div>

	<!-- Progress Timeline -->
	{#if progressHistory.length > 0}
		<div class="progress-section">
			<h3>📊 Progress Timeline</h3>
			<div class="progress-list">
				{#each progressHistory as event, idx (`${event.timestamp}-${idx}`)}
					<div class="progress-item" class:current={event.stage === currentStage}>
						<div class="progress-header">
							<span class="stage-name">{event.stage}</span>
							<span class="timestamp">
								{new Date(event.timestamp).toLocaleTimeString('no-NO', {
									hour: '2-digit',
									minute: '2-digit',
									second: '2-digit'
								})}
							</span>
						</div>
						<div class="progress-data">
							{#each Object.entries(event.data) as [key, value]}
								<div class="data-item">
									<span class="key">{key}:</span>
									<span class="value">
										{typeof value === 'object' ? JSON.stringify(value) : String(value)}
									</span>
								</div>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Current Status -->
	<div class="status-section">
		<h3>🔄 Current Status</h3>
		<div class="status">
			<div class="status-item">
				<span class="label">Stage:</span>
				<span class="value">{stageLabel}</span>
			</div>
			{#if isStreaming}
				<div class="status-item">
					<span class="label">Tokens:</span>
					<span class="value">{tokenCount.toLocaleString('no-NO')}</span>
				</div>
			{/if}
			<div class="status-item">
				<span class="label">Status:</span>
				<span class="value" class:streaming={isStreaming} class:complete={!isStreaming && tokenCount > 0}>
					{isStreaming ? '🟢 Streaming...' : tokenCount > 0 ? '✅ Complete' : '⏸️ Idle'}
				</span>
			</div>
		</div>
	</div>

	<!-- Chat Message Display -->
	{#if displayMessage}
		<div class="message-section">
			<h3>💬 Assistant Response</h3>
			<div class="chat-message">
				{displayMessage}
				{#if isStreaming}
					<span class="cursor">▌</span>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Input -->
	<div class="input-section">
		<textarea
			bind:value={userMessage}
			placeholder="Skriv din melding her... (Shift+Enter for linjeskift)"
			disabled={isStreaming}
			on:keydown={handleKeydown}
			rows={3}
		/>
		<button on:click={handleSubmit} disabled={!userMessage.trim() || isStreaming}>
			{isStreaming ? '⚡ Streaming...' : '📤 Send'}
		</button>
	</div>
</div>

<style>
	.streaming-chat-demo {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		padding: 2rem;
		max-width: 900px;
		margin: 0 auto;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	}

	.header {
		border-bottom: 2px solid #e5e7eb;
		padding-bottom: 1rem;
	}

	.header h1 {
		margin: 0 0 0.5rem 0;
		font-size: 1.875rem;
	}

	.header p {
		margin: 0.25rem 0;
		color: #666;
		font-size: 0.95rem;
	}

	.conversation-id {
		margin-top: 0.75rem;
		padding: 0.5rem;
		background: #f3f4f6;
		border-radius: 4px;
		font-size: 0.85rem;
	}

	.conversation-id code {
		font-family: 'Monaco', monospace;
		background: #e5e7eb;
		padding: 0.25rem 0.5rem;
		border-radius: 2px;
	}

	.progress-section h3,
	.status-section h3,
	.message-section h3 {
		margin: 0 0 1rem 0;
		font-size: 1.125rem;
		color: #111;
	}

	.progress-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.progress-item {
		padding: 1rem;
		border-left: 3px solid #d1d5db;
		background: #f9fafb;
		border-radius: 4px;
		transition: all 0.2s ease;
	}

	.progress-item.current {
		border-left-color: #3b82f6;
		background: #eff6ff;
		box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
	}

	.progress-header {
		display: flex;
		justify-content: space-between;
		margin-bottom: 0.5rem;
		font-weight: 600;
	}

	.stage-name {
		color: #1f2937;
	}

	.timestamp {
		font-size: 0.8rem;
		color: #9ca3af;
		font-family: 'Monaco', monospace;
	}

	.progress-data {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.875rem;
	}

	.data-item {
		display: flex;
		gap: 0.5rem;
	}

	.key {
		color: #6366f1;
		font-weight: 500;
	}

	.value {
		color: #4b5563;
		word-break: break-word;
	}

	.status-section {
		background: #f0fdf4;
		border: 1px solid #dcfce7;
		padding: 1rem;
		border-radius: 6px;
	}

	.status {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
		gap: 1rem;
	}

	.status-item {
		display: flex;
		flex-direction: column;
	}

	.status-item .label {
		font-size: 0.8rem;
		font-weight: 600;
		color: #666;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.status-item .value {
		font-size: 1.1rem;
		color: #1f2937;
		margin-top: 0.25rem;
	}

	.status-item .value.streaming {
		color: #f59e0b;
		font-weight: 600;
	}

	.status-item .value.complete {
		color: #10b981;
		font-weight: 600;
	}

	.message-section {
		background: #f8f9fa;
		border: 1px solid #e5e7eb;
		padding: 1.5rem;
		border-radius: 6px;
	}

	.chat-message {
		line-height: 1.6;
		color: #1f2937;
		font-size: 1rem;
		white-space: pre-wrap;
		word-wrap: break-word;
	}

	.cursor {
		animation: blink 1s infinite;
		margin-left: 2px;
	}

	@keyframes blink {
		0%,
		49% {
			opacity: 1;
		}
		50%,
		100% {
			opacity: 0;
		}
	}

	.input-section {
		display: flex;
		gap: 1rem;
	}

	textarea {
		flex: 1;
		padding: 1rem;
		border: 1px solid #e5e7eb;
		border-radius: 6px;
		font-family: inherit;
		font-size: 1rem;
		resize: vertical;
		transition: border-color 0.2s;
	}

	textarea:focus {
		outline: none;
		border-color: #3b82f6;
		box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
	}

	textarea:disabled {
		background: #f3f4f6;
		color: #9ca3af;
		cursor: not-allowed;
	}

	button {
		padding: 1rem 1.5rem;
		background: #3b82f6;
		color: white;
		border: none;
		border-radius: 6px;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.2s;
		white-space: nowrap;
	}

	button:hover:not(:disabled) {
		background: #2563eb;
	}

	button:disabled {
		background: #d1d5db;
		cursor: not-allowed;
	}
</style>
