<!--
  ThemeKontakterTab — Kontakter-fanen for kommunikasjons-/arrangement-prosjekter.
  Erstatter kappliste for prosjekter som handler om å purre, samle kontaktinfo og
  ta noen telefoner/mailer. Hver kontakt har status (todo/venter/ferdig) og en
  oppfølgingsdato som driver purre-nudgen. «Chat»-knappen lar AI-en formulere en
  e-post eller et samtalenotat mot kontakten.
-->
<script module lang="ts">
	export interface ProjectContact {
		id: string;
		name: string;
		role: string | null;
		phone: string | null;
		email: string | null;
		status: 'todo' | 'venter' | 'ferdig';
		notes: string | null;
		followUpAt: string | null;
		lastContactedAt: string | null;
		sortOrder: number;
		createdAt: string;
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import DateInput from '$lib/components/ui/DateInput.svelte';

	interface Props {
		themeId: string;
		projectName?: string;
		initialContacts?: ProjectContact[];
		onSwitchToChat?: (draft?: string) => void;
	}

	let { themeId, projectName = '', initialContacts = [], onSwitchToChat }: Props = $props();

	const STATUS_LABEL: Record<ProjectContact['status'], string> = {
		todo: 'Ikke kontaktet',
		venter: 'Venter på svar',
		ferdig: 'Avklart'
	};
	// Klikk på status-pillen sykler videre til neste steg.
	const NEXT_STATUS: Record<ProjectContact['status'], ProjectContact['status']> = {
		todo: 'venter',
		venter: 'ferdig',
		ferdig: 'todo'
	};

	let contacts = $state<ProjectContact[]>(initialContacts);
	let newName = $state('');
	let adding = $state(false);

	// Re-hent ved mount (fanen re-monteres ved tab-bytte) så endringer fra chatten vises.
	onMount(async () => {
		try {
			const res = await fetch(`/api/tema/${themeId}/kontakter`);
			if (res.ok) {
				const { contacts: rows } = await res.json();
				contacts = rows;
			}
		} catch {
			/* behold initialContacts ved feil */
		}
	});

	const todayISO = new Date().toISOString().slice(0, 10);
	function isOverdue(c: ProjectContact): boolean {
		return c.status !== 'ferdig' && !!c.followUpAt && c.followUpAt <= todayISO;
	}
	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' });
	}

	const sorted = $derived([...contacts].sort((a, b) => a.sortOrder - b.sortOrder));
	const openCount = $derived(contacts.filter((c) => c.status !== 'ferdig').length);
	const dueCount = $derived(contacts.filter((c) => isOverdue(c)).length);

	async function addContact() {
		const name = newName.trim();
		if (!name || adding) return;
		adding = true;
		try {
			const res = await fetch(`/api/tema/${themeId}/kontakter`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name })
			});
			if (res.ok) {
				const { contact } = await res.json();
				contacts = [...contacts, contact];
				newName = '';
			}
		} finally {
			adding = false;
		}
	}

	async function patch(contactId: string, payload: Record<string, unknown>) {
		const res = await fetch(`/api/tema/${themeId}/kontakter`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ contactId, ...payload })
		});
		if (res.ok) {
			const { contact } = await res.json();
			contacts = contacts.map((c) => (c.id === contactId ? contact : c));
		}
	}

	function cycleStatus(c: ProjectContact) {
		const next = NEXT_STATUS[c.status];
		// Optimistisk
		contacts = contacts.map((x) => (x.id === c.id ? { ...x, status: next } : x));
		void patch(c.id, { status: next });
	}

	async function removeContact(c: ProjectContact) {
		contacts = contacts.filter((x) => x.id !== c.id);
		await fetch(`/api/tema/${themeId}/kontakter`, {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ contactId: c.id })
		});
	}

	function draftFor(c: ProjectContact) {
		const bits = [c.name];
		if (c.role) bits.push(`(${c.role})`);
		const who = bits.join(' ');
		onSwitchToChat?.(
			`Hjelp meg å følge opp ${who} i prosjektet «${projectName}». ` +
				`Foreslå en kort, vennlig melding${c.email ? ' (e-post)' : ''} og hva jeg bør spørre om.`
		);
	}

	/* ── Redigering ───────────────────────────────────── */
	let editItem = $state<ProjectContact | null>(null);
	let editName = $state('');
	let editRole = $state('');
	let editPhone = $state('');
	let editEmail = $state('');
	let editNotes = $state('');
	let editFollowUp = $state('');

	function openEdit(c: ProjectContact) {
		editItem = c;
		editName = c.name;
		editRole = c.role ?? '';
		editPhone = c.phone ?? '';
		editEmail = c.email ?? '';
		editNotes = c.notes ?? '';
		editFollowUp = c.followUpAt ?? '';
	}
	async function saveEdit() {
		if (!editItem) return;
		const id = editItem.id;
		await patch(id, {
			name: editName.trim() || editItem.name,
			role: editRole.trim() || null,
			phone: editPhone.trim() || null,
			email: editEmail.trim() || null,
			notes: editNotes.trim() || null,
			followUpAt: editFollowUp || null
		});
		editItem = null;
	}
