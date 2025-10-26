<script lang="ts">
	import { onMount } from 'svelte';
	import { fly, slide } from 'svelte/transition';
	import ChatMessage from '$lib/components/ChatMessage.svelte';

	// Dashboard data
	let dashboardData = $state<{
		statusCards: Array<{
			type: string;
			themeId: string;
			title: string;
			emoji: string;
			metrics: {
				streak: number;
				activeGoals: number;
				weeklyActivity: number;
			};
			description: string | null;
		}>;
		suggestedActions: Array<{
			type: string;
			icon: string;
			label: string;
			sublabel: string;
			action: {
				type: string;
				target: string | null;
			};
		}>;
		stats: {
			activeThemesCount: number;
			activeGoalsCount: number;
			recentActivityCount: number;
		};
	} | null>(null);

	// Chat state
	let chatExpanded = $state(false);
	let messages = $state<Array<{
		id: string;
		role: 'user' | 'assistant';
		content: string;
		timestamp: Date;
	}>>([]);
	let inputValue = $state('');
	let isLoading = $state(false);

	// Hent dashboard data
	onMount(async () => {
		const res = await fetch('/api/dashboard');
		if (res.ok) {
			dashboardData = await res.json();
		}
	});

	function expandChat() {
		chatExpanded = true;
	}

	function collapseChat() {
		chatExpanded = false;
	}

	function handleSuggestionClick(action: { type: string; target: string | null }) {
		if (action.type === 'navigate' && action.target) {
			window.location.href = action.target;
		} else if (action.type === 'focus_chat') {
			expandChat();
		}
	}

	async function sendMessage() {
		if (!inputValue.trim() || isLoading) return;

		const userMessage = inputValue.trim();
		inputValue = '';
		isLoading = true;

		// Legg til brukermelding
		messages = [
			...messages,
			{
				id: crypto.randomUUID(),
				role: 'user',
				content: userMessage,
				timestamp: new Date()
			}
		];

		try {
			const res = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: userMessage })
			});

			if (res.ok) {
				const data = await res.json();
				messages = [
					...messages,
					{
						id: crypto.randomUUID(),
						role: 'assistant',
						content: data.message,
						timestamp: new Date()
					}
				];
			}
		} catch (error) {
			console.error('Chat error:', error);
		} finally {
			isLoading = false;
		}
	}
</script>

