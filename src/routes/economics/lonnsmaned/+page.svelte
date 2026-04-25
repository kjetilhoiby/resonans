<script lang="ts">
	import { AppPage, PageHeader } from '$lib/components/ui';
	import TriageCard from '$lib/components/composed/TriageCard.svelte';
	import ChatInput from '$lib/components/ui/ChatInput.svelte';
	import { streamProxyChat } from '$lib/client/proxy-chat-stream';
	import { tick } from 'svelte';
	import type { SalaryMonthReport, SalaryInsight } from '$lib/types/salary-report';

	interface RichMsg {
		role: 'user' | 'assistant';
		text: string;
		streaming?: boolean;
	}

	let { data }: { data: { report: SalaryMonthReport | null; accounts: unknown[] } } = $props();

	const report = $derived(data.report);
	const insights = $derived(data.report?.insights ?? []);

	// ── Per-step state ────────────────────────────────────────────────────────
	let stepIndex = $state(0);
	let stepMsgs = $state<RichMsg[][]>([]);
	let stepConvIds = $state<(string | null)[]>([]);
	let stepLoading = $state<boolean[]>([]);
	let stepStreaming = $state<string[]>([]);
	let msgContainers = $state<(HTMLDivElement | null)[]>([]);
	let stepStarted = $state<boolean[]>([]);   // true once autoSend ran for that step

	// Reset arrays whenever insights change
	$effect(() => {
		const n = insights.length;
		stepMsgs = Array.from({ length: n }, () => []);
		stepConvIds = Array.from({ length: n }, () => null);
		stepLoading = Array.from({ length: n }, () => false);
		stepStreaming = Array.from({ length: n }, () => '');
		msgContainers = Array.from({ length: n }, () => null);
		stepStarted = Array.from({ length: n }, () => false);
	});

	// Auto-send when we land on a step
	$effect(() => {
		const i = stepIndex;
		const insight = insights[i];
		if (!insight || stepStarted[i]) return;
		stepStarted = stepStarted.map((v, idx) => (idx === i ? true : v));
		// Use untrack-style: run after the microtask so arrays are initialised
		setTimeout(() => void seedChat(i, insight), 0);
	});

	// ── Helpers ───────────────────────────────────────────────────────────────
	async function scrollBottom(i: number) {
		await tick();
		const el = msgContainers[i];
		if (el) el.scrollTop = el.scrollHeight;
	}

	async function seedChat(i: number, insight: SalaryInsight) {
		if (stepLoading[i]) return;
		stepLoading = stepLoading.map((v, idx) => (idx === i ? true : v));
		stepStreaming = stepStreaming.map((v, idx) => (idx === i ? '' : v));
		await scrollBottom(i);

		try {
			const result = await streamProxyChat({
				message: insight.seedMessage,
				conversationId: stepConvIds[i],
				forceNewConversation: true,
				systemPrompt: insight.systemPrompt,
				onToken: async (token) => {
					stepStreaming = stepStreaming.map((v, idx) => (idx === i ? v + token : v));
					await scrollBottom(i);
				}
			});
			if (result.conversationId) {
				stepConvIds = stepConvIds.map((v, idx) => (idx === i ? result.conversationId : v));
			}
			const text = stepStreaming[i] || String(result.message ?? '');
			stepMsgs = stepMsgs.map((msgs, idx) =>
				idx === i ? [...msgs, { role: 'assistant', text }] : msgs
			);
		} catch {
			stepMsgs = stepMsgs.map((msgs, idx) =>
				idx === i ? [...msgs, { role: 'assistant', text: 'Beklager, noe gikk galt.' }] : msgs
			);
		} finally {
			stepLoading = stepLoading.map((v, idx) => (idx === i ? false : v));
			stepStreaming = stepStreaming.map((v, idx) => (idx === i ? '' : v));
		}
	}

	async function sendUserMsg(i: number, text: string) {
		if (stepLoading[i] || !text.trim()) return;
		stepMsgs = stepMsgs.map((msgs, idx) =>
			idx === i ? [...msgs, { role: 'user', text }] : msgs
		);
		stepLoading = stepLoading.map((v, idx) => (idx === i ? true : v));
		stepStreaming = stepStreaming.map((v, idx) => (idx === i ? '' : v));
		await scrollBottom(i);

		try {
			const insight = insights[i];
			const result = await streamProxyChat({
				message: text,
				conversationId: stepConvIds[i],
				systemPrompt: insight?.systemPrompt,
				onToken: async (token) => {
					stepStreaming = stepStreaming.map((v, idx) => (idx === i ? v + token : v));
					await scrollBottom(i);
				}
			});
			if (result.conversationId && !stepConvIds[i]) {
				stepConvIds = stepConvIds.map((v, idx) => (idx === i ? result.conversationId : v));
			}
			const text2 = stepStreaming[i] || String(result.message ?? '');
			stepMsgs = stepMsgs.map((msgs, idx) =>
				idx === i ? [...msgs, { role: 'assistant', text: text2 }] : msgs
			);
		} catch {
			stepMsgs = stepMsgs.map((msgs, idx) =>
				idx === i ? [...msgs, { role: 'assistant', text: 'Beklager, noe gikk galt.' }] : msgs
			);
		} finally {
			stepLoading = stepLoading.map((v, idx) => (idx === i ? false : v));
			stepStreaming = stepStreaming.map((v, idx) => (idx === i ? '' : v));
		}
	}

	function goNext() {
		if (stepIndex < insights.length - 1) {
			stepIndex++;
		}
	}

	function goPrev() {
		if (stepIndex > 0) stepIndex--;
	}

	async function complete() {
		if (!report) return;
		// Save reflection as a memory
		const reflection = insights.map((ins, i) => ({
			insightId: ins.id,
			title: ins.title,
			messages: stepMsgs[i] ?? []
		}));
		try {
			await fetch('/api/economics/salary-report/reflect', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					salaryMonth: report.currentSalaryDate.slice(0, 7),
					reflection
				})
			});
		} catch {
			// Non-fatal — navigate anyway
		}
		window.location.href = '/economics';
	}

	const currentInsight = $derived(insights[stepIndex]);
	const isLast = $derived(stepIndex === insights.length - 1);
	const isFirst = $derived(stepIndex === 0);
	const progress = $derived(insights.length > 0 ? (stepIndex + 1) / insights.length : 0);
