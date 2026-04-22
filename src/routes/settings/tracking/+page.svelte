<script lang="ts">
	import { AppPage, Checkbox, PageHeader, Select } from '$lib/components/ui';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type Series = PageData['series'][number];
	type RecentEvent = PageData['recentEvents'][number];
	type ConfirmationPolicy = 'always' | 'low_confidence_only' | 'never';

	let seriesList = $state<Series[]>(structuredClone(data.series) as Series[]);
	let recentEvents = $state<RecentEvent[]>(structuredClone(data.recentEvents) as RecentEvent[]);
	let editingId = $state<string | null>(null);
	let saving = $state(false);
	let resultMsg = $state<{ id: string; ok: boolean; text: string } | null>(null);

	// Draft state for the item being edited
	let draftTitle = $state('');
	let draftAutoRegister = $state(false);
	let draftStatus = $state<'active' | 'paused' | 'archived'>('active');
	let draftConfirmationPolicy = $state<ConfirmationPolicy>('low_confidence_only');
	let draftPromptHints = $state('');

	function startEdit(s: Series) {
		editingId = s.id;
		draftTitle = s.title;
		draftAutoRegister = s.autoRegister;
		draftStatus = (s.status as 'active' | 'paused' | 'archived') ?? 'active';
		draftConfirmationPolicy = (s.confirmationPolicy as ConfirmationPolicy) ?? 'low_confidence_only';
		draftPromptHints = s.promptHints ?? '';
		resultMsg = null;
	}

	function cancelEdit() {
		editingId = null;
		resultMsg = null;
	}

	async function saveSeries() {
		if (!editingId || saving) return;
		saving = true;
		resultMsg = null;
		try {
			const res = await fetch('/api/settings/tracking', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					id: editingId,
					title: draftTitle,
					autoRegister: draftAutoRegister,
					status: draftStatus,
					confirmationPolicy: draftConfirmationPolicy,
					promptHints: draftPromptHints
				})
			});
			const payload = await res.json() as { series?: Series; error?: string };
			if (!res.ok) throw new Error(payload.error || 'Lagring feilet');
			seriesList = seriesList.map((s) => s.id === editingId ? (payload.series as Series) : s);
			resultMsg = { id: editingId, ok: true, text: 'Lagret.' };
			editingId = null;
		} catch (err) {
			resultMsg = {
				id: editingId ?? '',
				ok: false,
				text: err instanceof Error ? err.message : 'Ukjent feil'
			};
		} finally {
			saving = false;
		}
	}

	async function deleteSeries(id: string, title: string) {
		if (!confirm(`Slett "${title}"? Dette kan ikke angres.`)) return;
		const res = await fetch('/api/settings/tracking', {
			method: 'DELETE',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ id })
		});
		if (res.ok) {
			seriesList = seriesList.filter((s) => s.id !== id);
			if (editingId === id) editingId = null;
		}
	}

	async function deleteEvent(event: RecentEvent) {
		const label = event.taskTitle || event.seriesTitle || event.recordTypeKey;
		if (!confirm(`Slett registreringen for "${label}" fra ${formatDateTime(event.timestamp)}?`)) return;
		const res = await fetch('/api/settings/tracking', {
			method: 'DELETE',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ eventId: event.id })
		});
		if (res.ok) {
			recentEvents = recentEvents.filter((item) => item.id !== event.id);
		}
	}

	function statusLabel(s: string) {
		if (s === 'active') return 'Aktiv';
		if (s === 'paused') return 'Pauset';
		if (s === 'archived') return 'Arkivert';
		return s;
	}

	function policyLabel(p: string) {
		if (p === 'always') return 'Alltid bekreft';
		if (p === 'low_confidence_only') return 'Bekreft ved lav tillit';
		if (p === 'never') return 'Aldri bekreft';
		return p;
	}

	function formatDateTime(value: string | Date) {
		return new Date(value).toLocaleString('nb-NO', {
			dateStyle: 'short',
			timeStyle: 'short'
		});
	}

	const activeCount = $derived(seriesList.filter((s) => s.status === 'active').length);
</script>

