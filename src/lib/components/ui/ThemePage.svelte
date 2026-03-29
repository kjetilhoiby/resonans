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
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import ChatInput from './ChatInput.svelte';
	import HealthDashboard from './HealthDashboard.svelte';
	import EconomicsDashboard from './EconomicsDashboard.svelte';
	import ScreenTitle from './ScreenTitle.svelte';
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
		themeInstruction?: string;
		healthDashboard?: {
			weekly: unknown[];
			monthly: unknown[];
			yearly: unknown[];
			sources?: Array<{ id: string; name: string; provider: string; isActive: boolean; lastSync: string | null }>;
			recentEvents?: Array<{ id: string; timestamp: string; dataType: string; data: Record<string, unknown> }>;
		} | null;
		economicsDashboard?: {
			accounts: Array<{ accountId: string; accountName: string | null; accountType: string | null; balance: number; currency: string | null }>;
			totalBalance: number;
			currentMonth: string;
			monthSpending: {
				totalSpending: number;
				totalFixed: number;
				totalVariable: number;
				totalIncome: number;
				categories: Array<{ category: string; label: string; emoji: string; amount: number; count: number; isFixed: boolean }>;
			};
			recentTransactions: Array<{ date: string; description: string; amount: number; emoji: string; label: string }>;
		} | null;
	}

	let { theme, initialMessages, goals, conversationId, themeInstruction = '', healthDashboard = null, economicsDashboard = null }: Props = $props();

	/* ── Subtab-tilstand ────────────────────────────────── */
	type Tab = 'chat' | 'data' | 'filer';
	const isHealthTheme = theme.name.trim().toLowerCase() === 'helse';
	const isEconomicsTheme = theme.name.trim().toLowerCase() === 'økonomi';
	const requestedTab = get(page).url.searchParams.get('tab');
	let tab = $state<Tab>(
		requestedTab === 'chat' || requestedTab === 'data' || requestedTab === 'filer'
			? requestedTab
			: isHealthTheme || isEconomicsTheme
				? 'data'
				: 'chat'
	);
	let handoffPhase = $state<'intro' | 'content'>('content');

	onMount(() => {
		if (get(page).url.searchParams.get('handoff') !== '1') return;
		handoffPhase = 'intro';
		const timer = setTimeout(() => {
			handoffPhase = 'content';
		}, 950);
		return () => clearTimeout(timer);
	});

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
	let archiveRedirect = $state<{ name: string; emoji?: string | null } | null>(null);

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

			if (data.themeArchived && data.archivedTheme?.id === theme.id) {
				archiveRedirect = {
					name: data.archivedTheme.name,
					emoji: data.archivedTheme.emoji ?? theme.emoji
				};
				setTimeout(() => {
					void goto('/?archivedTheme=1');
				}, 1050);
				return;
			}

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

	/* ── Filer-tab: instruksjonsfil ─────────────────────── */
	const instructionFileName = 'instrukser.md';
	let instructionDraft = $state(themeInstruction ?? '');
	let instructionSaving = $state(false);
	let instructionSaved = $state(false);
	let instructionError = $state('');

	/* ── Navigasjon: klikk + swipe ─────────────────────── */
	let touchStartX = 0;
	let touchStartY = 0;
	let touchActive = false;
	let swipeUsed = false;
	let pinchStartDistance = 0;
	let pinchActive = false;

	function goHome() {
		void goto('/');
	}

	function touchDistance(touches: TouchList): number {
		if (touches.length < 2) return 0;
		const dx = touches[0].clientX - touches[1].clientX;
		const dy = touches[0].clientY - touches[1].clientY;
		return Math.hypot(dx, dy);
	}

	function onTouchStart(event: TouchEvent) {
		if (event.touches.length === 2) {
			pinchStartDistance = touchDistance(event.touches);
			pinchActive = pinchStartDistance > 0;
			touchActive = false;
			return;
		}

		if (event.touches.length !== 1) {
			touchActive = false;
			return;
		}
		const touch = event.touches[0];
		touchStartX = touch.clientX;
		touchStartY = touch.clientY;
		touchActive = true;
		swipeUsed = false;
	}

	function onTouchMove(event: TouchEvent) {
		if (pinchActive && event.touches.length === 2) {
			const currentDistance = touchDistance(event.touches);
			// Pinch in (fingre nærmere hverandre) defokuserer temaet.
			if (pinchStartDistance - currentDistance > 44) {
				pinchActive = false;
				goHome();
			}
			return;
		}

		if (!touchActive || swipeUsed || event.touches.length !== 1) return;
		const touch = event.touches[0];
		const deltaX = touch.clientX - touchStartX;
		const deltaY = Math.abs(touch.clientY - touchStartY);

		// Edge-swipe: start nær venstre kant og dra tydelig mot høyre.
		if (touchStartX <= 38 && deltaX > 92 && deltaY < 70) {
			swipeUsed = true;
			touchActive = false;
			goHome();
		}
	}

	function onTouchEnd() {
		touchActive = false;
		pinchActive = false;
	}

	$effect(() => {
		instructionDraft = themeInstruction ?? '';
	});

	async function saveInstruction() {
		instructionSaving = true;
		instructionSaved = false;
		instructionError = '';

		try {
			const res = await fetch(`/api/tema/${theme.id}/instruction`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content: instructionDraft })
			});

			if (!res.ok) throw new Error('Lagring feilet');

			instructionSaved = true;
			setTimeout(() => {
				instructionSaved = false;
			}, 1400);
		} catch {
			instructionError = 'Lagring feilet. Prøv igjen.';
		} finally {
			instructionSaving = false;
		}
	}
