<script lang="ts">
	import { AppPage, PageHeader, IconButton, Button, Select } from '$lib/components/ui';
	import ScreenTimeCard from '$lib/components/composed/ScreenTimeCard.svelte';
	import { invalidateAll } from '$app/navigation';
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

	/* ── Opplasting + tolking ─────────────────────────────── */
	let uploading = $state(false);
	let parsing = $state(false);
	let saving = $state(false);
	let error = $state<string | null>(null);
	let preview = $state<any | null>(null);
	let weekStartISO = $state('');
	let dateISO = $state('');

	async function onFile(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		error = null;
		preview = null;
		uploading = true;
		try {
			const fd = new FormData();
			fd.append('image', file);
			const up = await fetch('/api/upload-image', { method: 'POST', body: fd });
			const upJson = await up.json();
			if (!up.ok || !upJson.url) throw new Error(upJson.error || 'Opplasting feilet');
			uploading = false;
			parsing = true;
			const res = await fetch('/api/sensors/screen-time/parse', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ imageUrl: upJson.url })
			});
			const json = await res.json();
			if (!json.success) throw new Error(json.message || 'Klarte ikke å tolke bildet');
			preview = json.parsed;
			if (preview.kind === 'daily' && preview.dateISO) dateISO = preview.dateISO;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Noe gikk galt';
		} finally {
			uploading = false;
			parsing = false;
			input.value = '';
		}
	}

	async function confirmIngest() {
		if (!preview) return;
		saving = true;
		error = null;
		try {
			const body =
				preview.kind === 'weekly'
					? { kind: 'weekly', weekly: preview.weekly, weekStartISO: weekStartISO || undefined }
					: { kind: 'daily', daily: preview.daily, dateISO: dateISO || undefined };
			const res = await fetch('/api/sensors/screen-time/ingest', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			const json = await res.json();
			if (!res.ok || !json.success) throw new Error(json.error || 'Lagring feilet');
			preview = null;
			await invalidateAll();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Lagring feilet';
		} finally {
			saving = false;
		}
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
</script>

<svelte:head>
	<title>Skjermtid · Resonans</title>
</svelte:head>

<AppPage width="full" padding="default" gap="md">
	<PageHeader title="Skjermtid" titleHref="/">
		{#snippet actions()}
			<IconButton href="/samtaler" icon="chat" variant="nav" ariaLabel="Chat" />
		{/snippet}
	</PageHeader>

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
	/>

	{#if current && current.topApps.length > 0}
		<section class="block">
			<h2>Mest brukt ({current.label})</h2>
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
		<h2>Legg inn skjermbilde</h2>
		<p class="muted">
			Last opp et iOS Skjermtid-skjermbilde — enten ukesbildet (Uke-fanen, hver mandag for forrige
			uke) eller et dagsbilde (Dag-fanen). AI-en tolker tallene.
		</p>

		<label class="upload">
			<input type="file" accept="image/*" onchange={onFile} disabled={uploading || parsing} />
			<span>{uploading ? 'Laster opp…' : parsing ? 'Tolker bilde…' : '📷 Velg skjermbilde'}</span>
		</label>

		{#if preview}
			<div class="preview">
				{#if preview.kind === 'weekly'}
					<p class="preview-kind">Ukesbilde gjenkjent ({preview.confidence})</p>
					<ul>
						<li>Total: <strong>{fmt(preview.weekly.weekTotalMinutes)}</strong></li>
						<li>Snitt/dag: <strong>{fmt(preview.weekly.avgPerDayMinutes)}</strong></li>
						{#if preview.weekly.categories?.social}
							<li>Scrolling (sosialt): <strong>{fmt(preview.weekly.categories.social)}</strong></li>
						{/if}
					</ul>
					<label class="field">
						Uke starter (mandag):
						<input type="date" bind:value={weekStartISO} />
						<small>La stå tomt for forrige uke.</small>
					</label>
				{:else}
					<p class="preview-kind">Dagsbilde gjenkjent ({preview.confidence})</p>
					<ul>
						<li>Total: <strong>{fmt(preview.daily.totalMinutes)}</strong></li>
						{#if preview.daily.categories?.social}
							<li>Scrolling (sosialt): <strong>{fmt(preview.daily.categories.social)}</strong></li>
						{/if}
						{#if preview.daily.hourly?.length}
							<li>Time-for-time: <strong>{preview.daily.hourly.length} timer</strong></li>
						{/if}
					</ul>
					<label class="field">
						Dato:
						<input type="date" bind:value={dateISO} />
					</label>
				{/if}
				<div class="preview-actions">
					<Button onClick={confirmIngest} disabled={saving}>
						{saving ? 'Lagrer…' : 'Lagre'}
					</Button>
					<Button variant="ghost" onClick={() => (preview = null)}>Avbryt</Button>
				</div>
			</div>
		{/if}
	</section>

	<!-- Mål -->
	<section class="block">
		<div class="block-head">
			<h2>Ukesmål</h2>
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
	h2 {
		font-size: 1rem;
		margin: 0 0 0.75rem;
	}
	.block-head h2 {
		margin: 0;
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
	.preview {
		margin-top: 1rem;
		padding: 1rem;
		background: var(--bg-tertiary, rgba(255, 255, 255, 0.04));
		border-radius: 12px;
	}
	.preview-kind {
		font-weight: 600;
		margin: 0 0 0.5rem;
	}
	.preview ul {
		margin: 0 0 0.75rem;
		padding-left: 1.1rem;
		font-size: 0.9rem;
	}
	.preview-actions {
		display: flex;
		gap: 0.5rem;
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
</style>
