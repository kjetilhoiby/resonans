<!--
  Notatblokk — ett søkefelt, to kilder.

  Dokumenter (writing_docs) kan redigeres; fangst (reflections) er logg-rader og
  vises som de er, med mulighet for å kopiere dem inn som dokument. Søket er
  semantisk og går på tvers av begge — se $lib/server/writing/search.ts.

  Kollisjonshåndtering: lagring sender `expectedUpdatedAt`, og et 409-svar vises
  som en tydelig melding framfor å skrives over. Meldingen hentes med
  extractApiErrorMessage; en `catch {}` her ville gjort en prod-feil uløselig.
-->
<script lang="ts">
	import { AppPage, PageSection, PageHeader, Input, Textarea, Button, Select } from '$lib/components/ui';
	import { extractApiErrorMessage } from '$lib/client/api-error';
	import { WRITING_DOC_KIND_DEFS } from '$lib/domain/writing/doc-kinds';
	import type { NotebookHit } from '$lib/domain/writing/notebook-results';
	import { countTags } from '$lib/domain/writing/tags';
	import { parseChecklist } from '$lib/domain/writing/checklist';

	let { data } = $props();

	let hits = $state<NotebookHit[]>(data.hits);
	let query = $state('');
	let searching = $state(false);
	let searchMode = $state<'semantic' | 'text-fallback' | 'recent'>('recent');
	let listError = $state<string | null>(null);

	/* ── Editor ──────────────────────────────────────────── */
	type EditorState = {
		id: string | null;
		title: string;
		body: string;
		kind: string;
		tags: string;
		expectedUpdatedAt: string | null;
	};

	let editor = $state<EditorState | null>(null);
	let saving = $state(false);
	let editorError = $state<string | null>(null);
	let conflict = $state(false);

	const documents = $derived(hits.filter((h) => h.source === 'dokument'));
	// Autofullføring er motgiften mot at «Idas bue» og «bue-ida» blir to tags.
	const knownTags = $derived(countTags(hits));
	const checklist = $derived(editor ? parseChecklist(editor.body) : null);
	const capture = $derived(hits.filter((h) => h.source === 'fangst'));

	let searchTimer: ReturnType<typeof setTimeout> | undefined;

	function onQueryInput() {
		clearTimeout(searchTimer);
		// Embedding-kall per tastetrykk ville vært både tregt og dyrt.
		searchTimer = setTimeout(runSearch, 300);
	}

	async function runSearch() {
		searching = true;
		listError = null;
		try {
			const url = query.trim()
				? `/api/notater?q=${encodeURIComponent(query.trim())}`
				: '/api/notater';
			const res = await fetch(url);
			if (!res.ok) {
				listError = extractApiErrorMessage(res.status, await res.text());
				return;
			}
			const body = await res.json();
			hits = body.hits;
			searchMode = body.mode;
		} catch (err) {
			listError = `Søket feilet: ${err instanceof Error ? err.message : String(err)}`;
		} finally {
			searching = false;
		}
	}

	function newDoc() {
		conflict = false;
		editorError = null;
		editor = { id: null, title: '', body: '', kind: 'notat', tags: '', expectedUpdatedAt: null };
	}

	async function openDoc(hit: NotebookHit) {
		if (hit.source !== 'dokument') return;
		conflict = false;
		editorError = null;
		const res = await fetch(`/api/notater/${hit.id}`);
		if (!res.ok) {
			listError = extractApiErrorMessage(res.status, await res.text());
			return;
		}
		const doc = await res.json();
		editor = {
			id: doc.id,
			title: doc.title,
			body: doc.body,
			kind: doc.kind,
			tags: (doc.tags ?? []).join(', '),
			expectedUpdatedAt: doc.updatedAt
		};
	}

	async function save() {
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
					// Komma er skilletegnet. normalizeTags på serveren trimmer og
					// fjerner duplikater, så et slurvete «Ida,  ida» blir én tag.
					tags: editor.tags.split(',').map((t) => t.trim()).filter(Boolean),
					...(isNew ? {} : { expectedUpdatedAt: editor.expectedUpdatedAt })
				})
			});

			if (res.status === 409) {
				// Den andre enheten vant. Teksten står trygt i feltet — vi lagrer ikke
				// over, og sier hva som skjedde.
				conflict = true;
				editorError = extractApiErrorMessage(res.status, await res.text());
				return;
			}
			if (!res.ok) {
				editorError = extractApiErrorMessage(res.status, await res.text());
				return;
			}

			const doc = await res.json();
			editor = { ...editor, id: doc.id, expectedUpdatedAt: doc.updatedAt };
			await runSearch();
		} catch (err) {
			editorError = `Lagring feilet: ${err instanceof Error ? err.message : String(err)}`;
		} finally {
			saving = false;
		}
	}

	async function promote(hit: NotebookHit) {
		const res = await fetch('/api/notater', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ fraRefleksjon: hit.id })
		});
		if (!res.ok) {
			listError = extractApiErrorMessage(res.status, await res.text());
			return;
		}
		await runSearch();
	}

	async function remove() {
		if (!editor?.id) return;
		const res = await fetch(`/api/notater/${editor.id}`, { method: 'DELETE' });
		if (!res.ok) {
			editorError = extractApiErrorMessage(res.status, await res.text());
			return;
		}
		editor = null;
		await runSearch();
	}

	function fmt(iso: string): string {
		return new Intl.DateTimeFormat('nb-NO', {
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		}).format(new Date(iso));
	}
