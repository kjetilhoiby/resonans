<!--
  Prosjektrommet — manus, materiale og kompislesing.

  Manuset er de ordnede typene (kapittel, scene) etter sortOrder; materialet er
  karakterer, steder og notater. Chatten har tre moduser, alle på forespørsel:
  modusen er eksplisitt UI-tilstand og sendes til serveren, som bygger prompten.
  Glir modellen mellom leser og redaktør blir tilbakemeldingen mush.
-->
<script lang="ts">
	import { AppPage, PageSection, PageHeader, Input, Textarea, Button, Select, TabButton } from '$lib/components/ui';
	import { extractApiErrorMessage } from '$lib/client/api-error';
	import { WRITING_CHAT_MODE_DEFS, type WritingChatMode } from '$lib/domain/writing/coach-prompt';
	import { WRITING_DOC_KIND_DEFS } from '$lib/domain/writing/doc-kinds';
	import { invalidateAll } from '$app/navigation';

	let { data } = $props();

	type Doc = (typeof data.manuscript)[number];

	let tab = $state<'manus' | 'materiale' | 'lesing'>('manus');
	let listError = $state<string | null>(null);

	/* ── Dokumentredigering ──────────────────────────────── */
	let editor = $state<{
		id: string | null;
		title: string;
		body: string;
		kind: string;
		expectedUpdatedAt: string | null;
	} | null>(null);
	let saving = $state(false);
	let editorError = $state<string | null>(null);
	let conflict = $state(false);

	function newDoc(kind: string) {
		conflict = false;
		editorError = null;
		editor = { id: null, title: '', body: '', kind, expectedUpdatedAt: null };
	}

	function openDoc(doc: Doc) {
		conflict = false;
		editorError = null;
		editor = {
			id: doc.id,
			title: doc.title,
			body: doc.body,
			kind: doc.kind,
			expectedUpdatedAt: doc.updatedAt
		};
	}

	async function saveDoc() {
		if (!editor) return;
		if (!editor.title.trim() && !editor.body.trim()) {
			editorError = 'Tomt dokument — skriv en tittel eller litt tekst først.';
			return;
		}
		saving = true;
		editorError = null;
		conflict = false;
		try {
			const isNew = editor.id === null;
			const res = await fetch(isNew ? '/api/notater' : `/api/notater/${editor.id}`, {
				method: isNew ? 'POST' : 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					title: editor.title,
					body: editor.body,
					kind: editor.kind,
					projectId: data.project.id,
					...(isNew ? {} : { expectedUpdatedAt: editor.expectedUpdatedAt })
				})
			});
			if (res.status === 409) {
				conflict = true;
				editorError = extractApiErrorMessage(res.status, await res.text());
				return;
			}
			if (!res.ok) {
				editorError = extractApiErrorMessage(res.status, await res.text());
				return;
			}
			editor = null;
			await invalidateAll();
		} catch (err) {
			editorError = `Lagring feilet: ${err instanceof Error ? err.message : String(err)}`;
		} finally {
			saving = false;
		}
	}

	async function deleteDoc() {
		if (!editor?.id) return;
		const res = await fetch(`/api/notater/${editor.id}`, { method: 'DELETE' });
		if (!res.ok) {
			editorError = extractApiErrorMessage(res.status, await res.text());
			return;
		}
		editor = null;
		await invalidateAll();
	}

	/* ── Kompislesing ────────────────────────────────────── */
	let mode = $state<WritingChatMode>('leser');
	let focusDocId = $state<string>('');
	let chatInput = $state('');
	let chatMessages = $state(data.messages);
	let streaming = $state('');
	let chatLoading = $state(false);
	let chatError = $state<string | null>(null);

	const allDocs = $derived([...data.manuscript, ...data.material]);
	const currentMode = $derived(
		WRITING_CHAT_MODE_DEFS.find((m) => m.key === mode) ?? WRITING_CHAT_MODE_DEFS[0]
	);

	async function send() {
		const text = chatInput.trim();
		if (!text || chatLoading) return;

		chatMessages = [...chatMessages, { role: 'user' as const, text }];
		chatInput = '';
		chatLoading = true;
		chatError = null;
		streaming = '';

		try {
			const res = await fetch(`/api/skriveprosjekt/${data.project.id}/lesing`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ message: text, mode, focusDocId: focusDocId || undefined })
			});
			if (!res.ok || !res.body) {
				chatError = extractApiErrorMessage(res.status, await res.text());
				return;
			}

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				for (let i = 0; i < lines.length - 1; i++) {
					const line = lines[i].trim();
					if (!line.startsWith('data: ')) continue;
					const event = JSON.parse(line.slice(6));
					if (event.type === 'token') streaming += event.data?.token ?? '';
					else if (event.type === 'error') chatError = event.data?.message ?? 'Ukjent feil';
				}
				buffer = lines[lines.length - 1];
			}

			if (streaming) chatMessages = [...chatMessages, { role: 'assistant' as const, text: streaming }];
			streaming = '';
		} catch (err) {
			chatError = `Kompislesingen feilet: ${err instanceof Error ? err.message : String(err)}`;
		} finally {
			chatLoading = false;
		}
	}
