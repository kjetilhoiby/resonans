<script lang="ts">
	import type { PageData } from './$types';
	import { AppPage } from '$lib/components/ui';
	import GpxMap from '$lib/components/charts/GpxMap.svelte';
	import WorkoutCharts from '$lib/components/charts/WorkoutCharts.svelte';
	import ChatInput from '$lib/components/ui/ChatInput.svelte';
	import TriageCard from '$lib/components/composed/TriageCard.svelte';
	import { tick } from 'svelte';
	import { streamProxyChat } from '$lib/client/proxy-chat-stream';

	let { data }: { data: PageData } = $props();
	const { workout, trackPoints, splits, crossSourceHr, assessment, healthThemeId } = data;
	const healthGoals: Array<{ title: string; description: string | null }> = (data as any).healthGoals ?? [];

	type Tab = 'detaljer' | 'kart' | 'graf';
	let tab = $state<Tab>('detaljer');

	// Chat
	let conversationId = $state<string | null>(null);
	let isFirstMessage = $state(true);
	let chatMessages = $state<Array<{ role: 'user' | 'assistant'; text: string }>>([]);
	let chatLoading = $state(false);
	let streamingText = $state('');
	let streamingStatus = $state('');
	let messagesEl = $state<HTMLElement | null>(null);

	// Chat context — enriched with splits and cross-source HR
	const workoutContextNote = $derived.by(() => {
		const lines: string[] = [
			`Treningsøkt: ${workout.title}`,
			`Dato: ${new Intl.DateTimeFormat('nb-NO', { dateStyle: 'full', timeStyle: 'short' }).format(new Date(workout.timestamp))}`,
		];
		if (workout.distanceKm != null) lines.push(`Distanse: ${workout.distanceKm.toFixed(2)} km`);
		if (workout.durationSeconds != null) lines.push(`Varighet: ${Math.round(workout.durationSeconds / 60)} min`);
		if (workout.paceSecondsPerKm != null) {
			const m = Math.floor(workout.paceSecondsPerKm / 60);
			const s = String(Math.round(workout.paceSecondsPerKm % 60)).padStart(2, '0');
			lines.push(`Tempo: ${m}:${s} /km`);
		}
		if (workout.avgHeartRate != null) {
			lines.push(`Snitt puls: ${Math.round(workout.avgHeartRate)} bpm`);
			if (workout.maxHeartRate != null) lines.push(`Maks puls: ${Math.round(workout.maxHeartRate)} bpm`);
		} else if (crossSourceHr?.avgHr != null) {
			lines.push(`Puls (fra ${crossSourceHr.sourceName}): snitt ${crossSourceHr.avgHr} bpm${crossSourceHr.maxHr ? `, maks ${crossSourceHr.maxHr}` : ''}`);
			lines.push(`(GPS-filen mangler pulsmåling – pulsdata lånt fra ${crossSourceHr.sourceName})`);
		}
		if (workout.elevationMeters != null) lines.push(`Høydemeter: ${Math.round(workout.elevationMeters)} m`);
		if (splits && splits.length > 0) {
			lines.push('\nKilometer-splits:');
			for (const s of splits) {
				const pace = s.paceSecPerKm != null
					? `${Math.floor(s.paceSecPerKm / 60)}:${String(Math.round(s.paceSecPerKm % 60)).padStart(2, '0')} /km`
					: '–';
				const hr = s.avgHr != null ? ` @ ${s.avgHr} bpm` : '';
				const ele = (s.eleGain > 2 || s.eleLoss > 2) ? ` (${s.eleGain > 2 ? `+${s.eleGain}m` : ''}${s.eleLoss > 2 ? `/-${s.eleLoss}m` : ''})` : '';
				lines.push(`  km ${s.km}: ${pace}${hr}${ele}`);
			}
		}
		if (assessment) lines.push(`\nVurdering: ${assessment}`);
		if (healthGoals.length > 0) {
			lines.push('\nAktive helsemål:');
			for (const g of healthGoals) {
				lines.push(`- ${g.title}${g.description ? `: ${g.description}` : ''}`);
			}
		}
		return lines.join('\n');
	});

	async function scrollToBottom() {
		await tick();
		if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
	}

	async function sendMessage(text: string) {
		chatMessages = [...chatMessages, { role: 'user', text }];
		chatLoading = true;
		streamingText = '';
		streamingStatus = 'Starter...';
		await scrollToBottom();

		// Inject workout + goals context as a structured attachment on the first message.
		// It gets persisted in conversation history so all follow-up messages have context.
		const attachment = isFirstMessage
			? { url: 'resonans://workout-context', kind: 'other' as const, contentText: workoutContextNote, note: 'Treningsøkt-kontekst' }
			: undefined;
		isFirstMessage = false;

		try {
			const result = await streamProxyChat({
				message: text,
				conversationId,
				attachment,
				onStatus: (s) => { streamingStatus = s; },
				onToken: (t) => { streamingStatus = ''; streamingText += t; scrollToBottom(); }
			});
			conversationId = result.conversationId ?? result.metadata?.conversationId ?? conversationId;
			chatMessages = [
				...chatMessages,
				{ role: 'assistant', text: result.message ?? result.fullMessage ?? streamingText }
			];
			streamingText = '';
		} catch {
			chatMessages = [...chatMessages, { role: 'assistant', text: 'Noe gikk galt.' }];
		} finally {
			chatLoading = false;
			await scrollToBottom();
		}
	}

	// Formatters
	function formatDuration(seconds: number | null) {
		if (!seconds) return '–';
		const h = Math.floor(seconds / 3600);
		const m = Math.floor((seconds % 3600) / 60);
		if (h > 0) return `${h}t ${m}m`;
		return `${m}m`;
	}

	function formatPace(paceSecondsPerKm: number | null) {
		if (!paceSecondsPerKm) return '–';
		const m = Math.floor(paceSecondsPerKm / 60);
		const s = String(Math.round(paceSecondsPerKm % 60)).padStart(2, '0');
		return `${m}:${s} /km`;
	}

	function formatDate(iso: string) {
		return new Intl.DateTimeFormat('nb-NO', {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		}).format(new Date(iso));
	}

