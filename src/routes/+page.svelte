<script lang="ts">
	import ChatMessage from '$lib/components/ChatMessage.svelte';

	interface Props {
		data?: {
			messages: Array<{
				id: string;
				role: 'user' | 'assistant' | 'system';
				content: string;
				timestamp: string;
			}>;
		};
	}

	let { data }: Props = $props();

	// Initialiser meldinger fra server eller med velkomstmelding
	let messages = $state<Array<{
		id: string;
		role: 'user' | 'assistant' | 'system';
		content: string;
		timestamp: Date;
	}>>(
		data?.messages && data.messages.length > 0
			? data.messages.map(msg => ({
					...msg,
					timestamp: new Date(msg.timestamp)
				}))
			: [
					{
						id: '1',
						role: 'assistant',
						content: 'Hei! Jeg er Resonans AI, din personlige coach for mål og vekst. Fortell meg litt om deg selv og hva du ønsker å oppnå - det kan være innen parforhold, trening, mental helse eller andre områder av livet ditt.',
						timestamp: new Date()
					}
				]
	);

	let inputValue = $state('');
	let isLoading = $state(false);
	let chatContainer: HTMLDivElement;
	let lastError = $state<string | null>(null);

	// Toggle this to use real OpenAI API
	const USE_REAL_API = true;
	const API_ENDPOINT = USE_REAL_API ? '/api/chat' : '/api/chat-mock';

	async function startNewConversation() {
		if (confirm('Start en ny samtale? Den nåværende samtalen blir lagret.')) {
			try {
				await fetch('/api/conversations/new', { method: 'POST' });
				// Reload siden for å starte med tom chat
				window.location.reload();
			} catch (error) {
				console.error('Feil ved opprettelse av ny samtale:', error);
			}
		}
	}

	async function sendMessage() {
		if (!inputValue.trim() || isLoading) return;

		const userMessage = {
			id: Date.now().toString(),
			role: 'user' as const,
			content: inputValue.trim(),
			timestamp: new Date()
		};

		const messageContent = inputValue.trim(); // Lagre for retry
		messages = [...messages, userMessage];
		inputValue = '';
		isLoading = true;

		// Scroll til bunnen
		setTimeout(() => {
			chatContainer?.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
		}, 100);

		try {
			const response = await fetch(API_ENDPOINT, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: userMessage.content })
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new Error(errorData.error || 'Noe gikk galt');
			}

			const data = await response.json();

			messages = [...messages, {
				id: Date.now().toString(),
				role: 'assistant' as const,
				content: data.message,
				timestamp: new Date()
			}];

			// Vis spesiell melding hvis et mål ble opprettet
			if (data.goalCreated) {
				messages = [...messages, {
					id: (Date.now() + 1).toString(),
					role: 'system' as const,
					content: '🎯 Nytt mål opprettet! Du kan nå begynne å jobbe mot dette målet.',
					timestamp: new Date()
				}];
			}

			// Scroll igjen
			setTimeout(() => {
				chatContainer?.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
			}, 100);
		} catch (error) {
			console.error('Feil ved sending av melding:', error);
			
			// Fjern brukerens melding fra historikken siden den ikke ble sendt
			messages = messages.filter(m => m.id !== userMessage.id);
			
			// Sett tilbake meldingen i input-feltet så brukeren kan prøve igjen
			inputValue = messageContent;
			
			// Vis feilmelding fra server eller generisk melding
			let errorText = 'Kunne ikke sende melding. Prøv igjen.';
			if (error instanceof Error) {
				errorText = error.message;
			}
			lastError = errorText;
			
			// Fjern feilmeldingen etter 5 sekunder
			setTimeout(() => {
				lastError = null;
			}, 5000);
		} finally {
			isLoading = false;
		}
	}

	function handleKeyPress(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			sendMessage();
		}
	}
</script>

