<script lang="ts">
	import { AppPage, PageHeader } from '$lib/components/ui';
	import TriageCard from '$lib/components/composed/TriageCard.svelte';
	import ChatInput from '$lib/components/ui/ChatInput.svelte';
	import SpendingChart from '$lib/components/charts/SpendingChart.svelte';
	import { streamProxyChat } from '$lib/client/proxy-chat-stream';
	import { tick } from 'svelte';
	import type { SalaryMonthReport, GoalProgressItem } from '$lib/types/salary-report';

	interface RichChatMsg {
		role: 'user' | 'assistant';
		text: string;
	}

	let { data }: { data: { report: SalaryMonthReport | null; accounts: unknown[] } } = $props();

	const report = $derived(data.report);

	// ── Step state ────────────────────────────────────────────────────────────
	const STEP_LABELS = ['Oversikt', 'Forbruk', 'Sparekonto', 'Mål', 'Sammenligning'];
	let currentStep = $state(0);
	let chatOpen = $state([false, false, false, false, false]);
	let chatMessages = $state<RichChatMsg[][]>([[], [], [], [], []]);
	let convIds = $state<(string | null)[]>([null, null, null, null, null]);
	let chatLoading = $state([false, false, false, false, false]);
	let chatStreamingText = $state(['', '', '', '', '']);
	let chatEls = $state<(HTMLDivElement | null)[]>([null, null, null, null, null]);

	// ── Helpers ───────────────────────────────────────────────────────────────
	function fmt(n: number) {
		return Math.round(Math.abs(n)).toLocaleString('nb-NO');
	}

	function fmtDate(iso: string) {
		return new Date(iso).toLocaleDateString('nb-NO', { day: 'numeric', month: 'long' });
	}

	function trendLabel(pct: number) {
		const sign = pct >= 0 ? '▲' : '▼';
		return `${sign} ${Math.abs(Math.round(pct))}% vs forrige periode`;
	}

	// ── SpendingChart data ────────────────────────────────────────────────────
	const spendingChartData = $derived(
		report
			? [
					{
						month: report.currentSalaryDate.slice(0, 7),
						categories: report.categories,
						totalSpending: report.totalSpending,
						totalFixed: report.totalFixed,
						totalVariable: report.totalVariable,
						totalIncome: report.salaryAmount
					}
				]
			: []
	);

	// ── System prompts per step ───────────────────────────────────────────────
	function buildSystemPrompt(step: number): string {
		if (!report) return '';
		const base = `Du hjelper brukeren med å forstå sin lønnsmåned (${fmtDate(report.currentSalaryDate)} – i dag). Svar kort og konkret på norsk.`;
		const data = {
			lønnsbeløp: report.salaryAmount,
			totaltForbruk: report.totalSpending,
			fastForbruk: report.totalFixed,
			variabeltForbruk: report.totalVariable,
			trendVsForrige: `${Math.round(report.spendingTrend)}%`,
			kategorier: report.categories.slice(0, 8).map((c) => `${c.emoji} ${c.label}: kr ${fmt(c.amount)}`),
			sparekonto: report.savingsChanges.map((s) => `${s.accountName}: ${s.change >= 0 ? '+' : ''}kr ${fmt(s.change)}`),
			mål: report.goalProgress.filter((g) => g.type === 'track').map((g) => `${g.label}: ${fmt(g.actualValue)} / ${fmt(g.targetValue)} ${g.unit} (${g.achieved ? 'nådd' : 'ikke nådd'})`)
		};
		return `${base}\n\nRapportdata:\n${JSON.stringify(data, null, 2)}`;
	}

	const STEP_PROMPTS = [
		'Gi meg en kort oppsummering av lønnsmåneden min.',
		'Hva er de viktigste forbruksmønstrene mine denne perioden?',
		'Hvordan har sparekontoen min utviklet seg siden lønning?',
		'Hvordan ligger jeg an mot målene mine denne perioden?',
		'Sammenlikn forbruket mitt med forrige lønnsmåned og gi meg innsikt.'
	];

	// ── Chat ─────────────────────────────────────────────────────────────────
	async function toggleChat(step: number) {
		chatOpen = chatOpen.map((v, i) => (i === step ? !v : v));
		if (chatOpen[step] && chatMessages[step].length === 0) {
			await sendChat(step, STEP_PROMPTS[step], true);
		}
	}

	async function sendChat(step: number, text: string, isAuto = false) {
		if (chatLoading[step]) return;
		if (!isAuto) {
			const updated = chatMessages.map((msgs, i) =>
				i === step ? [...msgs, { role: 'user' as const, text }] : msgs
			);
			chatMessages = updated;
		}
		chatLoading = chatLoading.map((v, i) => (i === step ? true : v));
		chatStreamingText = chatStreamingText.map((v, i) => (i === step ? '' : v));

		try {
			const result = await streamProxyChat({
				message: text,
				conversationId: convIds[step],
				forceNewConversation: !convIds[step],
				systemPrompt: buildSystemPrompt(step),
				onToken: async (token) => {
					chatStreamingText = chatStreamingText.map((v, i) => (i === step ? v + token : v));
					await tick();
					const el = chatEls[step];
					if (el) el.scrollTop = el.scrollHeight;
				}
			});
			if (result.conversationId && !convIds[step]) {
				convIds = convIds.map((v, i) => (i === step ? result.conversationId : v));
			}
			const finalText = chatStreamingText[step] || String(result.message ?? '');
			chatMessages = chatMessages.map((msgs, i) =>
				i === step ? [...msgs, { role: 'assistant' as const, text: finalText }] : msgs
			);
		} catch {
			chatMessages = chatMessages.map((msgs, i) =>
				i === step ? [...msgs, { role: 'assistant' as const, text: 'Beklager, noe gikk galt.' }] : msgs
			);
		} finally {
			chatLoading = chatLoading.map((v, i) => (i === step ? false : v));
			chatStreamingText = chatStreamingText.map((v, i) => (i === step ? '' : v));
		}
	}
