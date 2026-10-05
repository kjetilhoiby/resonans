<!--
  CaptureSheet — Én inngang: tekst, bilder og filer i ett ark, og coachen sorterer.
  Se docs/changelog/2026-10-05-en-inngang.md og $lib/domain/capture.ts.

  KOMMER I TILLEGG til kamera-, lyd- og filflytene på hjemskjermen. De ber om
  typen først og tar ett vedlegg; her kommer innholdet først, flere bilder kan
  høre til samme ting, og et skjermbilde kan limes rett inn.

  Svaret vises i arket gjennom de delte chat-lagene (ChatState + ChatThread),
  ikke en egen løkke. Sendingen går uten samtale-id, så serverens tema-ruting
  avgjør hvor fangsten havner — samme vei som hjemskjermens første melding.

  Props:
    onclose      lukker arket
    demoItems    bare for /design: forhåndsutfylte vedlegg uten nettverk
-->
<script lang="ts">
	import BottomSheet from '../ui/BottomSheet.svelte';
	import ChatThread from '../ui/ChatThread.svelte';
	import ChatInput from '../ui/ChatInput.svelte';
	import Icon from '../ui/Icon.svelte';
	import { ChatState } from '$lib/client/chat-state.svelte';
	import { requestAttachmentUpload } from '../domain/home/home-chat';
	import {
		CAPTURE_ACCEPT,
		MAX_CAPTURE_ITEMS,
		captureDisplayText,
		captureItemKind,
		fitCaptureItems,
		type CaptureItemKind
	} from '$lib/domain/capture';

	interface CaptureItem {
		id: string;
		kind: CaptureItemKind;
		name: string;
		previewUrl: string | null;
		file: File | null;
	}

	interface Props {
		onclose: () => void;
		demoItems?: { kind: CaptureItemKind; name: string; previewUrl: string | null }[];
	}

	let { onclose, demoItems = [] }: Props = $props();

	let items = $state<CaptureItem[]>(
		demoItems.map((d) => ({ ...d, id: crypto.randomUUID(), file: null }))
	);
	let text = $state('');
	let phase = $state<'compose' | 'uploading' | 'thread'>('compose');
	let uploaded = $state(0);
	let notice = $state('');
	let libraryInput = $state<HTMLInputElement | null>(null);
	let cameraInput = $state<HTMLInputElement | null>(null);

	const chat = new ChatState({});
	const canSend = $derived(phase === 'compose' && (text.trim().length > 0 || items.length > 0));

	function addFiles(files: File[]) {
		if (files.length === 0) return;
		const { accepted, rejected } = fitCaptureItems(items.length, files);
		items = [
			...items,
			...accepted.map((file) => {
				const kind = captureItemKind(file);
				return {
					id: crypto.randomUUID(),
					kind,
					name: file.name || (kind === 'image' ? 'Bilde' : 'Fil'),
					previewUrl: kind === 'image' ? URL.createObjectURL(file) : null,
					file
				};
			})
		];
		notice = rejected > 0
			? `Plass til ${MAX_CAPTURE_ITEMS} om gangen — ${rejected} ble ikke lagt til.`
			: '';
	}

	function removeItem(id: string) {
		const item = items.find((i) => i.id === id);
		if (item?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl);
		items = items.filter((i) => i.id !== id);
		notice = '';
	}

	function onPicked(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const files = input.files ? Array.from(input.files) : [];
		input.value = '';
		addFiles(files);
	}

	/** Et skjermbilde limt inn skal bli et vedlegg, ikke en tom linje i teksten. */
	function onPaste(e: ClipboardEvent) {
		if (phase !== 'compose') return;
		const files = Array.from(e.clipboardData?.files ?? []);
		if (files.length === 0) return;
		e.preventDefault();
		addFiles(files);
	}

	async function send() {
		if (!canSend) return;
		phase = 'uploading';
		uploaded = 0;
		notice = '';
		try {
			const refs = [];
			for (const item of items) {
				if (!item.file) continue;
				refs.push(await requestAttachmentUpload(item.file, '', item.kind === 'image' ? 'camera' : 'file'));
				uploaded += 1;
			}
			const firstImage = refs.find((r) => r.kind === 'image')?.url;
			const displayText = captureDisplayText(text, items.map((i) => i.kind));
			phase = 'thread';
			await chat.send(text.trim(), firstImage, refs[0], {
				displayText,
				attachments: refs,
				capture: true
			});
		} catch (err) {
			phase = 'compose';
			notice = `Fikk ikke lastet opp: ${err instanceof Error ? err.message : 'ukjent feil'}. Prøv igjen.`;
		}
	}

	function startOver() {
		for (const item of items) if (item.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl);
		items = [];
		text = '';
		notice = '';
		chat.reset();
		chat.conversationId = null;
		phase = 'compose';
	}

	function close() {
		for (const item of items) if (item.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl);
		onclose();
	}