<div class="chat-container">
	<header class="chat-header">
		<div class="header-left">
			<h1>🎯 Resonans</h1>
			<p>Din personlige målcoach</p>
		</div>
		<div class="header-actions">
			<a href="/goals" class="header-button">Se dine mål →</a>
			<button onclick={startNewConversation} class="header-button new-chat">
				+ Ny samtale
			</button>
		</div>
	</header>

	{#if lastError}
		<div class="error-banner">
			<span>⚠️ {lastError}</span>
			<div class="error-actions">
				<button class="retry-button" onclick={sendMessage}>
					🔄 Send på nytt
				</button>
				<button class="error-close" onclick={() => lastError = null}>✕</button>
			</div>
		</div>
	{/if}

	<div class="messages" bind:this={chatContainer}>
		{#each messages as message (message.id)}
			<ChatMessage 
				role={message.role} 
				content={message.content}
				timestamp={message.timestamp}
			/>
		{/each}
		
		{#if isLoading}
			<div class="loading">
				<span>•</span><span>•</span><span>•</span>
			</div>
		{/if}
	</div>

	<form class="input-area" onsubmit={(e) => { e.preventDefault(); sendMessage(); }}>
		<textarea
			bind:value={inputValue}
			onkeydown={handleKeyPress}
			placeholder="Skriv din melding her... (Shift+Enter for ny linje)"
			rows="3"
			disabled={isLoading}
		></textarea>
		<button type="submit" disabled={isLoading || !inputValue.trim()}>
			Send
		</button>
	</form>
</div>

<style>
	.chat-container {
		display: flex;
		flex-direction: column;
		height: 100vh;
		max-width: 900px;
		margin: 0 auto;
		background: white;
	}

	.chat-header {
		padding: 1.5rem;
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		color: white;
		text-align: center;
		box-shadow: 0 2px 8px rgba(0,0,0,0.1);
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.header-left {
		text-align: left;
	}

	.header-actions {
		display: flex;
		gap: 0.75rem;
	}

	.chat-header h1 {
		margin: 0;
		font-size: 1.75rem;
		font-weight: 700;
	}

	.chat-header p {
		margin: 0.25rem 0 0;
		opacity: 0.9;
		font-size: 0.9rem;
	}

	.header-button {
		display: inline-block;
		padding: 0.5rem 1rem;
		background: rgba(255,255,255,0.2);
		color: white;
		text-decoration: none;
		border: none;
		border-radius: 0.5rem;
		font-size: 0.9rem;
		font-family: inherit;
		cursor: pointer;
		transition: background 0.2s;
		white-space: nowrap;
	}

	.header-button:hover {
		background: rgba(255,255,255,0.3);
	}

	.new-chat {
		font-weight: 600;
	}

	.error-banner {
		background: #ffebee;
		color: #c62828;
		padding: 1rem;
		text-align: center;
		border-bottom: 2px solid #ef5350;
		animation: slideDown 0.3s ease-out;
		font-weight: 500;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		position: relative;
	}

	.error-actions {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	.retry-button {
		background: #c62828;
		color: white;
		border: none;
		padding: 0.5rem 1rem;
		border-radius: 0.375rem;
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.2s, transform 0.1s;
		white-space: nowrap;
	}

	.retry-button:hover {
		background: #b71c1c;
		transform: translateY(-1px);
	}

	.retry-button:active {
		transform: translateY(0);
	}

	.error-close {
		background: transparent;
		border: none;
		color: #c62828;
		font-size: 1.5rem;
		cursor: pointer;
		padding: 0.25rem 0.5rem;
		line-height: 1;
		transition: opacity 0.2s;
	}

	.error-close:hover {
		opacity: 0.7;
	}

	@media (max-width: 600px) {
		.error-banner {
			flex-direction: column;
			gap: 0.75rem;
			padding: 0.75rem;
		}

		.error-banner span {
			text-align: center;
		}

		.retry-button {
			width: 100%;
		}
	}

	@keyframes slideDown {
		from {
			opacity: 0;
			transform: translateY(-20px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.messages {
		flex: 1;
		overflow-y: auto;
		padding: 1.5rem;
		background: #fafafa;
		display: flex;
		flex-direction: column;
	}

	.loading {
		display: flex;
		gap: 0.5rem;
		padding: 1rem;
		justify-content: center;
	}

	.loading span {
		width: 8px;
		height: 8px;
		background: #999;
		border-radius: 50%;
		animation: bounce 1.4s infinite ease-in-out both;
	}

	.loading span:nth-child(1) { animation-delay: -0.32s; }
	.loading span:nth-child(2) { animation-delay: -0.16s; }

	@keyframes bounce {
		0%, 80%, 100% { transform: scale(0); }
		40% { transform: scale(1); }
	}

	.input-area {
		display: flex;
		gap: 1rem;
		padding: 1rem;
		background: white;
		border-top: 1px solid #e0e0e0;
		box-shadow: 0 -2px 8px rgba(0,0,0,0.05);
	}

	textarea {
		flex: 1;
		padding: 0.75rem;
		border: 1px solid #ddd;
		border-radius: 0.5rem;
		font-family: inherit;
		font-size: 1rem;
		resize: none;
		transition: border-color 0.2s;
	}

	textarea:focus {
		outline: none;
		border-color: #667eea;
	}

	textarea:disabled {
		background: #f5f5f5;
		cursor: not-allowed;
	}

	button {
		padding: 0.75rem 2rem;
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		color: white;
		border: none;
		border-radius: 0.5rem;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.2s, transform 0.1s;
	}

	button:hover:not(:disabled) {
		opacity: 0.9;
		transform: translateY(-1px);
	}

	button:active:not(:disabled) {
		transform: translateY(0);
	}

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>

