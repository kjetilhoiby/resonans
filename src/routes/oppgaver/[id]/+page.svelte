<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';

	export let data: PageData;
	$: project = data.project;

	let newStepTitle = '';
	let savingStep = false;
	let uploadingFile = false;
	let creatingChat = false;
	let editingDates = false;
	let startDateInput = project.startDate ? project.startDate.slice(0, 10) : '';
	let dueDateInput = project.dueDate ? project.dueDate.slice(0, 10) : '';

	$: total = project.children.length;
	$: done = project.children.filter((c) => c.status === 'done' || c.status === 'completed').length;
	$: progressPct = total === 0 ? 0 : Math.round((done / total) * 100);

	$: deadlineLabel = (() => {
		if (!project.dueDate) return null;
		const due = new Date(project.dueDate);
		const now = new Date();
		const diffMs = due.getTime() - now.getTime();
		const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
		const fmt = due.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' });
		if (diffMs < 0) return { text: `Forfalt ${fmt}`, overdue: true };
		if (diffDays === 0) return { text: 'Forfaller i dag', overdue: false };
		if (diffDays <= 3) return { text: `${fmt} (${diffDays} dager)`, overdue: false };
		return { text: fmt, overdue: false };
	})();

	async function addStep() {
		const title = newStepTitle.trim();
		if (!title || savingStep) return;
		savingStep = true;
		try {
			const res = await fetch(`/api/tasks/${project.id}/subtasks`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title, sortOrder: project.children.length })
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				alert(body.error || 'Kunne ikke legge til steg');
				return;
			}
			newStepTitle = '';
			await invalidateAll();
		} finally {
			savingStep = false;
		}
	}

	async function toggleStep(stepId: string, current: string) {
		const next = current === 'done' || current === 'completed' ? 'active' : 'done';
		const res = await fetch(`/api/tasks/${stepId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ status: next })
		});
		if (!res.ok) {
			alert('Kunne ikke oppdatere steg');
			return;
		}
		if (next === 'done') {
			void fetch(`/api/tasks/${stepId}/progress`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ value: 1 })
			});
		}
		await invalidateAll();
	}

	async function deleteStep(stepId: string) {
		if (!confirm('Slett dette steget?')) return;
		const res = await fetch(`/api/tasks/${stepId}`, { method: 'DELETE' });
		if (!res.ok) {
			alert('Kunne ikke slette steg');
			return;
		}
		await invalidateAll();
	}

	async function saveDates() {
		const body: Record<string, string | null> = {
			startDate: startDateInput ? new Date(startDateInput).toISOString() : null,
			dueDate: dueDateInput ? new Date(dueDateInput).toISOString() : null
		};
		const res = await fetch(`/api/tasks/${project.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			alert(err.error || 'Kunne ikke lagre datoer');
			return;
		}
		editingDates = false;
		await invalidateAll();
	}

	async function uploadFile(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		uploadingFile = true;
		try {
			const fd = new FormData();
			fd.append('file', file);
			const res = await fetch(`/api/tasks/${project.id}/files`, { method: 'POST', body: fd });
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				alert(err.error || 'Kunne ikke laste opp fil');
				return;
			}
			input.value = '';
			await invalidateAll();
		} finally {
			uploadingFile = false;
		}
	}

	async function deleteFile(fileId: string) {
		if (!confirm('Slett denne filen?')) return;
		const res = await fetch(`/api/tasks/${project.id}/files/${fileId}`, { method: 'DELETE' });
		if (!res.ok) {
			alert('Kunne ikke slette fil');
			return;
		}
		await invalidateAll();
	}

	async function startProjectChat() {
		creatingChat = true;
		try {
			const res = await fetch(`/api/tasks/${project.id}/conversation`, { method: 'POST' });
			if (!res.ok) {
				alert('Kunne ikke opprette prosjekt-chat');
				return;
			}
			const { conversation } = await res.json();
			window.location.href = `/samtaler?conversation=${conversation.id}`;
		} finally {
			creatingChat = false;
		}
	}

	function formatBytes(n: number | null) {
		if (!n) return '';
		if (n < 1024) return `${n} B`;
		if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
		return `${(n / (1024 * 1024)).toFixed(1)} MB`;
	}
</script>

<svelte:head>
	<title>{project.title} – Resonans</title>
</svelte:head>