</script>

<div class="contacts">
	<p class="lead">
		For prosjekter som mest handler om å følge opp folk. Legg inn hvem som skal kontaktes, sett en
		oppfølgingsdato — så minner Resonans deg på å purre.
	</p>

	{#if contacts.length > 0}
		<div class="summary">
			<span>{openCount} åpne</span>
			{#if dueCount > 0}<span class="due">· {dueCount} til oppfølging</span>{/if}
		</div>
	{/if}

	{#if contacts.length === 0}
		<p class="empty">Ingen kontakter ennå. Legg til den første under.</p>
	{:else}
		<ul class="list">
			{#each sorted as c (c.id)}
				<li class="card" class:done={c.status === 'ferdig'}>
					<div class="card-head">
						<div class="who">
							<span class="name">{c.name}</span>
							{#if c.role}<span class="role">{c.role}</span>{/if}
						</div>
						<button
							class="status-pill status-{c.status}"
							data-track="prosjekt-kontakter:status"
							aria-label={`Status: ${STATUS_LABEL[c.status]}. Trykk for å endre.`}
							onclick={() => cycleStatus(c)}
						>{STATUS_LABEL[c.status]}</button>
					</div>

					<div class="badges">
						{#if c.followUpAt}
							<span class="badge" class:overdue={isOverdue(c)}>
								{isOverdue(c) ? '⏰ purr' : 'oppfølging'} {formatDate(c.followUpAt)}
							</span>
						{/if}
						{#if c.lastContactedAt}
							<span class="badge muted">sist kontakt {formatDate(c.lastContactedAt)}</span>
						{/if}
					</div>

					{#if c.notes}<p class="notes">{c.notes}</p>{/if}

					<div class="actions">
						{#if c.phone}
							<a class="act" href={`tel:${c.phone}`} data-track="prosjekt-kontakter:ring">📞 Ring</a>
						{/if}
						{#if c.email}
							<a class="act" href={`mailto:${c.email}`} data-track="prosjekt-kontakter:mail">✉️ E-post</a>
						{/if}
						{#if onSwitchToChat}
							<button class="act" data-track="prosjekt-kontakter:utkast" onclick={() => draftFor(c)}>✨ Utkast</button>
						{/if}
						<button class="act ghost" data-track="prosjekt-kontakter:rediger" onclick={() => openEdit(c)}>Rediger</button>
						<button class="act ghost danger" data-track="prosjekt-kontakter:slett" aria-label={`Slett ${c.name}`} onclick={() => removeContact(c)}>Slett</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	<form class="new" onsubmit={(e) => { e.preventDefault(); addContact(); }}>
		<input
			type="text"
			placeholder="Ny kontakt (navn) …"
			data-track="prosjekt-kontakter:ny-kontakt-navn"
			bind:value={newName}
			disabled={adding}
		/>
		<button type="submit" class="add-btn" disabled={adding || !newName.trim()}>Legg til</button>
	</form>

	{#if onSwitchToChat}
		<button class="chat-btn" data-track="prosjekt-kontakter:chat-prosjekt" onclick={() => onSwitchToChat?.()}>💬 Chat om oppfølging</button>
	{/if}
</div>

{#if editItem}
	<div
		class="edit-overlay"
		role="button"
		tabindex="0"
		onclick={(e) => { if (e.target === e.currentTarget) editItem = null; }}
		onkeydown={(e) => { if (e.key === 'Escape') editItem = null; }}
	>
		<div class="edit-sheet">
			<h3>Rediger kontakt</h3>
			<label class="field">
				<span>Navn</span>
				<input type="text" data-track="prosjekt-kontakter:rediger-navn" bind:value={editName} />
			</label>
			<label class="field">
				<span>Rolle</span>
				<input type="text" placeholder="f.eks. Rørlegger, Nabo" data-track="prosjekt-kontakter:rediger-rolle" bind:value={editRole} />
			</label>
			<label class="field">
				<span>Telefon</span>
				<input type="tel" data-track="prosjekt-kontakter:rediger-telefon" bind:value={editPhone} />
			</label>
			<label class="field">
				<span>E-post</span>
				<input type="email" data-track="prosjekt-kontakter:rediger-epost" bind:value={editEmail} />
			</label>
			<label class="field">
				<span>Oppfølging (purredato)</span>
				<DateInput ariaLabel="prosjekt-kontakter:oppfolging" bind:value={editFollowUp} />
			</label>
			<label class="field">
				<span>Notat</span>
				<textarea rows="3" data-track="prosjekt-kontakter:rediger-notat" bind:value={editNotes}></textarea>
			</label>
			<div class="edit-actions">
				<button class="ghost-btn" data-track="prosjekt-kontakter:rediger-avbryt" onclick={() => (editItem = null)}>Avbryt</button>
				<button class="save-btn" data-track="prosjekt-kontakter:rediger-lagre" onclick={saveEdit}>Lagre</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.contacts {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1rem var(--page-px);
		width: 100%;
	}
	.lead {
		font-size: 0.85rem;
		color: var(--text-secondary);
		margin: 0;
	}
	.summary {
		font-size: 0.8rem;
		color: var(--text-secondary);
	}
	.summary .due {
		color: #e07070;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem 0.85rem;
		background: var(--card-bg);
		border: 1px solid var(--card-border);
		border-radius: 12px;
	}
	.card.done {
		opacity: 0.6;
	}
	.card-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.6rem;
	}
	.who {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
	}
	.name {
		font-size: 0.95rem;
		font-weight: 500;
	}
	.role {
		font-size: 0.78rem;
		color: var(--text-tertiary);
	}
	.status-pill {
		flex-shrink: 0;
		font-size: 0.72rem;
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		border: 1px solid var(--border-color);
		background: var(--bg-hover);
		color: var(--text-secondary);
		font-family: inherit;
		cursor: pointer;
	}
	.status-pill.status-venter {
		background: rgba(250, 204, 21, 0.12);
		color: #eab308;
		border-color: transparent;
	}
	.status-pill.status-ferdig {
		background: rgba(74, 222, 128, 0.12);
		color: var(--success-text);
		border-color: transparent;
	}
	.badges {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	.badge {
		font-size: 0.72rem;
		padding: 0.1rem 0.45rem;
		border-radius: 999px;
		background: var(--bg-hover);
		color: var(--text-secondary);
	}
	.badge.muted {
		color: var(--text-tertiary);
	}
	.badge.overdue {
		background: rgba(224, 112, 112, 0.15);
		color: #e07070;
	}
	.notes {
		font-size: 0.83rem;
		color: var(--text-secondary);
		margin: 0;
		white-space: pre-wrap;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.act {
		font-size: 0.78rem;
		padding: 0.35rem 0.7rem;
		border-radius: 999px;
		border: 1px solid var(--accent-primary);
		background: transparent;
		color: var(--accent-light);
		font-family: inherit;
		cursor: pointer;
		text-decoration: none;
	}
	.act:hover {
		background: var(--bg-hover);
	}
	.act.ghost {
		border-color: var(--border-color);
		color: var(--text-secondary);
	}
	.act.ghost.danger:hover {
		border-color: #e07070;
		color: #e07070;
	}
	.new {
		display: flex;
		gap: 0.5rem;
	}
	.new input {
		flex: 1;
		border: 1px dashed var(--border-color);
		border-radius: 8px;
		background: transparent;
		color: inherit;
		font: inherit;
		font-size: 0.9rem;
		padding: 0.5rem 0.7rem;
	}
	.new input:focus {
		outline: none;
		background: var(--bg-input);
	}
	.add-btn {
		padding: 0.5rem 1rem;
		border-radius: 8px;
		border: 0;
		background: var(--accent-primary);
		color: #fff;
		font: inherit;
		font-size: 0.85rem;
		font-weight: 500;
		cursor: pointer;
	}
	.add-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.empty {
		text-align: center;
		color: var(--text-secondary);
		font-size: 0.9rem;
		padding: 0.5rem 0;
	}
	.chat-btn {
		align-self: center;
		padding: 0.55rem 1.1rem;
		border-radius: 999px;
		border: 1px solid var(--accent-primary);
		background: transparent;
		color: var(--accent-light);
		font: inherit;
		font-size: 0.85rem;
		font-weight: 500;
		cursor: pointer;
	}
	.chat-btn:hover {
		background: var(--bg-hover);
	}

	/* Edit sheet — samme skall som ThemeTasksTab */
	.edit-overlay {
		position: fixed;
		inset: 0;
		background: var(--bg-overlay);
		display: flex;
		align-items: flex-end;
		justify-content: center;
		z-index: 400;
	}
	.edit-sheet {
		width: 100%;
		max-width: 480px;
		background: var(--bg-elevated);
		border: 1px solid var(--border-color);
		border-radius: 16px 16px 0 0;
		padding: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		max-height: 85vh;
		overflow-y: auto;
	}
	.edit-sheet h3 {
		margin: 0;
		font-size: 1rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.field > span {
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--text-secondary);
	}
	.field input,
	.field textarea {
		padding: 0.55rem 0.7rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: var(--bg-input);
		color: inherit;
		font: inherit;
		font-size: 0.9rem;
	}
	.field textarea {
		resize: vertical;
	}
	.edit-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}
	.ghost-btn {
		padding: 0.55rem 1rem;
		border-radius: 999px;
		border: 1px solid var(--border-color);
		background: transparent;
		color: var(--text-secondary);
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
	}
	.save-btn {
		padding: 0.55rem 1.2rem;
		border-radius: 8px;
		border: 0;
		background: var(--accent-primary);
		color: #fff;
		font: inherit;
		font-size: 0.9rem;
		font-weight: 500;
		cursor: pointer;
	}
</style>
