<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
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
		imageUrl?: string;
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
	let fromGoogleChat = $state(false);
	let selectedImage = $state<File | null>(null);
	let imagePreview = $state<string | null>(null);
	let fileInput: HTMLInputElement;

	// Toggle this to use real OpenAI API
	const USE_REAL_API = true;
	const API_ENDPOINT = USE_REAL_API ? '/api/chat' : '/api/chat-mock';

	function handleImageSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		
		if (file) {
			selectedImage = file;
			// Create preview
			const reader = new FileReader();
			reader.onload = (e) => {
				imagePreview = e.target?.result as string;
			};
			reader.readAsDataURL(file);
		}
	}

	function clearImage() {
		selectedImage = null;
		imagePreview = null;
		if (fileInput) {
			fileInput.value = '';
		}
	}

	// Scroll til bunn ved mount og når meldinger endres
	function scrollToBottom() {
		setTimeout(() => {
			chatContainer?.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
		}, 100);
	}

	// Auto-scroll ved mount
	onMount(() => {
		// Sjekk om vi har context fra Google Chat
		const urlParams = new URLSearchParams(window.location.search);
		const contextMessage = urlParams.get('context');
		const action = urlParams.get('action');

		if (contextMessage) {
			fromGoogleChat = true;

			// Legg til context-meldingen som en assistant-melding
			messages = [
				...messages,
				{
					id: Date.now().toString(),
					role: 'assistant',
					content: decodeURIComponent(contextMessage),
					timestamp: new Date()
				}
			];

			// Sett pre-filled input basert på action
			if (action === 'log') {
				inputValue = 'Jeg vil logge aktivitet: ';
			} else if (action === 'check') {
				inputValue = 'Vis meg min fremgang';
			}

			// Fjern query params fra URL (uten refresh)
			window.history.replaceState({}, '', window.location.pathname);

			// Skjul info-boksen etter 5 sekunder
			setTimeout(() => {
				fromGoogleChat = false;
			}, 5000);
		}

		scrollToBottom();
	});

	// Auto-scroll når meldinger endres
	$effect(() => {
		if (messages.length > 0) {
			scrollToBottom();
		}
	});

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
		if ((!inputValue.trim() && !selectedImage) || isLoading) return;

		let imageUrl: string | undefined;

		// Upload image first if present
		if (selectedImage) {
			try {
				const formData = new FormData();
				formData.append('image', selectedImage);

				const uploadResponse = await fetch('/api/upload-image', {
					method: 'POST',
					body: formData
				});

				if (!uploadResponse.ok) {
					throw new Error('Image upload failed');
				}

				const uploadData = await uploadResponse.json();
				imageUrl = uploadData.url;
			} catch (error) {
				console.error('Image upload error:', error);
				lastError = 'Kunne ikke laste opp bilde. Prøv igjen.';
				return;
			}
		}

		const userMessage = {
			id: Date.now().toString(),
			role: 'user' as const,
			content: inputValue.trim() || '📷 [Bilde]',
			timestamp: new Date(),
			imageUrl
		};

		const messageContent = inputValue.trim(); // Lagre for retry
		messages = [...messages, userMessage];
		inputValue = '';
		clearImage(); // Clear image after adding to messages
		isLoading = true;

		// Scroll til bunnen
		setTimeout(() => {
			chatContainer?.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
		}, 100);

		try {
			const response = await fetch(API_ENDPOINT, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ 
					message: userMessage.content,
					imageUrl: userMessage.imageUrl 
				})
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
			<a href="/goals" class="header-button">📊 Mål</a>
			<a href="/settings" class="header-button">⚙️ Innstillinger</a>
			<button onclick={startNewConversation} class="header-button new-chat">
				+ Ny samtale
			</button>
		</div>
	</header>

	{#if fromGoogleChat}
		<div class="info-banner">
			<span>📱 Fortsetter fra Google Chat notifikasjon</span>
			<button class="info-close" onclick={() => fromGoogleChat = false}>✕</button>
		</div>
	{/if}

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
				imageUrl={message.imageUrl}
			/>
		{/each}
		
		{#if isLoading}
			<div class="loading">
				<span>•</span><span>•</span><span>•</span>
			</div>
		{/if}
	</div>

	<form class="input-area" onsubmit={(e) => { e.preventDefault(); sendMessage(); }}>
		{#if imagePreview}
			<div class="image-preview">
				<img src={imagePreview} alt="Preview" />
				<button type="button" class="remove-image" onclick={clearImage}>✕</button>
			</div>
		{/if}
		
		<div class="input-controls">
			<input
				type="file"
				accept="image/*"
				bind:this={fileInput}
				onchange={handleImageSelect}
				style="display: none;"
			/>
			<button 
				type="button" 
				class="upload-button" 
				onclick={() => fileInput.click()}
				disabled={isLoading}
				title="Last opp bilde"
			>
				📷
			</button>
			<textarea
				bind:value={inputValue}
				onkeydown={handleKeyPress}
				placeholder="Skriv din melding her... (Shift+Enter for ny linje)"
				rows="3"
				disabled={isLoading}
			></textarea>
			<button type="submit" disabled={isLoading || (!inputValue.trim() && !selectedImage)}>
				Send
			</button>
		</div>
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

	.info-banner {
		background: #e3f2fd;
		color: #1565c0;
		padding: 1rem;
		text-align: center;
		border-bottom: 2px solid #42a5f5;
		animation: slideDown 0.3s ease-out;
		font-weight: 500;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		position: relative;
	}

	.info-close {
		background: transparent;
		border: none;
		color: #1565c0;
		font-size: 1.25rem;
		cursor: pointer;
		padding: 0.25rem 0.5rem;
		line-height: 1;
		transition: background 0.2s;
		border-radius: 0.25rem;
	}

	.info-close:hover {
		background: rgba(21, 101, 192, 0.1);
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
		padding: 1rem;
		background: white;
		border-top: 1px solid #e0e0e0;
		box-shadow: 0 -2px 8px rgba(0,0,0,0.05);
	}

	.input-controls {
		display: flex;
		gap: 1rem;
	}

	.image-preview {
		position: relative;
		padding: 0.5rem;
		margin-bottom: 0.5rem;
		border: 2px solid #667eea;
		border-radius: 0.5rem;
		background: white;
	}

	.image-preview img {
		max-width: 200px;
		max-height: 200px;
		border-radius: 0.375rem;
		display: block;
	}

	.remove-image {
		position: absolute;
		top: 0.25rem;
		right: 0.25rem;
		background: rgba(0,0,0,0.7);
		color: white;
		border: none;
		border-radius: 50%;
		width: 24px;
		height: 24px;
		cursor: pointer;
		font-size: 0.875rem;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		transition: background 0.2s;
	}

	.remove-image:hover {
		background: rgba(0,0,0,0.9);
	}

	.upload-button {
		padding: 0.75rem 1rem;
		background: #f0f0f0;
		color: #333;
		border: 1px solid #ddd;
		border-radius: 0.5rem;
		font-size: 1.25rem;
		cursor: pointer;
		transition: all 0.2s;
		flex-shrink: 0;
	}

	.upload-button:hover:not(:disabled) {
		background: #e0e0e0;
		transform: translateY(-1px);
	}

	.upload-button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
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