<div class="page">
	<a class="back-link" href="/maal">← Tilbake til mål</a>

	<header class="header">
		<h1>{project.title}</h1>
		{#if project.description}
			<p class="description">{project.description}</p>
		{/if}

		<div class="meta">
			{#if total > 0}
				<div class="progress">
					<div class="progress-bar">
						<div class="progress-fill" style="width: {progressPct}%"></div>
					</div>
					<span class="progress-text">{done}/{total} fullført</span>
				</div>
			{/if}

			{#if deadlineLabel}
				<span class="pill" class:overdue={deadlineLabel.overdue}>📅 {deadlineLabel.text}</span>
			{/if}

			<button class="link-btn" on:click={() => (editingDates = !editingDates)}>
				{editingDates ? 'Lukk' : 'Endre datoer'}
			</button>
		</div>

		{#if editingDates}
			<div class="date-editor">
				<label>
					Startdato
					<input type="date" bind:value={startDateInput} />
				</label>
				<label>
					Frist
					<input type="date" bind:value={dueDateInput} />
				</label>
				<button class="primary" on:click={saveDates}>Lagre</button>
			</div>
		{/if}
	</header>

	<section class="section">
		<h2>Steg</h2>
		{#if project.children.length === 0}
			<p class="empty">Ingen steg ennå. Bryt ned prosjektet i konkrete handlinger.</p>
		{:else}
			<ul class="steps">
				{#each project.children as step (step.id)}
					<li class="step" class:done={step.status === 'done' || step.status === 'completed'}>
						<input
							type="checkbox"
							checked={step.status === 'done' || step.status === 'completed'}
							on:change={() => toggleStep(step.id, step.status)}
						/>
						<span class="step-title">{step.title}</span>
						<button class="icon-btn" title="Slett" on:click={() => deleteStep(step.id)}>×</button>
					</li>
				{/each}
			</ul>
		{/if}

		<form
			class="add-step"
			on:submit|preventDefault={addStep}
		>
			<input
				type="text"
				placeholder="Legg til steg…"
				bind:value={newStepTitle}
				disabled={savingStep}
			/>
			<button type="submit" class="primary" disabled={!newStepTitle.trim() || savingStep}>
				{savingStep ? 'Lagrer…' : 'Legg til'}
			</button>
		</form>
	</section>

	<section class="section">
		<h2>Filer</h2>
		{#if project.files.length === 0}
			<p class="empty">Ingen filer ennå.</p>
		{:else}
			<ul class="files">
				{#each project.files as file (file.id)}
					<li class="file">
						<a href={file.url} target="_blank" rel="noopener">
							{#if file.fileType === 'image'}🖼{:else if file.fileType === 'pdf'}📍{:else}📄{/if}
							{file.name}
						</a>
						<span class="file-size">{formatBytes(file.sizeBytes)}</span>
						<button class="icon-btn" title="Slett" on:click={() => deleteFile(file.id)}>×</button>
					</li>
				{/each}
			</ul>
		{/if}

		<label class="upload">
			<input type="file" on:change={uploadFile} disabled={uploadingFile} hidden />
			<span class="primary-link">{uploadingFile ? 'Laster opp…' : '+ Last opp fil'}</span>
		</label>
	</section>

	<section class="section">
		<h2>Prosjekt-chat</h2>
		{#if project.conversationId}
			<p class="empty">Du har en pågående prosjekt-chat for denne oppgaven.</p>
			{#if data.chatMessages.length > 0}
				<div class="chat-preview">
					{#each data.chatMessages.slice(-3) as msg}
						<div class="msg msg-{msg.role}">
							<strong>{msg.role === 'user' ? 'Du' : 'AI'}:</strong>
							<span>{msg.content.slice(0, 200)}{msg.content.length > 200 ? '…' : ''}</span>
						</div>
					{/each}
				</div>
			{/if}
			<a class="primary-link" href="/samtaler?conversation={project.conversationId}">Åpne chat →</a>
		{:else}
			<p class="empty">Start en chat for å justere planen, be om råd, eller drøfte enkeltsteg.</p>
			<button class="primary" on:click={startProjectChat} disabled={creatingChat}>
				{creatingChat ? 'Oppretter…' : 'Start prosjekt-chat'}
			</button>
		{/if}
	</section>
</div>

<style>
	.page {
		max-width: 720px;
		margin: 0 auto;
		padding: 1.5rem 1rem 4rem;
	}

	.back-link {
		display: inline-block;
		font-size: 0.9rem;
		color: var(--text-muted, #666);
		text-decoration: none;
		margin-bottom: 1rem;
	}
	.back-link:hover { color: var(--text, #222); }

	.header h1 {
		font-size: 1.6rem;
		margin: 0 0 0.5rem;
	}
	.description {
		color: var(--text-muted, #555);
		margin: 0 0 1rem;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}
	.progress {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex: 1 1 200px;
	}
	.progress-bar {
		flex: 1;
		height: 8px;
		background: rgba(0, 0, 0, 0.08);
		border-radius: 4px;
		overflow: hidden;
	}
	.progress-fill {
		height: 100%;
		background: var(--accent, #4a7);
		transition: width 0.2s ease;
	}
	.progress-text {
		font-size: 0.85rem;
		color: var(--text-muted, #666);
	}
	.pill {
		display: inline-flex;
		align-items: center;
		padding: 0.25rem 0.6rem;
		border-radius: 999px;
		font-size: 0.8rem;
		background: rgba(0, 0, 0, 0.05);
	}
	.pill.overdue {
		background: rgba(220, 60, 60, 0.15);
		color: #b22;
	}

	.date-editor {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: end;
		padding: 0.75rem;
		background: rgba(0, 0, 0, 0.03);
		border-radius: 8px;
		margin-bottom: 1rem;
	}
	.date-editor label {
		display: flex;
		flex-direction: column;
		font-size: 0.85rem;
		gap: 0.25rem;
	}

	.section {
		margin-top: 2rem;
	}
	.section h2 {
		font-size: 1.1rem;
		margin: 0 0 0.75rem;
	}
	.empty {
		color: var(--text-muted, #777);
		font-style: italic;
		margin: 0 0 0.75rem;
	}

	.steps {
		list-style: none;
		padding: 0;
		margin: 0 0 1rem;
	}
	.step {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.6rem 0.5rem;
		border-bottom: 1px solid rgba(0, 0, 0, 0.06);
	}
	.step.done .step-title {
		text-decoration: line-through;
		color: var(--text-muted, #888);
	}
	.step-title { flex: 1; }

	.add-step {
		display: flex;
		gap: 0.5rem;
	}
	.add-step input {
		flex: 1;
		padding: 0.6rem 0.75rem;
		border: 1px solid rgba(0, 0, 0, 0.15);
		border-radius: 6px;
		font: inherit;
	}

	.files {
		list-style: none;
		padding: 0;
		margin: 0 0 0.75rem;
	}
	.file {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem;
		border-bottom: 1px solid rgba(0, 0, 0, 0.06);
	}
	.file a {
		flex: 1;
		text-decoration: none;
		color: var(--text, #222);
	}
	.file-size {
		font-size: 0.8rem;
		color: var(--text-muted, #888);
	}

	.upload { display: inline-block; cursor: pointer; }

	.chat-preview {
		background: rgba(0, 0, 0, 0.03);
		border-radius: 8px;
		padding: 0.75rem;
		margin: 0.5rem 0 1rem;
		font-size: 0.85rem;
	}
	.msg { margin-bottom: 0.4rem; }
	.msg-user strong { color: var(--accent, #4a7); }
	.msg-assistant strong { color: var(--text-muted, #666); }

	.primary {
		padding: 0.55rem 1rem;
		border: none;
		border-radius: 6px;
		background: var(--accent, #4a7);
		color: white;
		cursor: pointer;
		font: inherit;
	}
	.primary:disabled { opacity: 0.5; cursor: not-allowed; }
	.primary-link {
		display: inline-block;
		padding: 0.4rem 0.8rem;
		border-radius: 6px;
		background: rgba(0, 0, 0, 0.05);
		color: var(--text, #222);
		text-decoration: none;
		cursor: pointer;
		font-size: 0.9rem;
	}
	.link-btn {
		background: none;
		border: none;
		color: var(--text-muted, #666);
		text-decoration: underline;
		cursor: pointer;
		font: inherit;
		padding: 0;
	}
	.icon-btn {
		background: none;
		border: none;
		color: var(--text-muted, #888);
		cursor: pointer;
		font-size: 1.2rem;
		line-height: 1;
		padding: 0 0.3rem;
	}
	.icon-btn:hover { color: #c33; }
</style>