</script>

<AppPage>
	<PageSection>
		<PageHeader title="Notatblokk" titleHref="/" />

		{#if editor}
			<div class="editor">
				<div class="editor-top">
					<Select
						value={editor.kind}
						onChange={(e) => editor && (editor.kind = (e.target as HTMLSelectElement).value)}
						ariaLabel="Dokumenttype"
					>
						{#each WRITING_DOC_KIND_DEFS as def (def.key)}
							<option value={def.key}>{def.emoji} {def.label}</option>
						{/each}
					</Select>
					<button class="link" onclick={() => (editor = null)} aria-label="Lukk dokumentet">
						Lukk
					</button>
				</div>

				<Input
					bind:value={editor.title}
					placeholder="Tittel (valgfritt)"
					dataTrack="notatblokk:tittel"
					ariaLabel="Tittel"
				/>
				<Textarea
					bind:value={editor.body}
					rows={16}
					placeholder="Skriv…"
					dataTrack="notatblokk:tekst"
					ariaLabel="Tekst"
				/>
				<Input
					bind:value={editor.tags}
					placeholder="Tags, komma-separert (Ida, Idas bue, spenning)"
					dataTrack="notatblokk:tags"
					ariaLabel="Tags"
					list="notatblokk-tags"
				/>
				<datalist id="notatblokk-tags">
					{#each knownTags as t (t.tag)}<option value={t.tag}></option>{/each}
				</datalist>
				{#if checklist && checklist.total > 0}
					<p class="hint">Avkryssing: {checklist.done} av {checklist.total} brukt.</p>
				{/if}

				{#if editorError}
					<p class="error" class:conflict role="alert">{editorError}</p>
				{/if}

				<div class="editor-actions">
					<Button onClick={save} disabled={saving}>
						{saving ? 'Lagrer…' : 'Lagre'}
					</Button>
					{#if editor.id}
						<Button variant="ghost" onClick={remove}>Slett</Button>
					{/if}
				</div>
			</div>
		{:else}
			<div class="toolbar">
				<Input
					bind:value={query}
					placeholder="Søk i alt du har skrevet…"
					dataTrack="notatblokk:sok"
					ariaLabel="Søk"
					onInput={onQueryInput}
				/>
				<Button onClick={newDoc}>Nytt notat</Button>
			</div>
			<!-- Veien videre til prosjektene. Notatblokka er inngangen fra hjem, så
			     dette er eneste lenke til /skriv. -->
			<p class="hint"><a class="link-inline" href="/skriv">Skriveprosjekter →</a></p>

			{#if searchMode === 'semantic' && query.trim()}
				<p class="hint">Semantisk søk — treffene trenger ikke inneholde ordene du skrev.</p>
			{:else if searchMode === 'text-fallback' && query.trim()}
				<p class="hint">Tekstsøk (semantisk søk var utilgjengelig).</p>
			{/if}

			{#if listError}
				<p class="error" role="alert">{listError}</p>
			{/if}

			{#if searching}
				<p class="hint">Søker…</p>
			{/if}

			<h2 class="section-title">Dokumenter <span class="count">{documents.length}</span></h2>
			{#if documents.length === 0}
				<p class="empty">Ingen dokumenter ennå. «Nytt notat» starter det første.</p>
			{:else}
				<ul class="list">
					{#each documents as hit (hit.id)}
						<li>
							<button class="row" onclick={() => openDoc(hit)} data-track="notatblokk:apne-dokument">
								<span class="emoji">{hit.emoji}</span>
								<span class="row-main">
									<span class="row-title">{hit.title}</span>
									<span class="row-excerpt">{hit.excerpt}</span>
								</span>
								<span class="row-meta">
									{#if hit.similarity !== null}<span class="sim">{Math.round(hit.similarity * 100)} %</span>{/if}
									{#if hit.checklist}<span>{hit.checklist.done}/{hit.checklist.total}</span>{/if}
									<span>{fmt(hit.timestamp)}</span>
									{#if hit.tags.length > 0}<span class="tags">{hit.tags.join(' · ')}</span>{/if}
								</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}

			<h2 class="section-title">Fangst <span class="count">{capture.length}</span></h2>
			<p class="hint">
				Dagsnotater og refleksjoner. Disse er logg-rader og endres ikke — kopier dem inn som
				dokument hvis du vil jobbe videre med teksten.
			</p>
			{#if capture.length === 0}
				<p class="empty">Ingen fangst i dette utvalget.</p>
			{:else}
				<ul class="list">
					{#each capture as hit (hit.id)}
						<li class="capture-row">
							<span class="emoji">{hit.emoji}</span>
							<span class="row-main">
								<span class="row-title">{hit.title}</span>
								<span class="row-excerpt">{hit.excerpt}</span>
							</span>
							<span class="row-meta">
								{#if hit.similarity !== null}<span class="sim">{Math.round(hit.similarity * 100)} %</span>{/if}
								<span>{fmt(hit.timestamp)}</span>
								<button class="link" onclick={() => promote(hit)} data-track="notatblokk:kopier-fangst">
									Kopier
								</button>
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</PageSection>
</AppPage>

<style>
	.toolbar {
		display: flex;
		gap: 8px;
		align-items: center;
		margin-bottom: 12px;
	}
	.toolbar :global(.ds-input) {
		flex: 1;
	}

	.section-title {
		font-size: var(--text-sm);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-secondary);
		margin: 24px 0 8px;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.count {
		color: var(--text-tertiary);
		font-weight: 400;
	}

	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.row,
	.capture-row {
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
	}
	.row {
		cursor: pointer;
	}
	.row:hover {
		background: var(--card-bg-subtle);
	}

	.emoji {
		font-size: 1.1rem;
		line-height: 1.4;
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
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.row-excerpt {
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
	.sim {
		color: var(--accent-primary);
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
	.editor-actions {
		display: flex;
		gap: 8px;
	}

	.link {
		background: none;
		border: none;
		color: var(--accent-primary);
		cursor: pointer;
		font-size: var(--text-sm);
		padding: 4px;
	}
	.link-inline {
		color: var(--accent-primary);
	}

	.hint,
	.empty {
		color: var(--text-tertiary);
		font-size: var(--text-sm);
		margin: 8px 0;
	}

	.error {
		color: var(--color-danger, #ff6b6b);
		font-size: var(--text-sm);
		margin: 4px 0;
	}
	/* Kollisjon er ikke en vanlig feil — teksten din står trygt, og meldingen
	   skal være umulig å overse. */
	.error.conflict {
		border: 1px solid var(--color-danger, #ff6b6b);
		border-radius: var(--card-radius);
		padding: 12px;
		background: rgba(255, 107, 107, 0.08);
	}
</style>