<AppPage width="full" theme="dark" className="tracking-page">
	<PageHeader
		title="Tracking-serier"
		subtitle={`${activeCount} aktiv${activeCount === 1 ? '' : 'e'} serie${activeCount === 1 ? '' : 'r'}`}
		titleHref="/settings"
		titleLabel="Gå til innstillinger"
	/>

	<div class="tracking-content">

	{#if seriesList.length === 0}
		<section class="card empty-card">
			<p class="empty-text">Ingen tracking-serier ennå. De opprettes automatisk når du logger en aktivitet via chat eller bilde-triage.</p>
		</section>
	{:else}
		{#each seriesList as series (series.id)}
			{@const rtypeRaw = series.recordType}
			{@const rtype = rtypeRaw && !Array.isArray(rtypeRaw) ? (rtypeRaw as { key: string; kind: string; label: string }) : null}
			<section class="card series-card" class:is-archived={series.status === 'archived'}>
				{#if editingId === series.id}
					<div class="edit-form">
						<div class="field">
							<label class="field-label" for="edit-title-{series.id}">Tittel</label>
							<input
								id="edit-title-{series.id}"
								class="input"
								type="text"
								bind:value={draftTitle}
								placeholder="Seriebeskrivelse"
							/>
						</div>

						<div class="field">
							<label class="field-label" for="edit-status-{series.id}">Status</label>
							<Select id="edit-status-{series.id}" className="input" bind:value={draftStatus}>
								<option value="active">Aktiv</option>
								<option value="paused">Pauset</option>
								<option value="archived">Arkivert</option>
							</Select>
						</div>

						<div class="field">
							<label class="field-label" for="edit-policy-{series.id}">Bekreftelsespolicy</label>
							<Select id="edit-policy-{series.id}" className="input" bind:value={draftConfirmationPolicy}>
								<option value="always">Alltid bekreft manuelt</option>
								<option value="low_confidence_only">Bekreft kun ved lav tillit</option>
								<option value="never">Aldri bekreft (alltid auto)</option>
							</Select>
						</div>

						<div class="field check-field">
							<Checkbox id="edit-auto-{series.id}" bind:checked={draftAutoRegister} />
							<label for="edit-auto-{series.id}">Auto-registrer ved høy tillit (fra bilde-triage)</label>
						</div>

						<div class="field">
							<label class="field-label" for="edit-hints-{series.id}">Prompt-hint for AI</label>
							<textarea
								id="edit-hints-{series.id}"
								class="input hints-input"
								bind:value={draftPromptHints}
								placeholder="Valgfri beskrivelse som hjelper AI med matching, f.eks. 'morgenrutine på Strava-skjerm'"
							></textarea>
						</div>

						<div class="row">
							<button class="btn-primary" type="button" onclick={() => void saveSeries()} disabled={saving}>
								{saving ? 'Lagrer ...' : 'Lagre'}
							</button>
							<button class="btn-secondary" type="button" onclick={cancelEdit} disabled={saving}>Avbryt</button>
						</div>

						{#if resultMsg?.id === series.id}
							<p class={resultMsg?.ok ? 'ok' : 'err'}>{resultMsg?.text}</p>
						{/if}
					</div>
				{:else}
					<div class="series-head">
						<div class="series-meta">
							<span class="status-badge status-{series.status}">{statusLabel(series.status ?? '')}</span>
							{#if series.autoRegister}
								<span class="badge-auto">auto</span>
							{/if}
						</div>
						<h2 class="series-title">{series.title}</h2>
						{#if rtype}
							<p class="series-type">Type: <code>{rtype.key}</code> · {rtype.kind === 'measurement' ? 'måling' : 'aktivitet'}</p>
						{/if}
						<p class="series-policy">{policyLabel(series.confirmationPolicy ?? '')}</p>
						{#if series.promptHints}
							<p class="series-hints">Hint: {series.promptHints}</p>
						{/if}
						{#if series.lastUsedAt}
							<p class="series-last">Sist brukt: {new Date(series.lastUsedAt).toLocaleDateString('nb-NO')}</p>
						{/if}
					</div>
					<div class="row">
						<button class="btn-secondary" type="button" onclick={() => startEdit(series)}>Rediger</button>
						<button class="btn-danger" type="button" onclick={() => void deleteSeries(series.id, series.title)}>Slett</button>
					</div>
				{/if}
			</section>
		{/each}
	{/if}

	<section class="card info-card">
		<h2>Siste registreringer</h2>
		{#if recentEvents.length === 0}
			<p>Ingen tracking-registreringer funnet ennå.</p>
		{:else}
			<div class="event-list">
				{#each recentEvents as event (event.id)}
					<div class="event-row">
						<div class="event-copy">
							<p class="event-title">{event.taskTitle || event.seriesTitle || event.recordTypeKey}</p>
							<p class="event-meta">{formatDateTime(event.timestamp)} · type: {event.recordTypeKey}</p>
							{#if event.note}
								<p class="event-note">{event.note}</p>
							{/if}
						</div>
						<button class="btn-danger" type="button" onclick={() => void deleteEvent(event)}>Slett</button>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<section class="card info-card">
		<h2>Slik fungerer tracking-serier</h2>
		<p>Serier opprettes automatisk første gang du logger via chat eller bekrefter en bilde-triage. Det er ikke mulig å opprette tomme serier manuelt her.</p>
		<ul>
			<li><strong>Auto-registrer</strong>: Lar AI-triage lagre registreringer direkte uten bekreftelse ved høy tillit.</li>
			<li><strong>Bekreftelsespolicy</strong>: Styrer om triage ber om bekreftelse fra deg.</li>
			<li><strong>Prompt-hint</strong>: Hjelper AI matche bilder til riktig serie.</li>
		</ul>
	</section>
	</div>
</AppPage>

<style>
	:global(.tracking-page) { color: var(--text-secondary); }
	.tracking-content { display: flex; flex-direction: column; gap: 1rem; }
	.card {
		background: #171717;
		border: none;
		border-radius: 12px;
		padding: 1rem;
	}
	.card.is-archived { opacity: 0.55; }
	.btn-primary, .btn-secondary, .btn-danger { font-size: 0.875rem; }
	.row { display: flex; gap: 0.6rem; flex-wrap: wrap; margin-top: 0.7rem; }
	.field { margin-bottom: 0.85rem; }
	.field-label { display: block; margin-bottom: 0.35rem; font-size: 0.83rem; color: var(--text-tertiary); }
	.check-field { display: flex; align-items: center; gap: 0.55rem; }
	.check-field label { margin: 0; font-size: 0.9rem; color: var(--text-secondary); cursor: pointer; }
	.input { width: 100%; padding: 0.6rem; border: 1px solid #2a2a2a; border-radius: 8px; background: #111; color: var(--text-primary); box-sizing: border-box; }
	.hints-input { resize: vertical; min-height: 64px; font-family: inherit; }
	.ok { color: #4ade80; margin: 0.5rem 0 0; }
	.err { color: #f87171; margin: 0.5rem 0 0; }

	.series-head { margin-bottom: 0.6rem; }
	.series-meta { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.4rem; }
	.series-title { margin: 0 0 0.3rem; color: var(--text-primary); font-size: 1.05rem; }
	.series-type { margin: 0 0 0.2rem; font-size: 0.82rem; color: var(--text-tertiary); }
	.series-policy { margin: 0 0 0.2rem; font-size: 0.82rem; color: var(--text-tertiary); }
	.series-hints { margin: 0 0 0.2rem; font-size: 0.81rem; color: var(--text-tertiary); font-style: italic; }
	.series-last { margin: 0; font-size: 0.79rem; color: var(--text-tertiary); }

	.status-badge {
		font-size: 0.72rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 0.18rem 0.5rem;
		border-radius: 6px;
	}
	.status-active { background: color-mix(in oklab, #4ade80 12%, transparent); color: #4ade80; border: 1px solid color-mix(in oklab, #4ade80 30%, transparent); }
	.status-paused { background: color-mix(in oklab, #f0b429 12%, transparent); color: #f0b429; border: 1px solid color-mix(in oklab, #f0b429 30%, transparent); }
	.status-archived { background: color-mix(in oklab, #9ca3af 12%, transparent); color: #9ca3af; border: 1px solid color-mix(in oklab, #9ca3af 30%, transparent); }

	.badge-auto {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 0.15rem 0.45rem;
		border-radius: 6px;
		background: color-mix(in oklab, #7c8ef5 14%, transparent);
		color: #7c8ef5;
		border: 1px solid color-mix(in oklab, #7c8ef5 30%, transparent);
	}

	.btn-danger {
		padding: 0.4rem 0.7rem;
		border-radius: 8px;
		background: color-mix(in oklab, #ef4444 10%, transparent);
		border: 1px solid color-mix(in oklab, #ef4444 30%, transparent);
		color: #f87171;
		cursor: pointer;
		font-size: 0.875rem;
	}
	.btn-danger:hover { background: color-mix(in oklab, #ef4444 20%, transparent); }

	.empty-card { text-align: center; padding: 2rem 1rem; }
	.empty-text { color: var(--text-tertiary); margin: 0; }
	.event-list { display: flex; flex-direction: column; gap: 0.85rem; }
	.event-row { display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start; padding-top: 0.2rem; }
	.event-row + .event-row { border-top: 1px solid color-mix(in srgb, var(--border-color) 50%, transparent); padding-top: 0.95rem; }
	.event-copy { min-width: 0; }
	.event-title { margin: 0 0 0.2rem; color: var(--text-primary); font-size: 0.95rem; }
	.event-meta { margin: 0 0 0.2rem; color: var(--text-tertiary); font-size: 0.8rem; }
	.event-note { margin: 0; color: var(--text-secondary); font-size: 0.86rem; }

	.info-card h2 { margin-top: 0; color: var(--text-primary); font-size: 0.95rem; }
	.info-card p, .info-card li { font-size: 0.85rem; color: var(--text-tertiary); }
	.info-card ul { margin: 0.5rem 0 0; padding-left: 1.2rem; }
	.info-card li { margin-bottom: 0.35rem; }
</style>