</script>

<div class="theme-page" ontouchstart={onTouchStart} ontouchmove={onTouchMove} ontouchend={onTouchEnd}>
	{#if archiveRedirect}
		<section class="tp-archived" aria-live="polite">
			<div class="tp-archived-chip">
				<span class="tp-archived-icon">{archiveRedirect.emoji ?? '◎'}</span>
				<span>Tema arkivert</span>
			</div>
			<h1 class="tp-archived-title">{archiveRedirect.name}</h1>
			<p class="tp-archived-copy">Sender deg tilbake til hjem…</p>
		</section>
	{:else}
	{#if handoffPhase === 'intro'}
		<section class="tp-launch" aria-live="polite">
			<div class="tp-launch-chip">
				<span class="tp-launch-icon">{theme.emoji ?? '◎'}</span>
				<span>Nytt tema</span>
			</div>
			<h1 class="tp-launch-title">{theme.name}</h1>
			<p class="tp-launch-copy">Kobler deg inn i Samtaler, Mål og Filer…</p>
		</section>
	{:else}
		<!-- ── Topptekst ── -->
		<header class="tp-header tp-enter">
			<ScreenTitle
				title={theme.name}
				subtitle={theme.description ?? ''}
				emoji={theme.emoji ?? '🎯'}
				onpress={goHome}
				ariaLabel="Gå til forsiden"
			/>
		</header>

		<!-- ── Tabs ── -->
		<div class="tp-tabs tp-enter" role="tablist" aria-label="Tema-seksjoner">
			{#each (['chat', 'data', 'filer'] as Tab[]) as t}
				<button
					class="tp-tab"
					class:active={tab === t}
					role="tab"
					aria-selected={tab === t}
					onclick={() => (tab = t)}
				>
					{#if t === 'chat'}💬 Samtaler
				{:else if t === 'data'}{isHealthTheme ? '💪 Helse' : isEconomicsTheme ? '💰 Økonomi' : '🎯 Mål'}
					{:else}📁 Filer{/if}
				</button>
			{/each}
		</div>

		<!-- ── Tab-innhold ── -->
		<div class="tp-body tp-enter">
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
				{#if isHealthTheme && healthDashboard}
					<HealthDashboard
						weekly={healthDashboard.weekly as any}
						monthly={healthDashboard.monthly as any}
						yearly={healthDashboard.yearly as any}
						sources={healthDashboard.sources ?? []}
						recentEvents={healthDashboard.recentEvents ?? []}
						embedded={true}
					/>
				{/if}

				{#if isEconomicsTheme && economicsDashboard}
					<EconomicsDashboard
						accounts={economicsDashboard.accounts}
						totalBalance={economicsDashboard.totalBalance}
						currentMonth={economicsDashboard.currentMonth}
						monthSpending={economicsDashboard.monthSpending}
						recentTransactions={economicsDashboard.recentTransactions}
						embedded={true}
					/>
				{/if}

				{#if !isEconomicsTheme}
				{#if goals.length === 0}
					<div class="data-empty" class:data-empty-tight={isHealthTheme && healthDashboard}>
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
					{#if isHealthTheme && healthDashboard}
						<div class="data-section-head">
							<h2 class="data-section-title">Mål</h2>
							<p class="data-section-copy">Koble mål til Helse-temaet for å se dem sammen med sensordata.</p>
						</div>
					{/if}
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
				{/if}
			</div>

		<!-- FILER -->
		{:else}
			<div class="files-panel">
				<div class="files-header">
					<span class="files-count">1 fil</span>
					<button class="files-upload-btn" onclick={saveInstruction} disabled={instructionSaving} aria-label="Lagre instruksfil">
						{instructionSaving ? 'Lagrer…' : 'Lagre'}
					</button>
				</div>

				<div class="instruction-file">
					<div class="instruction-file-head">
						<span class="instruction-file-icon">📄</span>
						<span class="instruction-file-name">{instructionFileName}</span>
					</div>

					<textarea
						class="instruction-editor"
						bind:value={instructionDraft}
						rows="14"
						placeholder="# Instrukser

Skriv hvordan du vil jobbe med dette temaet.

Eksempel:
- Hvor ser jeg meg om fem år?
- Hva er viktigst nå?
- Hvilke mål må justeres?"
					></textarea>

					<div class="instruction-foot">
						{#if instructionError}
							<span class="instruction-error">{instructionError}</span>
						{:else if instructionSaved}
							<span class="instruction-saved">Lagret</span>
						{:else if !instructionDraft.trim()}
							<span class="instruction-empty">Tom fil klar for utfylling</span>
						{:else}
							<span class="instruction-empty">Redigerbar instruksfil for temaet</span>
						{/if}
					</div>
				</div>
			</div>
		{/if}
		</div>
	{/if}
	{/if}
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

	.tp-launch {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 14px;
		padding: 20px;
		background:
			radial-gradient(110% 80% at 50% -10%, rgba(106, 132, 233, 0.22), transparent 55%),
			linear-gradient(180deg, #11141d 0%, #0e0f13 100%);
		animation: launchBackdrop 0.9s ease;
	}

	.tp-archived {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 14px;
		padding: 20px;
		background:
			radial-gradient(90% 70% at 50% -10%, rgba(72, 181, 129, 0.18), transparent 58%),
			linear-gradient(180deg, #101713 0%, #0d1110 100%);
		animation: launchBackdrop 0.45s ease;
	}

	.tp-archived-chip {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 9px 14px;
		border: 1px solid #2f4f3f;
		border-radius: 999px;
		background: #132018;
		color: #c5efd6;
		font-size: 0.8rem;
	}

	.tp-archived-icon {
		width: 24px;
		height: 24px;
		border-radius: 8px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: #173022;
		border: 1px solid #2f6248;
	}

	.tp-archived-title {
		margin: 0;
		font-size: clamp(1.7rem, 5.3vw, 2.2rem);
		letter-spacing: -0.03em;
		color: #ecfff4;
	}

	.tp-archived-copy {
		margin: 0;
		font-size: 0.88rem;
		color: #8fc6a5;
	}

	.tp-launch-chip {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 9px 14px;
		border: 1px solid #334166;
		border-radius: 999px;
		background: #141a2a;
		color: #c8d2fa;
		font-size: 0.8rem;
		animation: launchDrop 0.5s cubic-bezier(0.2, 0.84, 0.24, 1);
	}

	.tp-launch-icon {
		width: 24px;
		height: 24px;
		border-radius: 8px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: #1a2236;
		border: 1px solid #3a4a74;
	}

	.tp-launch-title {
		margin: 0;
		font-size: clamp(1.8rem, 5.4vw, 2.3rem);
		letter-spacing: -0.03em;
		color: #f0f3ff;
		animation: launchRise 0.58s ease;
	}

	.tp-launch-copy {
		margin: 0;
		font-size: 0.88rem;
		color: #95a0c9;
		animation: launchFade 0.65s ease;
	}

	.tp-enter {
		animation: contentRise 0.4s ease;
	}

	@keyframes launchBackdrop {
		from {
			opacity: 0.1;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes launchDrop {
		from {
			opacity: 0;
			transform: translateY(-28px) scale(0.94);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	@keyframes launchRise {
		from {
			opacity: 0;
			transform: translateY(12px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes launchFade {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes contentRise {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/* ── Header ── */
	.tp-header {
		padding: var(--screen-title-top-pad, 34px) 20px 16px;
		border-bottom: 1px solid #1e1e1e;
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

	@media (prefers-reduced-motion: reduce) {
		.tp-launch,
		.tp-launch-chip,
		.tp-launch-title,
		.tp-launch-copy,
		.tp-archived,
		.tp-enter {
			animation: none !important;
		}
	}

	/* ── Data tab ── */
	.data-panel {
		padding: 16px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 16px;
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

	.data-empty-tight {
		padding-top: 8px;
	}

	.data-section-head {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.data-section-title {
		margin: 0;
		font-size: 0.92rem;
		font-weight: 700;
		color: #e8e8e8;
	}

	.data-section-copy {
		margin: 0;
		font-size: 0.78rem;
		line-height: 1.5;
		color: #666;
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
		color: #666;
		font: inherit;
		font-size: 0.78rem;
		padding: 6px 14px;
		border-radius: 99px;
		cursor: pointer;
	}

	.files-upload-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.instruction-file {
		border: 1px solid #242424;
		border-radius: 14px;
		background: #131313;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.instruction-file-head {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.instruction-file-icon {
		font-size: 0.98rem;
		opacity: 0.7;
	}

	.instruction-file-name {
		font-size: 0.86rem;
		font-weight: 600;
		color: #aaa;
	}

	.instruction-editor {
		width: 100%;
		border-radius: 12px;
		border: 1px solid #2a2a2a;
		background: #0f0f0f;
		color: #d4d4d4;
		font: inherit;
		font-size: 0.95rem;
		line-height: 1.5;
		padding: 12px;
		resize: vertical;
		min-height: 180px;
	}

	.instruction-editor:focus {
		outline: none;
		border-color: #3c4f9f;
	}

	.instruction-foot {
		font-size: 0.8rem;
	}

	.instruction-saved {
		color: #74cf9e;
	}

	.instruction-error {
		color: #ee8c8c;
	}

	.instruction-empty {
		color: #777;
	}

</style>
