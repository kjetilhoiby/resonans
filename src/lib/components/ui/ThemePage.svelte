<!--
  ThemePage — tre-tab-visning for ett tema.
  Tabs: Chat | Data | Filer

  Props:
    theme           tema-objekt fra DB
    initialMessages meldinger for dette temaets samtale
    goals           aktive mål koblet til temaet
    conversationId  UUID til temaets conversation (for API-kall)
-->
<script lang="ts">
	import ChatInput from './ChatInput.svelte';
	import TriageCard from './TriageCard.svelte';
	import GoalRing from './GoalRing.svelte';

	/* ── Types ──────────────────────────────────────────── */
	interface Theme {
		id: string;
		name: string;
		emoji: string | null;
		description?: string | null;
	}

	interface Message {
		id: string;
		role: 'user' | 'assistant' | 'system';
		content: string;
		timestamp: string;
	}

	interface Goal {
		id: string;
		title: string;
		status: string;
		description?: string | null;
	}

	interface Props {
		theme: Theme;
		initialMessages: Message[];
		goals: Goal[];
		conversationId: string;
	}

	let { theme, initialMessages, goals, conversationId }: Props = $props();

	/* ── Subtab-tilstand ────────────────────────────────── */
	type Tab = 'chat' | 'data' | 'filer';
	let tab = $state<Tab>('chat');

	/* ── Chat-tilstand ──────────────────────────────────── */
	interface ChatMsg {
		role: 'user' | 'assistant';
		text: string;
	}

	let chatMessages = $state<ChatMsg[]>(
		initialMessages
			.filter((m) => m.role !== 'system')
			.map((m) => ({ role: m.role as 'user' | 'assistant', text: m.content }))
	);
	let chatLoading = $state(false);
	let chatError = $state('');

	async function sendMessage(text: string) {
		chatMessages.push({ role: 'user', text });
		chatLoading = true;
		chatError = '';

		try {
			const res = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: text, conversationId })
			});

			if (!res.ok) throw new Error(await res.text());
			const data = await res.json();
			chatMessages.push({ role: 'assistant', text: data.message });
		} catch (err) {
			chatError = 'Noe gikk galt. Prøv igjen.';
		} finally {
			chatLoading = false;
		}
	}

	/* ── Data-tab hjelpefunksjoner ──────────────────────── */
	const GOAL_COLORS: Record<string, string> = {
		active: '#7c8ef5',
		completed: '#5fa0a0',
		paused: '#888',
		abandoned: '#e07070',
	};

	function goalPct(goal: Goal) {
		if (goal.status === 'completed') return 100;
		if (goal.status === 'paused') return 35;
		return 55; // Fase 5 vil beregne dette fra aktiviteter
	}

	/* ── Filer-tab: stub ────────────────────────────────── */
	let files: { name: string; uploadedAt: string }[] = [];
</script>