</script>

<AppPage>
	<PageHeader title="Lønnsrapport" backHref="/economics" />

	{#if !report}
		<div class="empty-state">
			<span class="empty-icon">💳</span>
			<p class="empty-title">Ingen lønnsdata oppdaget ennå</p>
			<p class="empty-body">Koble til SpareBank 1 i innstillinger for å aktivere lønnsrapporten.</p>
		</div>
	{:else if insights.length === 0}
		<div class="empty-state">
			<span class="empty-icon">📊</span>
			<p class="empty-title">Ingen innsikter tilgjengelig ennå</p>
			<p class="empty-body">Synkroniser bankkontoen og prøv igjen.</p>
		</div>
	{:else}
		<!-- Progress -->
		<div class="progress-row">
			<div class="progress-bar">
				<div class="progress-fill" style:width="{progress * 100}%"></div>
			</div>
			<span class="progress-label">{stepIndex + 1} / {insights.length}</span>
		</div>

		<!-- Step -->
		{#if currentInsight}
			<div class="step">
				<!-- Header -->
				<div class="step-header">
					<span class="step-emoji">{currentInsight.emoji}</span>
					<div>
						<h2 class="step-title">{currentInsight.title}</h2>
						<p class="step-summary">{currentInsight.summary}</p>
					</div>
				</div>

				<!-- Chat messages -->
				<div class="chat-scroll" bind:this={msgContainers[stepIndex]}>
					{#each stepMsgs[stepIndex] ?? [] as msg, i (i)}
						{#if msg.role === 'user'}
							<div class="bubble-user">{msg.text}</div>
						{:else}
							<TriageCard text={msg.text} />
						{/if}
					{/each}
					{#if stepLoading[stepIndex]}
						{#if stepStreaming[stepIndex]}
							<TriageCard text={stepStreaming[stepIndex]} streaming={true} />
						{:else}
							<TriageCard loading={true} status="Tenker..." />
						{/if}
					{/if}
				</div>

				<!-- Chat input -->
				<div class="input-wrap">
					<ChatInput
						placeholder={currentInsight.isFreeReflection ? 'Skriv dine refleksjoner…' : 'Svar, juster mål, eller hopp videre…'}
						disabled={stepLoading[stepIndex]}
						onsubmit={(text: string) => sendUserMsg(stepIndex, text)}
					/>
				</div>
			</div>
		{/if}

		<!-- Footer -->
		<div class="footer">
			{#if !isFirst}
				<button class="btn btn-ghost" onclick={goPrev}>← Tilbake</button>
			{/if}
			{#if isLast}
				<button class="btn btn-primary" onclick={complete}>Fullfør og lagre</button>
			{:else}
				<button class="btn btn-next" onclick={goNext}>Neste →</button>
			{/if}
		</div>
	{/if}
</AppPage>

<style>
	/* Progress */
	.progress-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 4px 20px 0;
	}
	.progress-bar {
		flex: 1;
		height: 2px;
		background: hsl(228 20% 14%);
		border-radius: 1px;
		overflow: hidden;
	}
	.progress-fill {
		height: 100%;
		background: hsl(228 70% 65%);
		transition: width 0.35s ease;
	}
	.progress-label {
		font-size: 0.72rem;
		color: hsl(228 15% 38%);
		flex-shrink: 0;
	}

	/* Step layout — fills remaining height */
	.step {
		display: flex;
		flex-direction: column;
		flex: 1;
		padding: 16px 20px 0;
		gap: 14px;
		min-height: 0;
	}

	.step-header {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		flex-shrink: 0;
	}
	.step-emoji {
		font-size: 1.8rem;
		line-height: 1;
		flex-shrink: 0;
		margin-top: 2px;
	}
	.step-title {
		font-size: 1.05rem;
		font-weight: 700;
		color: hsl(228 40% 90%);
		margin: 0 0 3px;
		line-height: 1.3;
	}
	.step-summary {
		font-size: 0.82rem;
		color: hsl(228 20% 52%);
		margin: 0;
	}

	/* Chat */
	.chat-scroll {
		flex: 1;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding-bottom: 4px;
		min-height: 120px;
	}
	.bubble-user {
		background: hsl(228 35% 12%);
		border: 1px solid hsl(228 40% 22%);
		color: hsl(228 40% 82%);
		padding: 9px 13px;
		border-radius: 12px;
		font-size: 0.88rem;
		line-height: 1.45;
		align-self: flex-end;
		max-width: 90%;
	}

	.input-wrap {
		flex-shrink: 0;
	}

	/* Footer */
	.footer {
		display: flex;
		gap: 10px;
		padding: 12px 20px 32px;
		border-top: 1px solid hsl(228 20% 13%);
		flex-shrink: 0;
	}
	.btn {
		flex: 1;
		padding: 13px 18px;
		border-radius: 12px;
		font-size: 0.92rem;
		font-weight: 600;
		cursor: pointer;
		font-family: inherit;
		transition: all 0.12s;
	}
	.btn:disabled { opacity: 0.35; cursor: default; }
	.btn-primary {
		background: hsl(228 70% 62%);
		border: none;
		color: #fff;
	}
	.btn-primary:hover:not(:disabled) { background: hsl(228 70% 55%); }
	.btn-next {
		background: hsl(228 20% 14%);
		border: 1px solid hsl(228 22% 24%);
		color: hsl(228 30% 72%);
	}
	.btn-next:hover:not(:disabled) { background: hsl(228 20% 17%); border-color: hsl(228 25% 32%); }
	.btn-ghost {
		flex: 0 0 auto;
		padding: 13px 16px;
		background: transparent;
		border: 1px solid hsl(228 20% 20%);
		color: hsl(228 15% 46%);
	}
	.btn-ghost:hover:not(:disabled) { border-color: hsl(228 20% 32%); color: hsl(228 15% 66%); }

	/* Empty */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 60px 30px;
		text-align: center;
		flex: 1;
	}
	.empty-icon { font-size: 2.4rem; }
	.empty-title { font-size: 1rem; font-weight: 600; color: hsl(228 30% 68%); margin: 0; }
	.empty-body { font-size: 0.84rem; color: hsl(228 15% 44%); margin: 0; line-height: 1.5; }
</style>