</script>

<AppPage>
	<PageSection>
		<PageHeader title={data.project.title} titleHref="/skriv" />

		{#if data.project.summary}
			<p class="premiss">{data.project.summary}</p>
		{/if}

		<div class="tabs">
			<TabButton active={tab === 'manus'} onClick={() => (tab = 'manus')}>Manus</TabButton>
			<TabButton active={tab === 'materiale'} onClick={() => (tab = 'materiale')}>Materiale</TabButton>
			<TabButton active={tab === 'lesing'} onClick={() => (tab = 'lesing')}>Kompislesing</TabButton>
		</div>

		{#if listError}<p class="error" role="alert">{listError}</p>{/if}

		{#if editor}
			<div class="editor">
				<div class="editor-top">
					<Select bind:value={editor.kind} ariaLabel="Dokumenttype" dataTrack="skriv:dokumenttype">
						{#each WRITING_DOC_KIND_DEFS as def (def.key)}
							<option value={def.key}>{def.emoji} {def.label}</option>
						{/each}
					</Select>
					<button class="link" onclick={() => (editor = null)} aria-label="Lukk dokumentet">Lukk</button>
				</div>
				<Input bind:value={editor.title} placeholder="Tittel" dataTrack="skriv:dokument-tittel" ariaLabel="Tittel" />
				<Textarea bind:value={editor.body} rows={18} placeholder="Skriv…" dataTrack="skriv:dokument-tekst" ariaLabel="Tekst" />
				{#if editorError}<p class="error" class:conflict role="alert">{editorError}</p>{/if}
				<div class="actions">
					<Button onClick={saveDoc} disabled={saving}>{saving ? 'Lagrer…' : 'Lagre'}</Button>
					{#if editor.id}<Button variant="ghost" onClick={deleteDoc}>Slett</Button>{/if}
				</div>
			</div>
		{:else if tab === 'manus'}
			<div class="toolbar">
				<Button onClick={() => newDoc('scene')}>Ny scene</Button>
				<Button variant="ghost" onClick={() => newDoc('kapittel')}>Nytt kapittel</Button>
			</div>
			{#if data.manuscript.length === 0}
				<p class="empty">Manuset er tomt. En scene er et godt sted å begynne.</p>
			{:else}
				<ul class="list">
					{#each data.manuscript as doc (doc.id)}
						<li>
							<button class="row" onclick={() => openDoc(doc)} data-track="skriv:apne-manusdel">
								<span class="row-main">
									<span class="row-title">{doc.title || '(uten tittel)'}</span>
									<span class="row-sub">{doc.body.slice(0, 140)}</span>
								</span>
								<span class="row-meta">
									<span>{doc.words} ord</span>
									<span>{doc.status}</span>
								</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		{:else if tab === 'materiale'}
			<div class="toolbar">
				<Button onClick={() => newDoc('karakter')}>Ny karakter</Button>
				<Button variant="ghost" onClick={() => newDoc('sted')}>Nytt sted</Button>
				<Button variant="ghost" onClick={() => newDoc('notat')}>Nytt notat</Button>
			</div>
			{#if data.material.length === 0}
				<p class="empty">Ingen karakterer eller steder ennå.</p>
			{:else}
				<ul class="list">
					{#each data.material as doc (doc.id)}
						<li>
							<button class="row" onclick={() => openDoc(doc)} data-track="skriv:apne-materiale">
								<span class="row-main">
									<span class="row-title">{doc.title || '(uten tittel)'}</span>
									<span class="row-sub">{doc.body.slice(0, 140)}</span>
								</span>
								<span class="row-meta"><span>{doc.kind}</span></span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		{:else}
			<div class="mode-row">
				<Select bind:value={mode} ariaLabel="Modus" dataTrack="skriv:kompislesing-modus">
					{#each WRITING_CHAT_MODE_DEFS as def (def.key)}
						<option value={def.key}>{def.emoji} {def.label}</option>
					{/each}
				</Select>
				{#if currentMode.scope !== 'prosjekt'}
					<Select bind:value={focusDocId} ariaLabel="Tekst å lese" dataTrack="skriv:kompislesing-tekst">
						<option value="">Velg tekst…</option>
						{#each allDocs as doc (doc.id)}
							<option value={doc.id}>{doc.title || '(uten tittel)'}</option>
						{/each}
					</Select>
				{/if}
			</div>
			<p class="hint">{currentMode.hint}</p>
			{#if currentMode.scope !== 'prosjekt' && !focusDocId}
				<p class="hint">Velg en tekst — denne modusen leser noe konkret.</p>
			{/if}

			<div class="chat">
				{#each chatMessages as msg, i (i)}
					<div class="bubble" class:user={msg.role === 'user'}>{msg.text}</div>
				{/each}
				{#if streaming}<div class="bubble">{streaming}</div>{/if}
				{#if chatLoading && !streaming}<p class="hint">Leser…</p>{/if}
			</div>

			{#if chatError}<p class="error" role="alert">{chatError}</p>{/if}

			<div class="chat-input">
				<Input
					bind:value={chatInput}
					placeholder="Spør kompsileseren…"
					dataTrack="skriv:kompislesing-melding"
					ariaLabel="Melding"
				/>
				<Button onClick={send} disabled={chatLoading}>Send</Button>
			</div>
		{/if}
	</PageSection>
</AppPage>

<style>
	.premiss {
		color: var(--text-secondary);
		font-size: var(--text-sm);
		margin: 0 0 12px;
	}
	.tabs {
		display: flex;
		gap: 8px;
		margin-bottom: 16px;
	}
	.toolbar {
		display: flex;
		gap: 8px;
		margin-bottom: 12px;
		flex-wrap: wrap;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.row {
		width: 100%;
		display: flex;
		gap: 12px;
		align-items: flex-start;
		text-align: left;
		background: var(--card-bg);
		border: 1px solid var(--card-border);
		border-radius: var(--card-radius);
		padding: var(--card-padding);
		color: var(--text-primary);
		cursor: pointer;
	}
	.row:hover {
		background: var(--card-bg-subtle);
	}
	.row-main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.row-title {
		font-weight: 600;
	}
	.row-sub {
		color: var(--text-secondary);
		font-size: var(--text-sm);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.row-meta {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 4px;
		font-size: var(--text-xs);
		color: var(--text-tertiary);
		white-space: nowrap;
	}

	.editor {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.editor-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
	}
	.actions {
		display: flex;
		gap: 8px;
	}

	.mode-row {
		display: flex;
		gap: 8px;
		margin-bottom: 8px;
		flex-wrap: wrap;
	}
	.chat {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 12px 0;
	}
	.bubble {
		background: var(--card-bg);
		border: 1px solid var(--card-border);
		border-radius: var(--card-radius);
		padding: 12px;
		white-space: pre-wrap;
	}
	.bubble.user {
		background: var(--card-bg-subtle);
		align-self: flex-end;
		max-width: 85%;
	}
	.chat-input {
		display: flex;
		gap: 8px;
	}
	.chat-input :global(.ds-input) {
		flex: 1;
	}

	.hint,
	.empty {
		color: var(--text-tertiary);
		font-size: var(--text-sm);
		margin: 6px 0;
	}
	.error {
		color: var(--color-danger, #ff6b6b);
		font-size: var(--text-sm);
	}
	.error.conflict {
		border: 1px solid var(--color-danger, #ff6b6b);
		border-radius: var(--card-radius);
		padding: 12px;
		background: rgba(255, 107, 107, 0.08);
	}
	.link {
		background: none;
		border: none;
		color: var(--accent-primary);
		cursor: pointer;
		font-size: var(--text-sm);
		padding: 4px;
	}
</style>