<div class="theme-page">
	<!-- ── Topptekst ── -->
	<header class="tp-header">
		<div class="tp-title-row">
			<span class="tp-emoji">{theme.emoji ?? '🎯'}</span>
			<h1 class="tp-title">{theme.name}</h1>
		</div>
		{#if theme.description}
			<p class="tp-desc">{theme.description}</p>
		{/if}
	</header>

	<!-- ── Tabs ── -->
	<div class="tp-tabs" role="tablist" aria-label="Tema-seksjoner">
		{#each (['chat', 'data', 'filer'] as Tab[]) as t}
			<button
				class="tp-tab"
				class:active={tab === t}
				role="tab"
				aria-selected={tab === t}
				onclick={() => (tab = t)}
			>
				{#if t === 'chat'}💬 Chat
				{:else if t === 'data'}📊 Data
				{:else}📁 Filer{/if}
			</button>
		{/each}
	</div>

	<!-- ── Tab-innhold ── -->
	<div class="tp-body">
		<!-- CHAT -->
		{#if tab === 'chat'}
			<div class="chat-panel">
				<div class="chat-messages" aria-live="polite" aria-label="Samtalehistorikk">
					{#if chatMessages.length === 0}
						<p class="chat-empty">Ingen meldinger ennå — start samtalen nedenfor.</p>
					{/if}

					{#each chatMessages as msg}
						{#if msg.role === 'user'}
							<div class="bubble bubble-user">{msg.text}</div>
						{:else}
							<TriageCard text={msg.text} />
						{/if}
					{/each}

					{#if chatLoading}
						<TriageCard loading={true} />
					{/if}

					{#if chatError}
						<p class="chat-error">{chatError}</p>
					{/if}
				</div>

				<div class="chat-input-wrap">
					<ChatInput
						placeholder="Spør om {theme.name.toLowerCase()}…"
						disabled={chatLoading}
						onsubmit={sendMessage}
					/>
				</div>
			</div>

		<!-- DATA -->
		{:else if tab === 'data'}
			<div class="data-panel">
				{#if goals.length === 0}
					<div class="data-empty">
						<p>Ingen aktive mål i dette temaet ennå.</p>
						<button
							class="data-new-btn"
							onclick={() => {
								tab = 'chat';
								// Pre-fill could be nice in future
							}}
						>
							+ Si til AI at du vil sette et mål
						</button>
					</div>
				{:else}
					<div class="goals-grid">
						{#each goals as goal}
							{@const pct = goalPct(goal)}
							{@const color = GOAL_COLORS[goal.status] ?? '#7c8ef5'}
							<div class="goal-card">
								<div class="goal-ring">
									<GoalRing {pct} {color} r={28} strokeWidth={5} size={80}>
										{#snippet children()}
											<text
												x="40"
												y="44"
												text-anchor="middle"
												fill={color}
												font-size="12"
												font-weight="700"
											>{pct}%</text>
										{/snippet}
									</GoalRing>
								</div>
								<div class="goal-info">
									<span class="goal-title">{goal.title}</span>
									{#if goal.description}
										<span class="goal-desc">{goal.description}</span>
									{/if}
									<span
										class="goal-status"
										style="color:{color}"
									>{goal.status}</span>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>

		<!-- FILER -->
		{:else}
			<div class="files-panel">
				<div class="files-header">
					<span class="files-count">{files.length} filer</span>
					<!-- Opplasting kobles til /api/upload-image i Fase 5 -->
					<button class="files-upload-btn" disabled aria-label="Last opp (kommer snart)">
						+ Last opp
					</button>
				</div>

				{#if files.length === 0}
					<div class="files-empty">
						<span class="files-icon">📎</span>
						<p>Ingen filer her ennå</p>
						<p class="files-hint">Last opp bilder, PDF-er eller notater knyttet til dette temaet.</p>
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	.theme-page {
		min-height: 100dvh;
		background: #0f0f0f;
		color: #ccc;
		font-family: 'Inter', system-ui, sans-serif;
		display: flex;
		flex-direction: column;
	}

	/* ── Header ── */
	.tp-header {
		padding: 48px 20px 16px;
		border-bottom: 1px solid #1e1e1e;
	}

	.tp-title-row {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 6px;
	}

	.tp-emoji {
		font-size: 1.6rem;
	}

	.tp-title {
		font-size: 1.4rem;
		font-weight: 700;
		letter-spacing: -0.03em;
		color: #e8e8e8;
		margin: 0;
	}

	.tp-desc {
		font-size: 0.8rem;
		color: #555;
		margin: 0;
		line-height: 1.5;
	}

	/* ── Tabs ── */
	.tp-tabs {
		display: flex;
		border-bottom: 1px solid #1e1e1e;
		padding: 0 12px;
		gap: 4px;
	}

	.tp-tab {
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		color: #444;
		font: inherit;
		font-size: 0.78rem;
		padding: 10px 12px;
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
		white-space: nowrap;
	}

	.tp-tab.active {
		color: #ccc;
		border-bottom-color: #7c8ef5;
	}

	.tp-tab:hover:not(.active) {
		color: #888;
	}

	/* ── Body ── */
	.tp-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	/* ── Chat tab ── */
	.chat-panel {
		flex: 1;
		display: flex;
		flex-direction: column;
		height: 100%;
		max-height: calc(100dvh - 160px);
	}

	.chat-messages {
		flex: 1;
		overflow-y: auto;
		padding: 16px 16px 8px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		scrollbar-width: thin;
		scrollbar-color: #222 transparent;
	}

	.bubble-user {
		align-self: flex-end;
		background: #1a1a2e;
		border: 1px solid #2a2a4a;
		border-radius: 14px 14px 4px 14px;
		padding: 9px 14px;
		font-size: 0.88rem;
		line-height: 1.5;
		max-width: 78%;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.chat-empty {
		color: #333;
		font-size: 0.82rem;
		text-align: center;
		margin: auto;
		font-style: italic;
	}

	.chat-error {
		color: #e07070;
		font-size: 0.8rem;
		text-align: center;
	}

	.chat-input-wrap {
		padding: 10px 12px env(safe-area-inset-bottom, 12px);
		border-top: 1px solid #1a1a1a;
	}

	/* ── Data tab ── */
	.data-panel {
		padding: 16px;
		overflow-y: auto;
	}

	.data-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		padding: 48px 20px;
		color: #444;
		font-size: 0.85rem;
		text-align: center;
	}

	.data-new-btn {
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		color: #7c8ef5;
		font: inherit;
		font-size: 0.8rem;
		padding: 8px 16px;
		border-radius: 99px;
		cursor: pointer;
	}

	.goals-grid {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.goal-card {
		background: #141414;
		border: 1px solid #242424;
		border-radius: 14px;
		padding: 14px;
		display: flex;
		gap: 14px;
		align-items: center;
	}

	.goal-ring {
		flex-shrink: 0;
	}

	.goal-info {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}

	.goal-title {
		font-size: 0.9rem;
		font-weight: 600;
		color: #ddd;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.goal-desc {
		font-size: 0.72rem;
		color: #555;
		line-height: 1.4;
	}

	.goal-status {
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.07em;
	}

	/* ── Filer tab ── */
	.files-panel {
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.files-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.files-count {
		font-size: 0.75rem;
		color: #444;
	}

	.files-upload-btn {
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		color: #555;
		font: inherit;
		font-size: 0.78rem;
		padding: 6px 14px;
		border-radius: 99px;
		cursor: not-allowed;
	}

	.files-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 48px 20px;
		text-align: center;
	}

	.files-icon {
		font-size: 2rem;
		opacity: 0.3;
	}

	.files-empty p {
		font-size: 0.85rem;
		color: #444;
		margin: 0;
	}

	.files-hint {
		font-size: 0.75rem !important;
		color: #333 !important;
	}
</style>