<div class="dashboard-container" class:chat-expanded={chatExpanded}>
	<!-- Status Overview - Øverste tredjedel -->
	{#if !chatExpanded && dashboardData}
		<section class="status-overview" transition:slide={{ duration: 200 }}>
			<h2 class="section-title">Oversikt</h2>
			
			<div class="status-cards">
				{#each dashboardData.statusCards as card}
					<div class="status-card">
						<div class="card-header">
							<span class="card-emoji">{card.emoji}</span>
							<h3 class="card-title">{card.title}</h3>
						</div>
						
						<div class="card-metrics">
							{#if card.metrics.streak > 0}
								<div class="metric">
									<span class="metric-icon">🔥</span>
									<span class="metric-value">{card.metrics.streak}</span>
									<span class="metric-label">dager</span>
								</div>
							{/if}
							
							{#if card.metrics.weeklyActivity > 0}
								<div class="metric">
									<span class="metric-icon">📈</span>
									<span class="metric-value">{card.metrics.weeklyActivity}</span>
									<span class="metric-label">denne uken</span>
								</div>
							{/if}

							{#if card.metrics.activeGoals > 0}
								<div class="metric">
									<span class="metric-icon">🎯</span>
									<span class="metric-value">{card.metrics.activeGoals}</span>
									<span class="metric-label">aktive mål</span>
								</div>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Suggested Actions - Midtre tredjedel -->
	{#if !chatExpanded && dashboardData}
		<section class="suggested-actions" transition:slide={{ duration: 200 }}>
			<h2 class="section-title">Foreslåtte handlinger</h2>
			
			<div class="action-list">
				{#each dashboardData.suggestedActions as suggestion}
					<button 
						class="action-card" 
						onclick={() => handleSuggestionClick(suggestion.action)}
					>
						<span class="action-icon">{suggestion.icon}</span>
						<div class="action-content">
							<span class="action-label">{suggestion.label}</span>
							<span class="action-sublabel">{suggestion.sublabel}</span>
						</div>
						<span class="action-arrow">→</span>
					</button>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Chat Interface - Bunnen (ekspanderer til fullskjerm) -->
	<section class="chat-section" class:expanded={chatExpanded}>
		{#if chatExpanded}
			<div class="chat-header">
				<button class="back-button" onclick={collapseChat}>
					← Tilbake
				</button>
				<h2>Chat med AI</h2>
			</div>

			<div class="chat-messages">
				{#each messages as message (message.id)}
					<ChatMessage 
						role={message.role} 
						content={message.content}
						timestamp={message.timestamp}
					/>
				{/each}
				
				{#if isLoading}
					<div class="loading-indicator">
						<span class="loading-dot"></span>
						<span class="loading-dot"></span>
						<span class="loading-dot"></span>
					</div>
				{/if}
			</div>
		{/if}

		<div class="chat-input-container">
			<input
				type="text"
				class="chat-input"
				placeholder="Hva tenker du på?"
				bind:value={inputValue}
				onfocus={expandChat}
				onkeydown={(e) => e.key === 'Enter' && sendMessage()}
			/>
			{#if chatExpanded}
				<button class="send-button" onclick={sendMessage} disabled={isLoading || !inputValue.trim()}>
					Send
				</button>
			{/if}
		</div>
	</section>
</div>

<style>
	.dashboard-container {
		min-height: 100vh;
		background: var(--bg-primary);
		color: var(--text-secondary);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.dashboard-container.chat-expanded {
		overflow-y: auto;
	}

	/* Status Overview - Øverste tredjedel */
	.status-overview {
		padding: 1.5rem 1rem;
		background: var(--bg-header);
		border-bottom: 1px solid var(--border-color);
	}

	.section-title {
		font-size: 0.85rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-tertiary);
		margin: 0 0 1rem 0;
		font-weight: 600;
	}

	.status-cards {
		display: flex;
		gap: 0.75rem;
		overflow-x: auto;
		padding-bottom: 0.5rem;
		-webkit-overflow-scrolling: touch;
	}

	.status-card {
		min-width: 280px;
		background: var(--bg-card);
		border: 1px solid var(--border-color);
		border-radius: 12px;
		padding: 1rem;
	}

	.card-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.card-emoji {
		font-size: 1.5rem;
	}

	.card-title {
		font-size: 1rem;
		font-weight: 600;
		margin: 0;
		color: var(--text-primary);
	}

	.card-metrics {
		display: flex;
		gap: 1rem;
	}

	.metric {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
	}

	.metric-icon {
		font-size: 1.2rem;
	}

	.metric-value {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--text-primary);
	}

	.metric-label {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	/* Suggested Actions - Midtre tredjedel */
	.suggested-actions {
		padding: 1.5rem 1rem;
		flex: 1;
	}

	.action-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.action-card {
		width: 100%;
		background: var(--bg-card);
		border: 1px solid var(--border-color);
		border-radius: 12px;
		padding: 1rem;
		display: flex;
		align-items: center;
		gap: 1rem;
		cursor: pointer;
		transition: all 0.2s;
		color: inherit;
		text-align: left;
	}

	.action-card:hover {
		background: var(--bg-hover);
		border-color: var(--border-subtle);
		transform: translateX(4px);
	}

	.action-icon {
		font-size: 1.5rem;
		flex-shrink: 0;
	}

	.action-content {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.action-label {
		font-size: 0.95rem;
		font-weight: 500;
		color: var(--text-primary);
	}

	.action-sublabel {
		font-size: 0.85rem;
		color: var(--text-tertiary);
	}

	.action-arrow {
		font-size: 1.2rem;
		color: var(--text-tertiary);
		flex-shrink: 0;
	}

	/* Chat Section - Bunnen */
	.chat-section {
		background: var(--bg-header);
		border-top: 1px solid var(--border-color);
		padding: 1rem;
		transition: all 0.3s ease;
	}

	.chat-section.expanded {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 100;
		display: flex;
		flex-direction: column;
		padding: 0;
	}

	.chat-header {
		background: var(--bg-header);
		border-bottom: 1px solid var(--border-color);
		padding: 1rem;
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.back-button {
		background: none;
		border: none;
		color: var(--text-primary);
		font-size: 0.95rem;
		cursor: pointer;
		padding: 0.5rem;
		margin-left: -0.5rem;
	}

	.chat-header h2 {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 600;
	}

	.chat-messages {
		flex: 1;
		overflow-y: auto;
		padding: 1rem;
		background: var(--bg-primary);
	}

	.chat-input-container {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	.chat-input {
		flex: 1;
		background: var(--bg-card);
		border: 1px solid var(--border-color);
		border-radius: 24px;
		padding: 0.875rem 1.25rem;
		color: var(--text-primary);
		font-size: 0.95rem;
		outline: none;
		transition: all 0.2s;
	}

	.chat-input:focus {
		border-color: var(--accent-primary);
		box-shadow: 0 0 0 3px var(--info-bg);
	}

	.chat-section.expanded .chat-input-container {
		padding: 1rem;
		background: var(--bg-header);
		border-top: 1px solid var(--border-color);
	}

	.send-button {
		background: var(--accent-primary);
		border: none;
		border-radius: 24px;
		padding: 0.875rem 1.5rem;
		color: white;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}

	.send-button:hover:not(:disabled) {
		background: var(--accent-hover);
	}

	.send-button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.loading-indicator {
		display: flex;
		gap: 0.5rem;
		padding: 1rem;
		justify-content: center;
	}

	.loading-dot {
		width: 8px;
		height: 8px;
		background: var(--text-tertiary);
		border-radius: 50%;
		animation: pulse 1.4s infinite ease-in-out;
	}

	.loading-dot:nth-child(1) {
		animation-delay: -0.32s;
	}

	.loading-dot:nth-child(2) {
		animation-delay: -0.16s;
	}

	@keyframes pulse {
		0%, 80%, 100% {
			opacity: 0.4;
			transform: scale(0.8);
		}
		40% {
			opacity: 1;
			transform: scale(1);
		}
	}
</style>