</script>

<AppPage>
	<PageHeader title="Lønnsrapport" backHref="/economics" />

	{#if !report}
		<div class="empty-state">
			<p class="empty-icon">💳</p>
			<p class="empty-title">Ingen lønnsdata oppdaget ennå</p>
			<p class="empty-body">Koble til SpareBank 1 i innstillinger for å aktivere lønnsrapporten.</p>
		</div>
	{:else}
		<!-- Progress bar -->
		<div class="progress-wrap">
			<div class="progress-bar">
				<div class="progress-fill" style:width="{((currentStep + 1) / STEP_LABELS.length) * 100}%"></div>
			</div>
			<span class="progress-label">{currentStep + 1} / {STEP_LABELS.length}</span>
		</div>

		<!-- Step content -->
		<div class="step-container">

			<!-- ── Oversikt ─────────────────────────────────────────────────── -->
			{#if currentStep === 0}
				<h2 class="step-title">Oversikt</h2>
				<p class="step-period">{fmtDate(report.currentSalaryDate)} – i dag</p>

				<div class="salary-hero">
					<span class="salary-label">Lønn mottatt</span>
					<span class="salary-amount">kr {fmt(report.salaryAmount)}</span>
				</div>

				<div class="stat-pills">
					<div class="stat-pill">
						<span class="stat-pill-label">Totalt forbruk</span>
						<span class="stat-pill-value">kr {fmt(report.totalSpending)}</span>
					</div>
					<div class="stat-pill">
						<span class="stat-pill-label">Fast</span>
						<span class="stat-pill-value">kr {fmt(report.totalFixed)}</span>
					</div>
					<div class="stat-pill">
						<span class="stat-pill-label">Variabelt</span>
						<span class="stat-pill-value">kr {fmt(report.totalVariable)}</span>
					</div>
				</div>

				{#if report.spendingTrend !== 0}
					<div class="trend-badge" class:trend-up={report.spendingTrend > 0} class:trend-down={report.spendingTrend < 0}>
						{trendLabel(report.spendingTrend)}
					</div>
				{/if}

			<!-- ── Forbruk ──────────────────────────────────────────────────── -->
			{:else if currentStep === 1}
				<h2 class="step-title">Forbruk denne perioden</h2>
				<div class="chart-wrap">
					<SpendingChart data={spendingChartData} accountId={null} />
				</div>

			<!-- ── Sparekonto ──────────────────────────────────────────────── -->
			{:else if currentStep === 2}
				<h2 class="step-title">Sparekonto</h2>
				{#if report.savingsChanges.length === 0}
					<p class="empty-section">Ingen saldodata tilgjengelig for denne perioden.</p>
				{:else}
					<div class="savings-list">
						{#each report.savingsChanges as s (s.accountId)}
							<div class="savings-card">
								<span class="savings-name">{s.accountName}</span>
								<span class="savings-change" class:positive={s.change >= 0} class:negative={s.change < 0}>
									{s.change >= 0 ? '+' : '-'} kr {fmt(s.change)}
								</span>
								<div class="savings-detail">
									<span>Fra: kr {fmt(s.startBalance)}</span>
									<span>→</span>
									<span>kr {fmt(s.endBalance)}</span>
								</div>
							</div>
						{/each}
					</div>
				{/if}

			<!-- ── Mål ─────────────────────────────────────────────────────── -->
			{:else if currentStep === 3}
				<h2 class="step-title">Mål</h2>
				{#if report.goalProgress.length === 0}
					<p class="empty-section">Ingen aktive mål registrert. Legg til mål i chatten for å følge opp.</p>
				{:else}
					<div class="goals-list">
						{#each report.goalProgress as g (g.label)}
							{#if g.type === 'track'}
								<div class="goal-card">
									<div class="goal-header">
										<span class="goal-label">{g.label}</span>
										<span class="goal-badge" class:achieved={g.achieved} class:not-achieved={!g.achieved}>
											{g.achieved ? '✓' : '✗'}
										</span>
									</div>
									<div class="goal-progress-bar-wrap">
										<div
											class="goal-progress-bar-fill"
											class:over={g.direction === 'lower_is_better' && g.actualValue > g.targetValue}
											style:width="{Math.min(100, (g.actualValue / Math.max(g.targetValue, 1)) * 100)}%"
										></div>
									</div>
									<div class="goal-values">
										<span>kr {fmt(g.actualValue)} brukt</span>
										<span>mål: kr {fmt(g.targetValue)} {g.unit}</span>
									</div>
								</div>
							{:else}
								<div class="goal-card goal-free">
									<span class="goal-label">{g.goalTitle}</span>
									{#if g.goalDescription}
										<p class="goal-desc">{g.goalDescription}</p>
									{/if}
								</div>
							{/if}
						{/each}
					</div>
				{/if}

			<!-- ── Sammenligning ───────────────────────────────────────────── -->
			{:else if currentStep === 4}
				<h2 class="step-title">Sammenligning</h2>
				<div class="comparison-grid">
					<div class="comparison-col">
						<span class="comp-label">Denne perioden</span>
						<span class="comp-value">kr {fmt(report.totalSpending)}</span>
					</div>
					<div class="comparison-divider">vs</div>
					<div class="comparison-col">
						<span class="comp-label">Forrige periode</span>
						<span class="comp-value muted">kr {fmt(report.previousMonthSpending)}</span>
					</div>
				</div>
				{#if report.spendingTrend !== 0}
					<div class="trend-badge big" class:trend-up={report.spendingTrend > 0} class:trend-down={report.spendingTrend < 0}>
						{trendLabel(report.spendingTrend)}
					</div>
				{/if}
			{/if}

			<!-- ── Inline chat ─────────────────────────────────────────────── -->
			<button class="chat-toggle" onclick={() => toggleChat(currentStep)}>
				{chatOpen[currentStep] ? '▲ Lukk chat' : '▼ Spør om dette'}
			</button>

			{#if chatOpen[currentStep]}
				<div class="chat-area">
					<div class="chat-messages" bind:this={chatEls[currentStep]}>
						{#each chatMessages[currentStep] as msg, i (i)}
							{#if msg.role === 'user'}
								<div class="chat-bubble-user">{msg.text}</div>
							{:else}
								<TriageCard text={msg.text} />
							{/if}
						{/each}
						{#if chatLoading[currentStep]}
							{#if chatStreamingText[currentStep]}
								<TriageCard text={chatStreamingText[currentStep]} streaming={true} />
							{:else}
								<TriageCard loading={true} status="Tenker..." />
							{/if}
						{/if}
					</div>
					<ChatInput
						placeholder="Spør om dette temaet…"
						disabled={chatLoading[currentStep]}
						onsubmit={(text: string) => sendChat(currentStep, text)}
					/>
				</div>
			{/if}
		</div>

		<!-- Footer navigation -->
		<div class="footer">
			<button
				class="btn btn-ghost"
				onclick={() => { currentStep = Math.max(0, currentStep - 1); }}
				disabled={currentStep === 0}
			>← Forrige</button>
			<button
				class="btn btn-primary"
				onclick={() => { currentStep = Math.min(STEP_LABELS.length - 1, currentStep + 1); }}
				disabled={currentStep === STEP_LABELS.length - 1}
			>Neste →</button>
		</div>
	{/if}
</AppPage>

<style>
	/* Progress */
	.progress-wrap {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 0 20px;
		margin-bottom: 4px;
	}
	.progress-bar {
		flex: 1;
		height: 2px;
		background: hsl(228 20% 14%);
		border-radius: 1px;
	}
	.progress-fill {
		height: 100%;
		background: hsl(228 70% 65%);
		border-radius: 1px;
		transition: width 0.3s ease;
	}
	.progress-label {
		font-size: 0.72rem;
		color: hsl(228 15% 40%);
		font-weight: 500;
		flex-shrink: 0;
	}

	/* Step container */
	.step-container {
		padding: 16px 20px 0;
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.step-title {
		font-size: 1rem;
		font-weight: 700;
		color: hsl(228 40% 88%);
		margin: 0;
	}
	.step-period {
		font-size: 0.8rem;
		color: hsl(228 15% 50%);
		margin: -8px 0 0;
	}

	/* Oversikt */
	.salary-hero {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 16px;
		background: hsl(228 20% 11%);
		border: 1px solid hsl(228 22% 20%);
		border-radius: 14px;
	}
	.salary-label {
		font-size: 0.75rem;
		color: hsl(228 15% 50%);
		font-weight: 500;
	}
	.salary-amount {
		font-size: 1.8rem;
		font-weight: 700;
		color: hsl(142 55% 68%);
		letter-spacing: -0.02em;
	}

	.stat-pills {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.stat-pill {
		flex: 1;
		min-width: 90px;
		display: flex;
		flex-direction: column;
		gap: 2px;
		background: hsl(228 20% 11%);
		border: 1px solid hsl(228 22% 18%);
		border-radius: 10px;
		padding: 10px 12px;
	}
	.stat-pill-label {
		font-size: 0.72rem;
		color: hsl(228 15% 48%);
		font-weight: 500;
	}
	.stat-pill-value {
		font-size: 0.95rem;
		font-weight: 700;
		color: hsl(228 40% 85%);
	}

	.trend-badge {
		display: inline-flex;
		align-items: center;
		padding: 5px 12px;
		border-radius: 20px;
		font-size: 0.8rem;
		font-weight: 600;
		width: fit-content;
	}
	.trend-badge.big { font-size: 0.95rem; padding: 8px 16px; }
	.trend-up { background: hsl(0 30% 12%); color: hsl(0 65% 68%); border: 1px solid hsl(0 35% 22%); }
	.trend-down { background: hsl(142 30% 10%); color: hsl(142 55% 60%); border: 1px solid hsl(142 35% 18%); }

	/* Chart */
	.chart-wrap {
		background: hsl(228 20% 11%);
		border: 1px solid hsl(228 22% 18%);
		border-radius: 14px;
		padding: 4px;
		overflow: hidden;
	}

	/* Sparekonto */
	.savings-list { display: flex; flex-direction: column; gap: 10px; }
	.savings-card {
		background: hsl(228 20% 11%);
		border: 1px solid hsl(228 22% 18%);
		border-radius: 12px;
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.savings-name { font-size: 0.82rem; color: hsl(228 15% 55%); font-weight: 500; }
	.savings-change { font-size: 1.4rem; font-weight: 700; letter-spacing: -0.02em; }
	.savings-change.positive { color: hsl(142 55% 65%); }
	.savings-change.negative { color: hsl(0 60% 65%); }
	.savings-detail {
		display: flex;
		gap: 8px;
		font-size: 0.78rem;
		color: hsl(228 15% 45%);
	}

	/* Mål */
	.goals-list { display: flex; flex-direction: column; gap: 10px; }
	.goal-card {
		background: hsl(228 20% 11%);
		border: 1px solid hsl(228 22% 18%);
		border-radius: 12px;
		padding: 12px 14px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.goal-free { border-color: hsl(228 22% 22%); }
	.goal-header { display: flex; align-items: center; justify-content: space-between; }
	.goal-label { font-size: 0.9rem; font-weight: 600; color: hsl(228 40% 82%); }
	.goal-desc { font-size: 0.8rem; color: hsl(228 15% 48%); margin: 0; line-height: 1.4; }
	.goal-badge {
		font-size: 0.75rem;
		font-weight: 700;
		padding: 2px 8px;
		border-radius: 6px;
	}
	.goal-badge.achieved { background: hsl(142 30% 12%); color: hsl(142 55% 65%); border: 1px solid hsl(142 35% 20%); }
	.goal-badge.not-achieved { background: hsl(0 30% 12%); color: hsl(0 60% 65%); border: 1px solid hsl(0 35% 22%); }
	.goal-progress-bar-wrap {
		height: 4px;
		background: hsl(228 20% 16%);
		border-radius: 2px;
		overflow: hidden;
	}
	.goal-progress-bar-fill {
		height: 100%;
		background: hsl(228 70% 65%);
		border-radius: 2px;
		transition: width 0.3s ease;
	}
	.goal-progress-bar-fill.over { background: hsl(0 60% 60%); }
	.goal-values {
		display: flex;
		justify-content: space-between;
		font-size: 0.75rem;
		color: hsl(228 15% 45%);
	}

	/* Sammenligning */
	.comparison-grid {
		display: flex;
		align-items: center;
		gap: 16px;
		background: hsl(228 20% 11%);
		border: 1px solid hsl(228 22% 18%);
		border-radius: 14px;
		padding: 20px;
	}
	.comparison-col {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.comp-label { font-size: 0.75rem; color: hsl(228 15% 48%); font-weight: 500; }
	.comp-value { font-size: 1.3rem; font-weight: 700; color: hsl(228 40% 85%); }
	.comp-value.muted { color: hsl(228 15% 52%); }
	.comparison-divider { font-size: 0.82rem; color: hsl(228 15% 36%); font-weight: 600; }

	/* Chat toggle */
	.chat-toggle {
		align-self: flex-start;
		background: transparent;
		border: 1px solid hsl(228 22% 22%);
		border-radius: 8px;
		color: hsl(228 30% 60%);
		font-size: 0.8rem;
		padding: 7px 14px;
		cursor: pointer;
		font-family: inherit;
		transition: border-color 0.12s, color 0.12s;
	}
	.chat-toggle:hover { border-color: hsl(228 30% 35%); color: hsl(228 40% 78%); }

	/* Chat area */
	.chat-area {
		display: flex;
		flex-direction: column;
		gap: 8px;
		background: hsl(228 20% 9%);
		border: 1px solid hsl(228 22% 18%);
		border-radius: 12px;
		padding: 12px;
	}
	.chat-messages {
		display: flex;
		flex-direction: column;
		gap: 8px;
		max-height: 280px;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
	}
	.chat-bubble-user {
		background: hsl(228 35% 12%);
		border: 1px solid hsl(228 40% 22%);
		color: hsl(228 40% 80%);
		padding: 8px 12px;
		border-radius: 10px;
		font-size: 0.87rem;
		line-height: 1.45;
		align-self: flex-end;
		max-width: 88%;
	}

	/* Footer */
	.footer {
		display: flex;
		gap: 10px;
		padding: 14px 20px 32px;
		border-top: 1px solid hsl(228 20% 14%);
		margin-top: auto;
	}
	.btn {
		flex: 1;
		padding: 12px 18px;
		border-radius: 10px;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.12s;
		font-family: inherit;
	}
	.btn:disabled { opacity: 0.35; cursor: default; }
	.btn-primary { background: hsl(228 70% 62%); border: none; color: #fff; }
	.btn-primary:hover:not(:disabled) { background: hsl(228 70% 55%); }
	.btn-ghost { background: transparent; border: 1px solid hsl(228 20% 22%); color: hsl(228 15% 50%); }
	.btn-ghost:hover:not(:disabled) { border-color: hsl(228 20% 35%); color: hsl(228 15% 70%); }

	/* Empty states */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 60px 30px;
		text-align: center;
	}
	.empty-icon { font-size: 2.5rem; margin: 0; }
	.empty-title { font-size: 1rem; font-weight: 600; color: hsl(228 30% 70%); margin: 0; }
	.empty-body { font-size: 0.85rem; color: hsl(228 15% 45%); margin: 0; line-height: 1.5; }
	.empty-section { font-size: 0.87rem; color: hsl(228 15% 45%); margin: 0; }
</style>