</script>

<svelte:head>
	<title>{workout.title} – Resonans</title>
</svelte:head>

<AppPage width="full" padding="none" gap="sm" surface="default">
	<div class="backdrop" role="button" tabindex="-1" aria-label="Lukk" onclick={() => history.back()} onkeydown={(e) => e.key === 'Escape' && history.back()}></div>

	<div class="sheet" role="dialog" aria-modal="true" aria-label={workout.title}>
	<div class="handle"></div>

	<header class="sheet-header">
		<button class="back-btn" onclick={() => history.back()} aria-label="Tilbake">
			<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
				<path d="M12 4l-6 6 6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
			</svg>
		</button>
		<div class="header-text">
			<h1>{workout.title}</h1>
			<time>{formatDate(workout.timestamp)}</time>
		</div>
	</header>

	<div class="tabs" role="tablist">
		<button role="tab" aria-selected={tab === 'detaljer'} class:active={tab === 'detaljer'} onclick={() => (tab = 'detaljer')}>Detaljer</button>
		<button role="tab" aria-selected={tab === 'kart'} class:active={tab === 'kart'} onclick={() => (tab = 'kart')}>Kart</button>
		<button role="tab" aria-selected={tab === 'graf'} class:active={tab === 'graf'} onclick={() => (tab = 'graf')}>Graf</button>
	</div>

	<div class="tab-content">
		{#if tab === 'detaljer'}
			<div class="stats">
				{#if workout.distanceKm != null}
					<div class="stat"><span class="label">Distanse</span><span class="value">{workout.distanceKm.toFixed(2)} km</span></div>
				{/if}
				{#if workout.durationSeconds != null}
					<div class="stat"><span class="label">Varighet</span><span class="value">{formatDuration(workout.durationSeconds)}</span></div>
				{/if}
				{#if workout.paceSecondsPerKm != null}
					<div class="stat"><span class="label">Tempo</span><span class="value">{formatPace(workout.paceSecondsPerKm)}</span></div>
				{/if}
				{#if workout.avgHeartRate != null}
					<div class="stat"><span class="label">Snitt puls</span><span class="value">{Math.round(workout.avgHeartRate)} bpm</span></div>
				{/if}
				{#if workout.maxHeartRate != null}
					<div class="stat"><span class="label">Maks puls</span><span class="value">{Math.round(workout.maxHeartRate)} bpm</span></div>
				{/if}
				{#if workout.elevationMeters != null}
					<div class="stat"><span class="label">Høydemeter</span><span class="value">{Math.round(workout.elevationMeters)} m</span></div>
				{/if}
			</div>
			{#if assessment}
				<section class="assessment">
					<p class="assessment-label">Vurdering</p>
					<p>{assessment}</p>
				</section>
			{/if}

		{:else if tab === 'kart'}
			{#if trackPoints.length >= 2}
				<div class="map-wrap">
					<GpxMap points={trackPoints} height={340} />
				</div>
			{:else}
				<p class="no-data">Ingen GPS-data for denne økten.</p>
			{/if}

		{:else if tab === 'graf'}
			{#if trackPoints.length >= 2}
				<WorkoutCharts
					{trackPoints}
					fallbackAvgHr={crossSourceHr?.avgHr ?? null}
					fallbackMaxHr={crossSourceHr?.maxHr ?? null}
					fallbackMinHr={crossSourceHr?.minHr ?? null}
					fallbackSource={crossSourceHr?.sourceName ?? null}
				/>
			{:else}
				<p class="no-data">Ingen graf-data for denne økten.</p>
			{/if}
		{/if}
	</div>

	<div class="chat-section">
		<p class="chat-label">Chat</p>
		<div class="chat-messages" bind:this={messagesEl} aria-live="polite">
			{#if chatMessages.length === 0 && !chatLoading}
				<p class="chat-empty">Spør om denne økten…</p>
			{/if}
			{#each chatMessages as msg}
				{#if msg.role === 'user'}
					<div class="bubble-user">{msg.text}</div>
				{:else}
					<TriageCard text={msg.text} />
				{/if}
			{/each}
			{#if chatLoading}
				{#if streamingText}
					<TriageCard text={streamingText} streaming={true} />
				{:else}
					<TriageCard loading={true} status={streamingStatus} />
				{/if}
			{/if}
		</div>
		<ChatInput
			placeholder="Spør om denne økten…"
			disabled={chatLoading}
			onsubmit={sendMessage}
		/>
	</div>
</div>
</AppPage>

<style>
	:global(.backdrop) {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		z-index: 40;
		cursor: pointer;
	}

	:global(.sheet) {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		top: 5vh;
		z-index: 50;
		background: #111318;
		border-radius: 20px 20px 0 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		animation: slide-up 0.28s cubic-bezier(0.32, 0.72, 0, 1);
	}

	@keyframes slide-up {
		from { transform: translateY(100%); }
		to   { transform: translateY(0); }
	}

	:global(.handle) {
		width: 36px;
		height: 4px;
		background: #333;
		border-radius: 2px;
		margin: 10px auto 0;
		flex-shrink: 0;
	}

	/* Header */
	:global(.sheet-header) {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem 0.5rem;
		flex-shrink: 0;
	}

	:global(.back-btn) {
		background: none;
		border: none;
		color: #888;
		cursor: pointer;
		padding: 0.25rem;
		flex-shrink: 0;
		line-height: 0;
	}

	:global(.header-text) h1 {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 600;
		line-height: 1.2;
		color: #eee;
	}

	:global(.header-text) time {
		font-size: 0.8rem;
		color: #888;
		text-transform: capitalize;
	}

	/* Tabs */
	.tabs {
		display: flex;
		gap: 0;
		padding: 0 1rem;
		border-bottom: 1px solid #1e2632;
		flex-shrink: 0;
	}

	.tabs button {
		background: none;
		border: none;
		color: #666;
		font-size: 0.85rem;
		font-weight: 500;
		padding: 0.6rem 1rem;
		cursor: pointer;
		position: relative;
		transition: color 0.15s;
	}

	.tabs button.active {
		color: #e8e8e8;
	}

	.tabs button.active::after {
		content: '';
		position: absolute;
		bottom: -1px;
		left: 0;
		right: 0;
		height: 2px;
		background: #7c8ef5;
		border-radius: 1px 1px 0 0;
	}

	/* Tab content area — scrollable */
	.tab-content {
		flex: 1;
		overflow-y: auto;
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		min-height: 0;
	}

	/* Stats */
	.stats {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
		gap: 0.6rem;
	}

	.stat {
		background: #1a1f2e;
		border-radius: 10px;
		padding: 0.65rem 0.85rem;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.label {
		font-size: 0.7rem;
		color: #888;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.value {
		font-size: 1.1rem;
		font-weight: 600;
		color: #eee;
	}

	.assessment {
		background: #1a1f2e;
		border-radius: 10px;
		padding: 1rem;
	}

	.assessment-label {
		font-size: 0.7rem;
		color: #888;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: 0 0 0.5rem;
	}

	.assessment p:last-child {
		margin: 0;
		line-height: 1.6;
		font-size: 0.9rem;
		color: #ccc;
	}

	.map-wrap {
		border-radius: 12px;
		overflow: hidden;
	}

	.no-data {
		color: #666;
		font-size: 0.85rem;
		text-align: center;
		padding: 2rem 0;
		margin: 0;
	}

	/* Chat */
	.chat-section {
		border-top: 1px solid #1e2632;
		display: flex;
		flex-direction: column;
		max-height: 45vh;
		flex-shrink: 0;
	}

	.chat-label {
		font-size: 0.7rem;
		color: #444;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 0.6rem 1rem 0;
		margin: 0;
		flex-shrink: 0;
	}

	.chat-messages {
		flex: 1;
		overflow-y: auto;
		padding: 0.5rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-height: 0;
	}

	.chat-empty {
		color: #444;
		font-size: 0.85rem;
		margin: 0.5rem 0;
	}

	.bubble-user {
		align-self: flex-end;
		background: #1e2a40;
		color: #d0d8ff;
		font-size: 0.88rem;
		padding: 0.5rem 0.85rem;
		border-radius: 14px 14px 2px 14px;
		max-width: 80%;
		line-height: 1.4;
	}
</style>

