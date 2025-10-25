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
				imageUrl?: string;
			}>;
			conversationId: string | null;
			hasMore: boolean;
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
	let isUploadingImage = $state(false);
	let hasMoreMessages = $state(data?.hasMore ?? false);
	let isLoadingMore = $state(false);
	let conversationId = $state(data?.conversationId ?? null);
	
	// Søkefunksjonalitet
	let searchQuery = $state('');
	let showSearch = $state(false);
	let searchResults = $state<number[]>([]);
	let currentSearchIndex = $state(0);
	let searchInput: HTMLInputElement;

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

	// Håndter scroll - last eldre meldinger når bruker scroller til toppen
	function handleScroll() {
		if (!chatContainer || isLoadingMore || !hasMoreMessages || !conversationId) return;

		// Sjekk om vi er nær toppen (100px margin)
		if (chatContainer.scrollTop < 100) {
			loadMoreMessages();
		}
	}

	async function loadMoreMessages() {
		if (isLoadingMore || !hasMoreMessages || !conversationId || messages.length === 0) return;

		isLoadingMore = true;
		const oldScrollHeight = chatContainer.scrollHeight;

		try {
			// Hent timestamp fra eldste melding
			const oldestMessage = messages[0];
			const beforeTimestamp = oldestMessage.timestamp.toISOString();

			const response = await fetch('/api/messages/load-more', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ conversationId, beforeTimestamp })
			});

			if (!response.ok) throw new Error('Failed to load more messages');

			const data = await response.json();
			
			if (data.messages.length > 0) {
				// Legg til eldre meldinger først i arrayet
				messages = [
					...data.messages.map((msg: any) => ({
						...msg,
						timestamp: new Date(msg.timestamp)
					})),
					...messages
				];

				// Behold scroll-posisjon
				setTimeout(() => {
					const newScrollHeight = chatContainer.scrollHeight;
					chatContainer.scrollTop = newScrollHeight - oldScrollHeight;
				}, 0);
			}

			hasMoreMessages = data.hasMore;
		} catch (error) {
			console.error('Error loading more messages:', error);
		} finally {
			isLoadingMore = false;
		}
	}

	// Auto-scroll ved mount
	onMount(() => {
		// Start ved bunnen (ingen animasjon)
		if (chatContainer) {
			chatContainer.scrollTop = chatContainer.scrollHeight;
		}

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
			isUploadingImage = true;
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
				isUploadingImage = false;
				return;
			} finally {
				isUploadingImage = false;
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

			// Scroll til bunnen etter ny melding
			setTimeout(() => {
				if (chatContainer) {
					chatContainer.scrollTop = chatContainer.scrollHeight;
				}
			}, 0);
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

	// Søkefunksjonalitet
	function performSearch() {
		if (!searchQuery.trim()) {
			searchResults = [];
			currentSearchIndex = 0;
			return;
		}

		const query = searchQuery.toLowerCase();
		const results: number[] = [];

		messages.forEach((msg, index) => {
			if (msg.content.toLowerCase().includes(query)) {
				results.push(index);
			}
		});

		searchResults = results;
		currentSearchIndex = results.length > 0 ? 0 : 0;

		if (results.length > 0) {
			scrollToSearchResult(0);
		}
	}

	function scrollToSearchResult(index: number) {
		if (searchResults.length === 0) return;

		const messageIndex = searchResults[index];
		const messageElements = chatContainer.querySelectorAll('.message');
		
		// Fjern alle highlights
		messageElements.forEach(el => {
			el.classList.remove('search-highlight-active', 'search-highlight-other');
		});

		// Legg til highlight på alle treff
		searchResults.forEach((resultIndex, i) => {
			const element = messageElements[resultIndex];
			if (element) {
				if (i === index) {
					// Aktiv treff - sterk lilla highlight
					element.classList.add('search-highlight-active');
				} else {
					// Andre treff - lysere highlight
					element.classList.add('search-highlight-other');
				}
			}
		});

		// Scroll til aktiv treff
		const targetElement = messageElements[messageIndex];
		if (targetElement) {
			targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
		}
	}

	function nextSearchResult() {
		if (searchResults.length === 0) return;
		currentSearchIndex = (currentSearchIndex + 1) % searchResults.length;
		scrollToSearchResult(currentSearchIndex);
	}

	function prevSearchResult() {
		if (searchResults.length === 0) return;
		currentSearchIndex = (currentSearchIndex - 1 + searchResults.length) % searchResults.length;
		scrollToSearchResult(currentSearchIndex);
	}

	function toggleSearch() {
		showSearch = !showSearch;
		if (!showSearch) {
			searchQuery = '';
			searchResults = [];
			currentSearchIndex = 0;
		} else {
			// Auto-fokuser søkefeltet når det åpnes
			setTimeout(() => {
				if (searchInput) {
					searchInput.focus();
				}
			}, 100);
		}
	}

	function closeOrClearSearch() {
		if (searchQuery.trim()) {
			// Hvis det er søketekst, tøm først
			searchQuery = '';
			searchResults = [];
			currentSearchIndex = 0;
			// Fjern highlights
			const messageElements = chatContainer?.querySelectorAll('.message');
			messageElements?.forEach(el => {
				el.classList.remove('search-highlight-active', 'search-highlight-other');
			});
		} else {
			// Hvis søket er tomt, lukk
			showSearch = false;
			// Fjern highlights
			const messageElements = chatContainer?.querySelectorAll('.message');
			messageElements?.forEach(el => {
				el.classList.remove('search-highlight-active', 'search-highlight-other');
			});
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
			<button onclick={toggleSearch} class="header-button search-toggle" title="Søk i meldinger">
				🔍
			</button>
			<a href="/goals" class="header-button">📊 Mål</a>
			<a href="/settings" class="header-button">⚙️ Innstillinger</a>
			<button onclick={startNewConversation} class="header-button new-chat">
				+ Ny samtale
			</button>
		</div>
	</header>

	{#if showSearch}
		<div class="search-bar">
			<input
				type="text"
				bind:value={searchQuery}
				bind:this={searchInput}
				oninput={performSearch}
				placeholder="Søk i meldinger..."
				class="search-input"
			/>
			{#if searchResults.length > 0}
				<div class="search-navigation">
					<span class="search-count">{currentSearchIndex + 1} av {searchResults.length}</span>
					<button onclick={prevSearchResult} class="search-nav-btn" title="Forrige">↑</button>
					<button onclick={nextSearchResult} class="search-nav-btn" title="Neste">↓</button>
				</div>
			{/if}
			<button onclick={closeOrClearSearch} class="search-close" title={searchQuery.trim() ? 'Tøm søk' : 'Lukk søk'}>✕</button>
		</div>
	{/if}

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

	<div class="messages" bind:this={chatContainer} onscroll={handleScroll}>
		{#if isLoadingMore}
			<div class="loading-more">
				<div class="loading-more-spinner"></div>
				<span>Laster eldre meldinger...</span>
			</div>
		{/if}

		{#each messages as message (message.id)}
			<ChatMessage 
				role={message.role} 
				content={message.content}
				timestamp={message.timestamp}
				imageUrl={message.imageUrl}
			/>
		{/each}
		
		{#if isLoading}
			<div class="message assistant">
				<div class="message-content typing-indicator">
					<div class="typing-dots">
						<span></span>
						<span></span>
						<span></span>
					</div>
				</div>
			</div>
		{/if}
	</div>

	<form class="input-area" onsubmit={(e) => { e.preventDefault(); sendMessage(); }}>
		{#if isUploadingImage}
			<div class="upload-progress">
				<div class="progress-bar">
					<div class="progress-fill"></div>
				</div>
				<span class="progress-text">📤 Laster opp bilde...</span>
			</div>
		{/if}
		
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
				disabled={isLoading || isUploadingImage}
				title="Last opp bilde"
			>
				📷
			</button>
			<textarea
				bind:value={inputValue}
				onkeydown={handleKeyPress}
				placeholder="Skriv din melding her... (Enter for å sende, Shift+Enter for ny linje)"
				rows="3"
				disabled={isLoading || isUploadingImage}
			></textarea>
			<button type="submit" disabled={isLoading || isUploadingImage || (!inputValue.trim() && !selectedImage)}>
				{isUploadingImage ? '📤' : 'Send'}
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

	.search-toggle {
		font-size: 1.1rem;
	}

	.search-bar {
		background: white;
		border-bottom: 1px solid #e0e0e0;
		padding: 0.75rem 1rem;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		animation: slideDown 0.3s ease-out;
		box-shadow: 0 2px 4px rgba(0,0,0,0.05);
	}

	.search-input {
		flex: 1;
		padding: 0.5rem 0.75rem;
		border: 1px solid #ddd;
		border-radius: 0.375rem;
		font-size: 0.9rem;
		font-family: inherit;
	}

	.search-input:focus {
		outline: none;
		border-color: #667eea;
	}

	.search-navigation {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.search-count {
		font-size: 0.875rem;
		color: #666;
		white-space: nowrap;
	}

	.search-nav-btn {
		padding: 0.35rem 0.65rem;
		background: #667eea;
		color: white;
		border: 1px solid #667eea;
		border-radius: 0.25rem;
		cursor: pointer;
		font-size: 1rem;
		font-weight: bold;
		transition: background 0.2s;
		min-width: 32px;
	}

	.search-nav-btn:hover {
		background: #5568d3;
	}

	.search-close {
		background: #f5f5f5;
		border: 1px solid #ddd;
		color: #666;
		font-size: 1.1rem;
		cursor: pointer;
		padding: 0.35rem 0.65rem;
		border-radius: 0.25rem;
		transition: all 0.2s;
		min-width: 32px;
		font-weight: bold;
	}

	.search-close:hover {
		background: #e0e0e0;
		color: #333;
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

	.loading-more {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 1rem;
		color: #666;
		font-size: 0.875rem;
		animation: fadeIn 0.3s ease-in;
	}

	.loading-more-spinner {
		width: 16px;
		height: 16px;
		border: 2px solid #e0e0e0;
		border-top-color: #667eea;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	@keyframes fadeIn {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	/* Søke-highlight effekter */
	:global(.message.search-highlight-active) {
		background: rgba(102, 126, 234, 0.25) !important;
		border-left: 4px solid #667eea !important;
		padding-left: calc(1rem - 4px) !important;
		box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1) !important;
		transition: all 0.3s ease;
	}

	:global(.message.search-highlight-other) {
		background: rgba(255, 235, 59, 0.15) !important;
		border-left: 3px solid #ffc107 !important;
		padding-left: calc(1rem - 3px) !important;
		transition: all 0.3s ease;
	}

	.typing-indicator {
		background: linear-gradient(135deg, #f5f5f5 0%, #e8e8e8 100%);
		padding: 1rem 1.25rem;
		min-width: 60px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.typing-dots {
		display: flex;
		gap: 0.375rem;
		align-items: center;
	}

	.typing-dots span {
		width: 8px;
		height: 8px;
		background: #999;
		border-radius: 50%;
		animation: typingBounce 1.4s infinite ease-in-out;
	}

	.typing-dots span:nth-child(1) {
		animation-delay: 0s;
	}

	.typing-dots span:nth-child(2) {
		animation-delay: 0.2s;
	}

	.typing-dots span:nth-child(3) {
		animation-delay: 0.4s;
	}

	@keyframes typingBounce {
		0%, 60%, 100% {
			transform: translateY(0);
			opacity: 0.7;
		}
		30% {
			transform: translateY(-10px);
			opacity: 1;
		}
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

	.upload-progress {
		padding: 1rem;
		background: #e3f2fd;
		border-radius: 0.5rem;
		margin-bottom: 0.5rem;
		animation: slideDown 0.3s ease-out;
	}

	.progress-bar {
		width: 100%;
		height: 6px;
		background: #bbdefb;
		border-radius: 3px;
		overflow: hidden;
		margin-bottom: 0.5rem;
	}

	.progress-fill {
		height: 100%;
		background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
		animation: progress 1.5s ease-in-out infinite;
	}

	.progress-text {
		display: block;
		color: #1976d2;
		font-size: 0.875rem;
		font-weight: 500;
		text-align: center;
	}

	@keyframes progress {
		0% {
			width: 0%;
		}
		50% {
			width: 70%;
		}
		100% {
			width: 100%;
		}
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

