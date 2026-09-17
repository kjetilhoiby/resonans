<!--
  Arrangementer — konsert, teater, kamp.

  Ikke en oppgaveliste. Billetten er kjøpt måneder i forveien og datoen er satt
  av noen andre; det som gjenstår er forberedelsene rundt den. Derfor er kortet
  bygget rundt DATOEN og nedtellingen, med avkryssingene som en stripe under.

  Inngangen er billetten selv: et skjermbilde eller en PDF leses av modellen til
  et utkast brukeren bekrefter. Utkastet lagres ikke av seg selv — en feillest
  dato skal ikke ligge i lista som om noen hadde sett på den.
-->
<script lang="ts">
	import { AppPage, PageSection, PageHeader, Button, Input, DateInput, TimeInput, Textarea, Select, TabButton, Checkbox } from '$lib/components/ui';
	import {
		EVENT_KINDS,
		describeCountdown,
		eventKindMeta,
		formatEventDate,
		formatEventPlace,
		formatEventTime,
		splitByTime
	} from '$lib/domain/events/event-fields';
	import { describePrep, remainingSuggestions } from '$lib/domain/events/prep';
	import type { TicketDraft } from '$lib/domain/events/ticket-extraction';
	import type { EventRecord } from '$lib/domain/events/event-record';

	let { data } = $props();

	let events = $state<EventRecord[]>(data.events);
	let tab = $state<'upcoming' | 'past'>('upcoming');

	const split = $derived(splitByTime(events));
	const shown = $derived(tab === 'upcoming' ? split.upcoming : split.past);

	// ——— Skjema (nytt eller redigering) ———
	type Draft = {
		id: string | null;
		title: string;
		kind: string;
		eventDate: string;
		endDate: string;
		startTime: string;
		doorsTime: string;
		venue: string;
		address: string;
		entrance: string;
		seat: string;
		ticketCount: string;
		bookingReference: string;
		notes: string;
	};

	const EMPTY: Draft = {
		id: null, title: '', kind: '', eventDate: '', endDate: '', startTime: '', doorsTime: '',
		venue: '', address: '', entrance: '', seat: '', ticketCount: '', bookingReference: '', notes: ''
	};

	let form = $state<Draft | null>(null);
	let formTicket = $state<{ url: string; publicId: string; kind: string; name: string; mimeType: string; addedAt: string } | null>(null);
	let formExtracted = $state<Record<string, unknown> | null>(null);
	let formSource = $state<string>('manual');
	let formWarnings = $state<string[]>([]);
	let saving = $state(false);
	let reading = $state(false);
	let error = $state<string | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);

	function openNew() {
		form = { ...EMPTY };
		formTicket = null;
		formExtracted = null;
		formSource = 'manual';
		formWarnings = [];
		error = null;
	}

	function openEdit(event: EventRecord) {
		form = {
			id: event.id,
			title: event.title,
			kind: event.kind ?? '',
			eventDate: event.eventDate,
			endDate: event.endDate ?? '',
			startTime: event.startTime ?? '',
			doorsTime: event.doorsTime ?? '',
			venue: event.venue ?? '',
			address: event.address ?? '',
			entrance: event.entrance ?? '',
			seat: event.seat ?? '',
			ticketCount: event.ticketCount ? String(event.ticketCount) : '',
			bookingReference: event.bookingReference ?? '',
			notes: event.notes ?? ''
		};
		formTicket = null;
		formExtracted = null;
		formSource = event.extractionSource ?? 'manual';
		formWarnings = [];
		error = null;
	}

	function closeForm() {
		form = null;
		formWarnings = [];
		error = null;
	}

	/** Billetten leses til et utkast — ingenting lagres før brukeren trykker lagre. */
	async function readTicket(file: File) {
		reading = true;
		error = null;
		try {
			const body = new FormData();
			body.append('file', file);
			const res = await fetch('/api/arrangementer/les-billett', { method: 'POST', body });
			const payload = await res.json();
			if (!res.ok) {
				error = payload.error ?? 'Klarte ikke å lese billetten.';
				return;
			}

			const draft = payload.draft as TicketDraft;
			form = {
				id: null,
				title: draft.title ?? '',
				kind: draft.kind ?? '',
				eventDate: draft.eventDate ?? '',
				endDate: draft.endDate ?? '',
				startTime: draft.startTime ?? '',
				doorsTime: draft.doorsTime ?? '',
				venue: draft.venue ?? '',
				address: draft.address ?? '',
				entrance: draft.entrance ?? '',
				seat: draft.seat ?? '',
				ticketCount: draft.ticketCount ? String(draft.ticketCount) : '',
				bookingReference: draft.bookingReference ?? '',
				notes: draft.notes ?? ''
			};
			formTicket = payload.ticket ?? null;
			formExtracted = payload.raw ?? null;
			formSource = payload.ticket?.kind === 'image' ? 'image' : 'pdf';
			formWarnings = draft.warnings ?? [];
		} catch {
			error = 'Klarte ikke å lese billetten.';
		} finally {
			reading = false;
			if (fileInput) fileInput.value = '';
		}
	}

	async function save() {
		if (!form) return;
		saving = true;
		error = null;

		const payload: Record<string, unknown> = {
			title: form.title,
			kind: form.kind || null,
			eventDate: form.eventDate,
			endDate: form.endDate || null,
			startTime: form.startTime || null,
			doorsTime: form.doorsTime || null,
			venue: form.venue || null,
			address: form.address || null,
			entrance: form.entrance || null,
			seat: form.seat || null,
			ticketCount: form.ticketCount || null,
			bookingReference: form.bookingReference || null,
			notes: form.notes || null
		};

		try {
			if (form.id) {
				const res = await fetch(`/api/arrangementer/${form.id}`, {
					method: 'PATCH',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(payload)
				});
				const body = await res.json();
				if (!res.ok) { error = body.error ?? 'Klarte ikke å lagre.'; return; }
				events = events.map((e) => (e.id === body.event.id ? body.event : e));
			} else {
				if (formTicket) payload.tickets = [formTicket];
				if (formExtracted) payload.extracted = formExtracted;
				payload.extractionSource = formSource;
				const res = await fetch('/api/arrangementer', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(payload)
				});
				const body = await res.json();
				if (!res.ok) { error = body.error ?? 'Klarte ikke å lagre.'; return; }
				events = [...events, body.event];
				tab = 'upcoming';
			}
			closeForm();
		} catch {
			error = 'Klarte ikke å lagre.';
		} finally {
			saving = false;
		}
	}

	async function remove(id: string) {
		if (!confirm('Slette arrangementet?')) return;
		const res = await fetch(`/api/arrangementer/${id}`, { method: 'DELETE' });
		if (res.ok) events = events.filter((e) => e.id !== id);
	}

	async function prepAction(id: string, body: Record<string, unknown>) {
		const res = await fetch(`/api/arrangementer/${id}/forberedelser`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		if (!res.ok) return;
		const payload = await res.json();
		events = events.map((e) => (e.id === payload.event.id ? payload.event : e));
	}

	let addingPrepFor = $state<string | null>(null);
	let newPrepLabel = $state('');

	async function submitNewPrep(id: string) {
		const label = newPrepLabel.trim();
		if (!label) return;
		newPrepLabel = '';
		addingPrepFor = null;
		await prepAction(id, { action: 'add', label });
	}

	async function addTicketTo(event: EventRecord, file: File) {
		const body = new FormData();
		body.append('file', file);
		const res = await fetch(`/api/arrangementer/${event.id}/billetter`, { method: 'POST', body });
		if (!res.ok) return;
		const payload = await res.json();
		events = events.map((e) => (e.id === payload.event.id ? payload.event : e));
	}
</script>

<AppPage>
	<PageSection>
		<PageHeader title="Arrangementer" titleHref="/" emoji="🎟️" />

		<p class="intro">
			Billetter kjøpt i god tid — konsert, teater, kamp. Last opp billetten, så leses dato,
			klokkeslett og inngang ut av den. Transport og barnevakt hakes av etter hvert som de
			lander.
		</p>

		<div class="top-actions">
			<input
				type="file"
				accept="image/*,application/pdf"
				bind:this={fileInput}
				class="visually-hidden"
				data-track="arrangementer:les-billett"
				onchange={(e) => {
					const file = (e.currentTarget as HTMLInputElement).files?.[0];
					if (file) void readTicket(file);
				}}
			/>
			<Button variant="primary" disabled={reading} onClick={() => fileInput?.click()}>
				{reading ? 'Leser billetten…' : '📷 Last opp billett'}
			</Button>
			<Button variant="secondary" onClick={openNew}>Nytt arrangement</Button>
		</div>

		{#if error}<p class="error" role="alert">{error}</p>{/if}

		{#if form}
			<section class="form-card">
				<h2>{form.id ? 'Rediger arrangement' : 'Nytt arrangement'}</h2>

				{#if formTicket}
					<div class="form-ticket">
						{#if formTicket.kind === 'image'}
							<img src={formTicket.url} alt="Billett" loading="lazy" />
						{:else}
							<span class="doc-badge">📄</span>
						{/if}
						<span class="form-ticket-name">{formTicket.name}</span>
					</div>
				{/if}

				{#if formWarnings.length > 0}
					<ul class="warnings">
						{#each formWarnings as warning}<li>{warning}</li>{/each}
					</ul>
				{/if}

				<label class="field">
					<span>Hva</span>
					<Input bind:value={form.title} placeholder="Karpe — Omar Sheriff" dataTrack="arrangementer:tittel" />
				</label>

				<div class="row">
					<label class="field">
						<span>Type</span>
						<Select bind:value={form.kind}>
							<option value="">—</option>
							{#each EVENT_KINDS as kind}<option value={kind.key}>{kind.emoji} {kind.label}</option>{/each}
						</Select>
					</label>
					<label class="field">
						<span>Antall billetter</span>
						<Input bind:value={form.ticketCount} type="number" inputmode="numeric" min="1" dataTrack="arrangementer:antall" />
					</label>
				</div>

				<div class="row">
					<label class="field">
						<span>Dato</span>
						<DateInput bind:value={form.eventDate} dataTrack="arrangementer:dato" />
					</label>
					<label class="field">
						<span>Sluttdato <em>(flere dager)</em></span>
						<DateInput bind:value={form.endDate} dataTrack="arrangementer:sluttdato" />
					</label>
				</div>

				<div class="row">
					<label class="field">
						<span>Start</span>
						<TimeInput bind:value={form.startTime} />
					</label>
					<label class="field">
						<span>Dørene åpner</span>
						<TimeInput bind:value={form.doorsTime} />
					</label>
				</div>

				<label class="field">
					<span>Spillested</span>
					<Input bind:value={form.venue} placeholder="Oslo Spektrum" dataTrack="arrangementer:spillested" />
				</label>

				<div class="row">
					<label class="field">
						<span>Inngang</span>
						<Input bind:value={form.entrance} placeholder="Inngang C" dataTrack="arrangementer:inngang" />
					</label>
					<label class="field">
						<span>Plass</span>
						<Input bind:value={form.seat} placeholder="Rad 12, sete 5" dataTrack="arrangementer:plass" />
					</label>
				</div>

				<div class="row">
					<label class="field">
						<span>Adresse</span>
						<Input bind:value={form.address} dataTrack="arrangementer:adresse" />
					</label>
					<label class="field">
						<span>Bookingreferanse</span>
						<Input bind:value={form.bookingReference} dataTrack="arrangementer:booking" />
					</label>
				</div>

				<label class="field">
					<span>Notat</span>
					<Textarea bind:value={form.notes} rows={2} placeholder="Ta med legitimasjon" />
				</label>

				<div class="form-actions">
					<Button variant="primary" disabled={saving} onClick={save}>{saving ? 'Lagrer…' : 'Lagre'}</Button>
					<Button variant="ghost" onClick={closeForm}>Avbryt</Button>
				</div>
			</section>
		{/if}

		<div class="tabs">
			<TabButton active={tab === 'upcoming'} onClick={() => (tab = 'upcoming')}>
				Kommende{split.upcoming.length ? ` (${split.upcoming.length})` : ''}
			</TabButton>
			<TabButton active={tab === 'past'} onClick={() => (tab = 'past')}>
				Tidligere{split.past.length ? ` (${split.past.length})` : ''}
			</TabButton>
		</div>

		{#if shown.length === 0}
			<div class="empty">
				{#if tab === 'upcoming'}
					<p>Ingen arrangementer framover.</p>
					<p class="hint">Last opp et skjermbilde eller en PDF av en billett, så fylles feltene ut selv.</p>
				{:else}
					<p>Ingenting har vært ennå.</p>
				{/if}
			</div>
		{:else}
			<div class="cards">
				{#each shown as event (event.id)}
					{@const meta = eventKindMeta(event.kind)}
					{@const countdown = describeCountdown(event)}
					{@const place = formatEventPlace(event)}
					{@const time = formatEventTime(event)}
					{@const prepText = describePrep(event.prep)}
					<article class="event-card" class:cancelled={event.status === 'cancelled'}>
						<header class="card-head">
							<span class="kind-emoji" aria-hidden="true">{meta.emoji}</span>
							<div class="head-text">
								<h3>{event.title}</h3>
								<p class="when">
									{formatEventDate(event.eventDate)}
									{#if event.endDate && event.endDate > event.eventDate}– {formatEventDate(event.endDate)}{/if}
									{#if time}<span class="dot">·</span> {time}{/if}
								</p>
							</div>
							{#if countdown}<span class="countdown">{countdown}</span>{/if}
						</header>

						{#if place}<p class="place">{place}</p>{/if}
						{#if event.ticketCount}<p class="meta-line">{event.ticketCount} billetter{#if event.bookingReference} · {event.bookingReference}{/if}</p>
						{:else if event.bookingReference}<p class="meta-line">{event.bookingReference}</p>{/if}
						{#if event.notes}<p class="notes">{event.notes}</p>{/if}

						{#if event.tickets.length > 0}
							<div class="tickets">
								{#each event.tickets as ticket (ticket.url)}
									<a class="ticket" href={ticket.url} target="_blank" rel="noopener" title={ticket.name}>
										{#if ticket.kind === 'image'}
											<img src={ticket.url} alt="Billett" loading="lazy" />
										{:else}
											<span class="doc-badge">📄</span>
										{/if}
									</a>
								{/each}
							</div>
						{/if}

						<div class="prep">
							<div class="prep-head">
								<span class="prep-label">Forberedelser</span>
								{#if prepText}<span class="prep-standing" class:all-done={prepText === 'Alt klart'}>{prepText}</span>{/if}
							</div>
							<ul class="prep-list">
								{#each event.prep as item (item.id)}
									<li class="prep-item" class:done={item.done}>
										<Checkbox
											checked={item.done}
											ariaLabel={item.label}
											dataTrack="arrangementer:forberedelse"
											onChange={() => prepAction(event.id, { action: 'toggle', id: item.id, done: !item.done })}
										/>
										<span class="prep-text">{item.label}</span>
										<button
											class="prep-remove"
											aria-label="Fjern {item.label}"
											onclick={() => prepAction(event.id, { action: 'remove', id: item.id })}
										>✕</button>
									</li>
								{/each}
							</ul>

							<div class="prep-add">
								{#each remainingSuggestions(event.prep) as suggestion}
									<button
										class="suggestion"
										data-track="arrangementer:forslag"
										onclick={() => prepAction(event.id, { action: 'add', label: suggestion.label })}
									>+ {suggestion.label}</button>
								{/each}
								{#if addingPrepFor === event.id}
									<input
										class="prep-input"
										bind:value={newPrepLabel}
										placeholder="Eget punkt"
										aria-label="Nytt forberedelsespunkt"
										data-track="arrangementer:eget-punkt"
										onkeydown={(e) => { if (e.key === 'Enter') void submitNewPrep(event.id); if (e.key === 'Escape') addingPrepFor = null; }}
										onblur={() => void submitNewPrep(event.id)}
									/>
								{:else}
									<button class="suggestion" onclick={() => { addingPrepFor = event.id; newPrepLabel = ''; }}>+ Eget</button>
								{/if}
							</div>
						</div>

						<footer class="card-actions">
							<button class="link-btn" onclick={() => openEdit(event)}>Rediger</button>
							<label class="link-btn file-btn">
								Legg til billett
								<input
									type="file"
									accept="image/*,application/pdf"
									class="visually-hidden"
									onchange={(e) => {
										const file = (e.currentTarget as HTMLInputElement).files?.[0];
										if (file) void addTicketTo(event, file);
										(e.currentTarget as HTMLInputElement).value = '';
									}}
								/>
							</label>
							<button class="link-btn danger" onclick={() => remove(event.id)}>Slett</button>
						</footer>
					</article>
				{/each}
			</div>
		{/if}
	</PageSection>
</AppPage>

<style>
	.intro {
		margin: 0 0 1rem;
		font-size: 0.85rem;
		line-height: 1.5;
		color: var(--text-secondary);
	}
	.top-actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
		border: 0;
	}
	.error {
		margin: 0 0 1rem;
		padding: 0.6rem 0.75rem;
		border-radius: 10px;
		background: rgba(239, 68, 68, 0.12);
		color: #fca5a5;
		font-size: 0.82rem;
	}

	.form-card {
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
		border-radius: 16px;
		padding: 1rem;
		margin-bottom: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}
	.form-card h2 {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--text-primary);
	}
	.form-ticket {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-size: 0.78rem;
		color: var(--text-secondary);
	}
	.form-ticket img {
		width: 56px;
		height: 56px;
		object-fit: cover;
		border-radius: 8px;
	}
	.form-ticket-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.warnings {
		margin: 0;
		padding: 0.55rem 0.75rem 0.55rem 1.6rem;
		border-radius: 10px;
		background: rgba(245, 158, 11, 0.12);
		color: #fcd34d;
		font-size: 0.78rem;
		line-height: 1.45;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		flex: 1;
		min-width: 0;
	}
	.field > span {
		font-size: 0.74rem;
		color: var(--text-tertiary, var(--text-secondary));
	}
	.field em {
		font-style: normal;
		opacity: 0.65;
	}
	.row {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.form-actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.2rem;
	}

	.tabs {
		display: flex;
		gap: 0.4rem;
		margin-bottom: 0.9rem;
	}
	.empty {
		padding: 2rem 1rem;
		text-align: center;
		color: var(--text-secondary);
		font-size: 0.85rem;
	}
	.empty .hint {
		font-size: 0.78rem;
		opacity: 0.75;
	}

	.cards {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
	}
	.event-card {
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
		border-radius: 16px;
		padding: 0.9rem;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}
	.event-card.cancelled {
		opacity: 0.5;
	}
	.card-head {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
	}
	.kind-emoji {
		font-size: 1.2rem;
		line-height: 1.3;
	}
	.head-text {
		flex: 1;
		min-width: 0;
	}
	.head-text h3 {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--text-primary);
		line-height: 1.3;
	}
	.when {
		margin: 0.15rem 0 0;
		font-size: 0.8rem;
		color: var(--text-secondary);
	}
	.dot {
		opacity: 0.5;
	}
	.countdown {
		flex-shrink: 0;
		font-size: 0.72rem;
		padding: 0.2rem 0.5rem;
		border-radius: 999px;
		background: rgba(155, 143, 245, 0.16);
		color: #b6acff;
		white-space: nowrap;
	}
	.place,
	.meta-line,
	.notes {
		margin: 0;
		font-size: 0.8rem;
		color: var(--text-secondary);
		line-height: 1.45;
	}
	.notes {
		opacity: 0.8;
	}

	.tickets {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.ticket img {
		width: 60px;
		height: 60px;
		object-fit: cover;
		border-radius: 8px;
		display: block;
	}
	.doc-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 60px;
		height: 60px;
		border-radius: 8px;
		background: var(--bg-tertiary, rgba(255, 255, 255, 0.06));
		font-size: 1.3rem;
	}

	.prep {
		border-top: 1px solid var(--border-subtle);
		padding-top: 0.6rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.prep-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.prep-label {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-tertiary, var(--text-secondary));
	}
	.prep-standing {
		font-size: 0.75rem;
		color: #fcd34d;
	}
	.prep-standing.all-done {
		color: #86efac;
	}
	.prep-list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.prep-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.82rem;
		color: var(--text-primary);
	}
	.prep-item.done .prep-text {
		opacity: 0.45;
		text-decoration: line-through;
	}
	.prep-text {
		flex: 1;
	}
	.prep-remove {
		background: none;
		border: none;
		color: var(--text-secondary);
		opacity: 0.4;
		cursor: pointer;
		font-size: 0.75rem;
		padding: 0.2rem 0.3rem;
	}
	.prep-remove:hover {
		opacity: 0.9;
	}
	.prep-add {
		display: flex;
		gap: 0.35rem;
		flex-wrap: wrap;
	}
	.suggestion {
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid var(--border-subtle);
		color: var(--text-secondary);
		border-radius: 999px;
		padding: 0.18rem 0.55rem;
		font-size: 0.72rem;
		cursor: pointer;
	}
	.suggestion:hover {
		color: var(--text-primary);
	}
	.prep-input {
		background: var(--bg-tertiary, rgba(255, 255, 255, 0.06));
		border: 1px solid var(--border-subtle);
		border-radius: 999px;
		padding: 0.18rem 0.6rem;
		font-size: 0.72rem;
		color: var(--text-primary);
		min-width: 9rem;
	}

	.card-actions {
		display: flex;
		gap: 0.75rem;
		padding-top: 0.2rem;
	}
	.link-btn {
		background: none;
		border: none;
		padding: 0;
		font-size: 0.76rem;
		color: var(--text-secondary);
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.link-btn:hover {
		color: var(--text-primary);
	}
	.link-btn.danger:hover {
		color: #fca5a5;
	}
	.file-btn {
		display: inline-flex;
	}
</style>
