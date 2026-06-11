<script lang="ts">
	import { AppPage, PageHeader, Button, Select, PageSection, CardTitle } from '$lib/components/ui';
	import ScreenTimeCard from '$lib/components/composed/ScreenTimeCard.svelte';
	import { invalidateAll } from '$app/navigation';
	import { mondayOfWeekISO, previousWeekMondayISO } from '$lib/utils/screen-time-series';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	function fmt(min: number | null | undefined): string {
		if (typeof min !== 'number' || !Number.isFinite(min) || min <= 0) return '0m';
		const h = Math.floor(min / 60);
		const m = Math.round(min % 60);
		if (h <= 0) return `${m}m`;
		if (m <= 0) return `${h}t`;
		return `${h}t ${m}m`;
	}

	/* ── Ukevelger ────────────────────────────────────────── */
	// weeks er nyeste først. index+1 = eldre uke, index-1 = nyere.
	let selectedIndex = $state(data.defaultIndex ?? 0);
	$effect(() => {
		if (selectedIndex > data.weeks.length - 1) selectedIndex = Math.max(0, data.weeks.length - 1);
	});
	const current = $derived(data.weeks[selectedIndex] ?? null);
	const prevMetric = $derived(data.weeks[selectedIndex + 1]?.metric ?? null);
	const canOlder = $derived(selectedIndex < data.weeks.length - 1);
	const canNewer = $derived(selectedIndex > 0);

	// Referanselinjer i den akkumulerte grafen: de fire ukene før valgt uke.
	const cumulativeRefs = $derived(
		data.weeks
			.slice(selectedIndex + 1, selectedIndex + 5)
			.map((w) => w.cumulativeSeries)
			.filter((s) => Array.isArray(s) && s.length > 1)
	);

	/* ── Opplasting + tolking (kø av flere bilder) ────────── */
	interface UploadItem {
		id: string;
		file: File | null;
		name: string;
		status: 'klar' | 'laster-opp' | 'tolker' | 'tolket' | 'lagrer' | 'feil';
		error: string | null;
		preview: any | null;
		dateISO: string;
		weekStartISO: string;
	}

	let queue = $state<UploadItem[]>([]);
	let analyzing = $state(false);
	let savingAll = $state(false);
	let error = $state<string | null>(null);

	const pendingCount = $derived(queue.filter((i) => i.status === 'klar').length);
	const parsedCount = $derived(queue.filter((i) => i.status === 'tolket').length);
	const busy = $derived(analyzing || savingAll);

	function onFilesSelected(e: Event) {
		const input = e.target as HTMLInputElement;
		for (const file of Array.from(input.files ?? [])) {
			queue.push({
				id: crypto.randomUUID(),
				file,
				name: file.name,
				status: 'klar',
				error: null,
				preview: null,
				dateISO: '',
				weekStartISO: ''
			});
		}
		input.value = '';
	}

	function removeItem(id: string) {
		queue = queue.filter((i) => i.id !== id);
	}

	function statusLabel(item: UploadItem): string {
		switch (item.status) {
			case 'klar':
				return 'Klar til analyse';
			case 'laster-opp':
				return 'Laster opp…';
			case 'tolker':
				return 'Tolker…';
			case 'tolket':
				return `Tolket (${item.preview?.confidence ?? '?'})`;
			case 'lagrer':
				return 'Lagrer…';
			case 'feil':
				return 'Feil';
		}
	}

	async function analyzeAll() {
		analyzing = true;
		error = null;
		try {
			for (const item of queue) {
				if (item.status !== 'klar' || !item.file) continue;
				try {
					item.status = 'laster-opp';
					const fd = new FormData();
					fd.append('image', item.file);
					const up = await fetch('/api/upload-image', { method: 'POST', body: fd });
					const upJson = await up.json();
					if (!up.ok || !upJson.url) throw new Error(upJson.error || 'Opplasting feilet');
					item.status = 'tolker';
					const res = await fetch('/api/sensors/screen-time/parse', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ imageUrl: upJson.url })
					});
					const json = await res.json();
					if (!json.success) throw new Error(json.message || 'Klarte ikke å tolke bildet');
					item.preview = json.parsed;
					if (json.parsed.kind === 'daily') {
						item.dateISO = json.parsed.dateISO ?? '';
					} else {
						// Ukesbilder mangler dato i bildet — foreslå forrige uke (vanligste tilfelle).
						item.weekStartISO = previousWeekMondayISO();
					}
					item.file = null;
					item.status = 'tolket';
				} catch (err) {
					item.status = 'feil';
					item.error = err instanceof Error ? err.message : 'Noe gikk galt';
				}
			}
		} finally {
			analyzing = false;
		}
	}

	async function saveAll() {
		savingAll = true;
		error = null;
		const savedIds: string[] = [];
		try {
			for (const item of queue) {
				if (item.status !== 'tolket' || !item.preview) continue;
				try {
					if (item.preview.kind === 'daily' && !item.dateISO) {
						throw new Error('Sett dato før lagring');
					}
					item.status = 'lagrer';
					const body =
						item.preview.kind === 'weekly'
							? {
									kind: 'weekly',
									weekly: item.preview.weekly,
									// Snapp valgfri dato i uka til mandag.
									weekStartISO: item.weekStartISO
										? (mondayOfWeekISO(item.weekStartISO) ?? undefined)
										: undefined
								}
							: { kind: 'daily', daily: item.preview.daily, dateISO: item.dateISO };
					const res = await fetch('/api/sensors/screen-time/ingest', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify(body)
					});
					const json = await res.json();
					if (!res.ok || !json.success) throw new Error(json.error || 'Lagring feilet');
					savedIds.push(item.id);
				} catch (err) {
					item.status = 'tolket';
					item.error = err instanceof Error ? err.message : 'Lagring feilet';
				}
			}
		} finally {
			queue = queue.filter((i) => !savedIds.includes(i.id));
			savingAll = false;
		}
		if (savedIds.length > 0) await invalidateAll();
	}

	/* ── Mål ──────────────────────────────────────────────── */
	let showGoalForm = $state(false);
	let goalKind = $state('total');
	let goalBasis = $state('day_avg');
	let goalHours = $state(5);
	let goalMinutes = $state(0);
	let goalFromHour = $state(16);
	let goalToHour = $state(20);
	let goalWindowCategory = $state('social');
	let goalSaving = $state(false);

	async function createGoal() {
		goalSaving = true;
		error = null;
		try {
			const targetMinutes = goalHours * 60 + goalMinutes;
			const body: Record<string, unknown> = { kind: goalKind, targetMinutes };
			if (goalKind === 'window') {
				body.fromHour = goalFromHour;
				body.toHour = goalToHour;
				body.windowCategory = goalWindowCategory;
			} else {
				body.basis = goalBasis;
			}
			const res = await fetch('/api/sensors/screen-time/goals', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			const json = await res.json();
			if (!res.ok || !json.success) throw new Error(json.error || 'Kunne ikke lage mål');
			showGoalForm = false;
			await invalidateAll();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Kunne ikke lage mål';
		} finally {
			goalSaving = false;
		}
	}

	async function deleteGoal(id: string) {
		await fetch(`/api/sensors/screen-time/goals/${id}`, { method: 'DELETE' });
		await invalidateAll();
	}

	/* ── Slett data ───────────────────────────────────────── */
	let deleting = $state(false);

	async function deleteWeek() {
		if (!current) return;
		if (!confirm(`Slette skjermtid for ${current.label}?`)) return;
		deleting = true;
		try {
			await fetch(`/api/sensors/screen-time/data?scope=week&weekStart=${current.weekStartISO}`, {
				method: 'DELETE'
			});
			await invalidateAll();
		} finally {
			deleting = false;
		}
	}

	async function deleteAll() {
		if (!confirm('Slette ALL skjermtid-data? Dette kan ikke angres.')) return;
		deleting = true;
		try {
			await fetch('/api/sensors/screen-time/data?scope=all', { method: 'DELETE' });
			selectedIndex = 0;
			await invalidateAll();
		} finally {
			deleting = false;
		}
	}
</script>

<svelte:head>
	<title>Skjermtid · Resonans</title>
</svelte:head>

<AppPage>
	<PageSection>
	<PageHeader title="Skjermtid" titleHref="/" />

	{#if error}
		<p class="error">{error}</p>
	{/if}

	{#if current}
		<div class="week-nav">
			<button class="week-arrow" onclick={() => (selectedIndex += 1)} disabled={!canOlder} aria-label="Eldre uke">‹</button>
			<div class="week-label">
				<span class="week-range">{current.label}</span>
				<span class="week-sub">
					{selectedIndex === 0 ? 'Siste uke' : `${selectedIndex} uke${selectedIndex === 1 ? '' : 'r'} siden`}
					{#if !current.hasWeekScreenshot}· pågår / kun dagsbilder{/if}
				</span>
			</div>
			<button class="week-arrow" onclick={() => (selectedIndex -= 1)} disabled={!canNewer} aria-label="Nyere uke">›</button>
		</div>
	{/if}

	<ScreenTimeCard
		thisWeek={current?.metric ?? null}
		prevWeek={prevMetric}
		goals={current?.goals ?? []}
		weekDays={current?.weekDays ?? []}
		categoryLabels={data.categoryLabels}
		cumulative={current?.cumulativeSeries ?? []}
		{cumulativeRefs}
	/>

	{#if current}
		<div class="week-actions">
			<button class="link-danger" onclick={deleteWeek} disabled={deleting}>Slett denne uka</button>
		</div>
	{/if}

	{#if current && current.topApps.length > 0}
		<section class="block">
			<CardTitle>Mest brukt ({current.label})</CardTitle>
			<div class="apps">
				{#each current.topApps as app}
					<div class="app-row">
						<span class="app-name">{app.name}</span>
						<span class="app-min">{fmt(app.minutes)}</span>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Opplasting -->
	<section class="block">
		<CardTitle>Legg inn skjermbilder</CardTitle>
		<p class="muted">
			Velg ett eller flere iOS Skjermtid-skjermbilder — ukesbilder (Uke-fanen) og/eller dagsbilder
			(Dag-fanen). AI-en tolker tallene; ukesbilder trenger riktig ukedato før lagring.
		</p>

		<label class="upload">
			<input
				type="file"
				accept="image/*"
				multiple
				onchange={onFilesSelected}
				disabled={busy}
				data-track="skjermtid:velg-skjermbilder"
			/>
			<span>📷 Velg skjermbilder</span>
		</label>

		{#if queue.length > 0}
			<div class="queue">
				{#each queue as item (item.id)}
					<div class="queue-item" class:failed={item.status === 'feil'}>
						<div class="queue-head">
							<span class="queue-name">
								{#if item.preview}
									{item.preview.kind === 'weekly' ? 'Ukesbilde' : 'Dagsbilde'}
								{:else}
									{item.name}
								{/if}
							</span>
							<span class="queue-status">{statusLabel(item)}</span>
							<button
								class="del"
								onclick={() => removeItem(item.id)}
								disabled={busy}
								aria-label="Fjern bilde fra køen">✕</button
							>
						</div>
						{#if item.error}
							<p class="queue-error">{item.error}</p>
						{/if}
						{#if item.preview?.kind === 'weekly'}
							<ul>
								<li>Total: <strong>{fmt(item.preview.weekly.weekTotalMinutes)}</strong></li>
								<li>Snitt/dag: <strong>{fmt(item.preview.weekly.avgPerDayMinutes)}</strong></li>
								{#if item.preview.weekly.categories?.social}
									<li>Scrolling (sosialt): <strong>{fmt(item.preview.weekly.categories.social)}</strong></li>
								{/if}
							</ul>
							<label class="field">
								Uken (en dato i uka holder — snappes til mandag):
								<input type="date" bind:value={item.weekStartISO} data-track="skjermtid:ukesbilde-dato" />
							</label>
						{:else if item.preview?.kind === 'daily'}
							<ul>
								<li>Total: <strong>{fmt(item.preview.daily.totalMinutes)}</strong></li>
								{#if item.preview.daily.categories?.social}
									<li>Scrolling (sosialt): <strong>{fmt(item.preview.daily.categories.social)}</strong></li>
								{/if}
								{#if item.preview.daily.hourly?.length}
									<li>Time-for-time: <strong>{item.preview.daily.hourly.length} timer</strong></li>
								{/if}
							</ul>
							<label class="field">
								Dato:
								<input type="date" bind:value={item.dateISO} data-track="skjermtid:dagsbilde-dato" />
							</label>
						{/if}
					</div>
				{/each}
			</div>

			<div class="queue-actions">
				{#if pendingCount > 0}
					<Button onClick={analyzeAll} disabled={busy}>
						{analyzing
							? 'Analyserer…'
							: `Last opp og analyser (${pendingCount})`}
					</Button>
				{/if}
				{#if parsedCount > 0}
					<Button onClick={saveAll} disabled={busy}>
						{savingAll ? 'Lagrer…' : `Lagre alle (${parsedCount})`}
					</Button>
				{/if}
				<Button variant="ghost" onClick={() => (queue = [])} disabled={busy}>Tøm køen</Button>
			</div>
		{/if}
	</section>

	<!-- Mål -->
	<section class="block">
		<div class="block-head">
			<CardTitle>Ukesmål</CardTitle>
			<Button variant="ghost" onClick={() => (showGoalForm = !showGoalForm)}>
				{showGoalForm ? 'Lukk' : '+ Nytt mål'}
			</Button>
		</div>

		{#if showGoalForm}
			<div class="goal-form">
				<label class="field">
					Type
					<Select bind:value={goalKind}>
						<option value="total">Total skjermtid</option>
						<option value="social">Scrolling (sosiale medier)</option>
						<option value="window">Tidsvindu på døgnet</option>
					</Select>
				</label>

				{#if goalKind !== 'window'}
					<label class="field">
						Grunnlag
						<Select bind:value={goalBasis}>
							<option value="day_avg">Snitt per dag</option>
							<option value="week_total">Totalt per uke</option>
						</Select>
					</label>
				{:else}
					<div class="row">
						<label class="field">
							Fra kl.
							<input type="number" min="0" max="23" bind:value={goalFromHour} />
						</label>
						<label class="field">
							Til kl.
							<input type="number" min="1" max="24" bind:value={goalToHour} />
						</label>
						<label class="field">
							Teller
							<Select bind:value={goalWindowCategory}>
								<option value="social">Scrolling</option>
								<option value="total">All skjermtid</option>
							</Select>
						</label>
					</div>
				{/if}

				<div class="row">
					<label class="field">
						Maks timer
						<input type="number" min="0" max="24" bind:value={goalHours} />
					</label>
					<label class="field">
						Maks minutter
						<input type="number" min="0" max="59" bind:value={goalMinutes} />
					</label>
				</div>

				<Button onClick={createGoal} disabled={goalSaving}>
					{goalSaving ? 'Lagrer…' : 'Lagre mål'}
				</Button>
			</div>
		{/if}

		{#if data.goalsForManagement.length === 0 && !showGoalForm}
			<p class="muted">Ingen ukesmål satt ennå.</p>
		{:else}
			<div class="goal-manage">
				{#each data.goalsForManagement as g}
					<div class="goal-manage-row">
						<div>
							<span class="goal-title">{g.title}</span>
							<span class="goal-basis">{g.basisLabel}</span>
						</div>
						<button class="del" onclick={() => deleteGoal(g.id)} aria-label="Slett mål">✕</button>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	{#if data.connected}
		<section class="block danger-block">
			<CardTitle>Nullstill</CardTitle>
			<p class="muted">Sletter alle skjermtid-registreringer (uke- og dagsbilder). Mål beholdes.</p>
			<button class="btn-danger" onclick={deleteAll} disabled={deleting}>
				{deleting ? 'Sletter…' : 'Slett all skjermtid-data'}
			</button>
		</section>
	{/if}
	</PageSection>
</AppPage>

<style>
	.week-nav {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		background: var(--bg-secondary, #161616);
		border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
		border-radius: 12px;
		padding: 0.5rem 0.75rem;
	}
	.week-arrow {
		background: var(--bg-tertiary, rgba(255, 255, 255, 0.06));
		border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.12));
		color: var(--text-primary, #fff);
		border-radius: 8px;
		width: 36px;
		height: 36px;
		font-size: 1.2rem;
		cursor: pointer;
		flex-shrink: 0;
	}
	.week-arrow:disabled {
		opacity: 0.3;
		cursor: default;
	}
	.week-label {
		text-align: center;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.week-range {
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--text-primary, #fff);
	}
	.week-sub {
		font-size: 0.75rem;
		color: var(--text-secondary, rgba(255, 255, 255, 0.55));
	}
	.block {
		background: var(--bg-secondary, #161616);
		border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
		border-radius: 16px;
		padding: 1.25rem;
		color: var(--text-primary, #fff);
	}
	.block-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.block > :global(.card-title) {
		margin-bottom: 0.75rem;
	}
	.block-head :global(.card-title) {
		margin-bottom: 0;
	}
	.muted {
		color: var(--text-secondary, rgba(255, 255, 255, 0.6));
		font-size: 0.88rem;
	}
	.error {
		color: #fb7185;
		background: rgba(251, 113, 133, 0.1);
		padding: 0.6rem 0.9rem;
		border-radius: 10px;
	}
	.apps {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.app-row {
		display: flex;
		justify-content: space-between;
		font-size: 0.9rem;
		padding: 0.35rem 0;
		border-bottom: 1px solid rgba(255, 255, 255, 0.05);
	}
	.app-min {
		color: var(--text-secondary, rgba(255, 255, 255, 0.6));
		font-variant-numeric: tabular-nums;
	}
	.upload {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.75rem;
		padding: 0.7rem 1.1rem;
		background: var(--bg-tertiary, rgba(255, 255, 255, 0.06));
		border: 1px dashed var(--border-subtle, rgba(255, 255, 255, 0.2));
		border-radius: 12px;
		cursor: pointer;
	}
	.upload input {
		display: none;
	}
	.queue {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		margin-top: 1rem;
	}
	.queue-item {
		padding: 0.85rem 1rem;
		background: var(--bg-tertiary, rgba(255, 255, 255, 0.04));
		border: 1px solid transparent;
		border-radius: 12px;
	}
	.queue-item.failed {
		border-color: rgba(251, 113, 133, 0.35);
	}
	.queue-head {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}
	.queue-name {
		font-size: 0.9rem;
		font-weight: 600;
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.queue-status {
		font-size: 0.75rem;
		color: var(--text-secondary, rgba(255, 255, 255, 0.55));
		white-space: nowrap;
	}
	.queue-error {
		margin: 0.4rem 0 0;
		font-size: 0.8rem;
		color: #fb7185;
	}
	.queue-item ul {
		margin: 0.5rem 0 0.6rem;
		padding-left: 1.1rem;
		font-size: 0.9rem;
	}
	.queue-actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-top: 0.85rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.85rem;
		color: var(--text-secondary, rgba(255, 255, 255, 0.7));
	}
	.field input {
		background: var(--bg-primary, #0e0e0e);
		border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.12));
		border-radius: 8px;
		padding: 0.45rem 0.6rem;
		color: var(--text-primary, #fff);
	}
	.field small {
		opacity: 0.6;
	}
	.row {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	.row .field {
		flex: 1;
		min-width: 90px;
	}
	.goal-form {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		margin-bottom: 1rem;
	}
	.goal-manage {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.goal-manage-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.6rem 0;
		border-bottom: 1px solid rgba(255, 255, 255, 0.05);
	}
	.goal-title {
		display: block;
		font-size: 0.92rem;
	}
	.goal-basis {
		display: block;
		font-size: 0.78rem;
		color: var(--text-secondary, rgba(255, 255, 255, 0.5));
	}
	.del {
		background: none;
		border: none;
		color: var(--text-secondary, rgba(255, 255, 255, 0.5));
		cursor: pointer;
		font-size: 1rem;
	}
	.del:hover {
		color: #fb7185;
	}
	.week-actions {
		display: flex;
		justify-content: flex-end;
		margin-top: -0.5rem;
	}
	.link-danger {
		background: none;
		border: none;
		color: var(--text-secondary, rgba(255, 255, 255, 0.45));
		font-size: 0.8rem;
		cursor: pointer;
		padding: 0;
	}
	.link-danger:hover {
		color: #fb7185;
	}
	.danger-block {
		border-color: rgba(251, 113, 133, 0.25);
	}
	.btn-danger {
		margin-top: 0.5rem;
	}
</style>