</script>

<svelte:window onpaste={onPaste} />

<BottomSheet onclose={close} ariaLabel="Legg inn">
	<div class="cs-root">
	<header class="cs-head">
		<h2 class="cs-title">Legg inn</h2>
		<button class="cs-close" type="button" aria-label="Lukk" data-track="inngang:lukk" onclick={close}>
			<Icon name="close" size={18} />
		</button>
	</header>

	{#if phase === 'thread'}
		<ChatThread
			class="cs-thread"
			messages={chat.messages}
			streamingText={chat.streamingText}
			streamingSteps={chat.streamingSteps}
			loading={chat.loading}
			stopped={chat.stopped}
			stoppedText={chat.stoppedText}
			error={chat.error}
			lastUserMsgId={chat.lastUserMsgId}
			onRetry={() => chat.retry()}
		/>
		<div class="cs-foot">
			<ChatInput
				placeholder="Svar coachen…"
				streaming={chat.loading}
				onStop={() => chat.stop()}
				onsubmit={(message) => chat.send(message)}
			/>
			<div class="cs-links">
				<button class="cs-link" type="button" data-track="inngang:ny" onclick={startOver}>Legg inn noe annet</button>
				{#if chat.conversationId && !chat.loading}
					<a class="cs-link" href={`/samtaler?conversation=${chat.conversationId}`} data-track="inngang:apne-samtale">Åpne samtalen</a>
				{/if}
			</div>
		</div>
	{:else}
		<div class="cs-body">
			<textarea
				class="cs-text"
				bind:value={text}
				rows="3"
				placeholder="Skriv, lim inn et skjermbilde eller legg ved — coachen finner ut hva det er."
				aria-label="Hva vil du legge inn?"
				data-track="inngang:tekst"
				disabled={phase === 'uploading'}
			></textarea>

			{#if items.length > 0}
				<ul class="cs-items" aria-label="Vedlegg">
					{#each items as item (item.id)}
						<li class="cs-item">
							{#if item.previewUrl}
								<img class="cs-thumb" src={item.previewUrl} alt={item.name} />
							{:else}
								<span class="cs-file" title={item.name}>
									<Icon name="file" size={18} />
									<span class="cs-file-name">{item.name}</span>
								</span>
							{/if}
							{#if phase === 'compose'}
								<button
									class="cs-remove"
									type="button"
									aria-label={`Fjern ${item.name}`}
									data-track="inngang:fjern-vedlegg"
									onclick={() => removeItem(item.id)}
								>✕</button>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}

			{#if notice}<p class="cs-notice" role="status">{notice}</p>{/if}

			<!-- Biblioteket står først: det er den diskré veien inn, og den eneste som
			     tar flere bilder. `capture` tvinger kameraet, så det trengs et eget felt. -->
			<input class="cs-hidden" type="file" multiple accept={CAPTURE_ACCEPT} bind:this={libraryInput} onchange={onPicked} tabindex="-1" aria-hidden="true" />
			<input class="cs-hidden" type="file" accept="image/*" capture="environment" bind:this={cameraInput} onchange={onPicked} tabindex="-1" aria-hidden="true" />

			<div class="cs-actions">
				<button class="cs-pick" type="button" data-track="inngang:bibliotek" disabled={phase !== 'compose' || items.length >= MAX_CAPTURE_ITEMS} onclick={() => libraryInput?.click()}>
					<Icon name="attach" size={17} /> Bilder og filer
				</button>
				<button class="cs-pick" type="button" data-track="inngang:kamera" disabled={phase !== 'compose' || items.length >= MAX_CAPTURE_ITEMS} onclick={() => cameraInput?.click()}>
					<Icon name="camera" size={17} /> Kamera
				</button>
				<button class="cs-send" type="button" data-track="inngang:send" disabled={!canSend} onclick={send}>
					{#if phase === 'uploading'}
						Laster opp {Math.min(uploaded + 1, items.length)} av {items.length}…
					{:else}
						Send
					{/if}
				</button>
			</div>
		</div>
	{/if}
	</div>
</BottomSheet>

<style>
	/* Arket portaleres til <body> og arver derfor ikke AppPage-variablene; som de
	   andre arkene er det mørkt uansett systeminnstilling. Fargene står samlet her,
	   så overgangen til det nye uttrykket (spor 4) er ett sted å endre. */
	.cs-root {
		--cs-fg: #ececec;
		--cs-fg-2: #b8b8b8;
		--cs-muted: #8a8a8a;
		--cs-bg: #0f0f0f;
		--cs-field: #171717;
		--cs-surface: #161616;
		--cs-border: #2a2a2a;
		--cs-accent: #6b7cff;
		--cs-warn: #e2c27a;
		display: flex;
		flex-direction: column;
		min-height: 0;
		color: var(--cs-fg);
	}
	.cs-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 18px 18px 8px;
	}
	.cs-title {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 650;
		color: var(--cs-fg);
	}
	.cs-close {
		background: none;
		border: none;
		color: var(--cs-muted);
		padding: 6px;
		cursor: pointer;
		display: inline-flex;
	}
	.cs-body {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 4px 18px calc(18px + env(safe-area-inset-bottom, 0px));
	}
	.cs-text {
		width: 100%;
		box-sizing: border-box;
		resize: none;
		min-height: 84px;
		background: var(--cs-field);
		border: 1px solid var(--cs-border);
		border-radius: 14px;
		padding: 12px 14px;
		color: var(--cs-fg);
		font: inherit;
		font-size: 1rem;
		line-height: 1.4;
	}
	.cs-text:focus {
		outline: none;
		border-color: var(--cs-accent);
	}
	.cs-items {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.cs-item {
		position: relative;
	}
	.cs-thumb {
		width: 72px;
		height: 72px;
		object-fit: cover;
		border-radius: 10px;
		display: block;
	}
	.cs-file {
		width: 72px;
		height: 72px;
		box-sizing: border-box;
		border-radius: 10px;
		background: var(--cs-surface);
		border: 1px solid var(--cs-border);
		color: var(--cs-fg-2);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 4px;
		padding: 6px;
	}
	.cs-file-name {
		font-size: 0.62rem;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.cs-remove {
		position: absolute;
		top: -6px;
		right: -6px;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		border: 1px solid var(--cs-border);
		background: var(--cs-bg);
		color: var(--cs-fg-2);
		font-size: 0.7rem;
		cursor: pointer;
		padding: 0;
	}
	.cs-notice {
		margin: 0;
		font-size: 0.8rem;
		color: var(--cs-warn);
	}
	.cs-hidden {
		display: none;
	}
	.cs-actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.cs-pick {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: var(--cs-surface);
		border: 1px solid var(--cs-border);
		color: var(--cs-fg-2);
		border-radius: 999px;
		padding: 9px 13px;
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
	}
	.cs-pick:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.cs-send {
		margin-left: auto;
		background: var(--cs-accent);
		border: none;
		color: #fff;
		border-radius: 999px;
		padding: 9px 18px;
		font: inherit;
		font-size: 0.88rem;
		font-weight: 600;
		cursor: pointer;
	}
	.cs-send:disabled {
		opacity: 0.45;
		cursor: default;
	}
	/* ChatThread eier scroll og gap; `class` treffer en annen komponent, derfor :global. */
	:global(.cs-thread) {
		flex: 1;
		min-height: 180px;
		max-height: 55dvh;
		padding: 8px 16px;
	}
	.cs-foot {
		padding: 8px 14px calc(14px + env(safe-area-inset-bottom, 0px));
		border-top: 1px solid var(--cs-border);
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.cs-links {
		display: flex;
		justify-content: space-between;
		gap: 12px;
	}
	.cs-link {
		background: none;
		border: none;
		padding: 4px 2px;
		font: inherit;
		font-size: 0.8rem;
		color: var(--cs-muted);
		cursor: pointer;
		text-decoration: none;
	}
	.cs-link:hover {
		color: var(--cs-fg);
	}
</style>
