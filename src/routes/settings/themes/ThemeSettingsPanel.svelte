<script lang="ts">
	import { Button, DateInput } from '$lib/components/ui';
	import ThemeMetricSettingsSheet from '$lib/components/domain/ThemeMetricSettingsSheet.svelte';
	import type { MetricSettingsMap } from '$lib/components/domain/ThemeMetricSettingsSheet.svelte';
	import { onMount } from 'svelte';

	interface ThemeForSettings {
		id: string;
		name: string;
		kind: string | null;
		tripProfile: { startDate?: string; endDate?: string; destination?: string } | null;
		ferieProfile: { startDate?: string; endDate?: string; note?: string } | null;
		metricSettings: MetricSettingsMap | null;
	}

	let { theme }: { theme: ThemeForSettings } = $props();

	type SaveState = 'idle' | 'saving' | 'saved' | 'error';

	function saveLabel(state: SaveState): string {
		return state === 'saving'
			? 'Lagrer …'
			: state === 'saved'
				? 'Lagret ✓'
				: state === 'error'
					? 'Prøv igjen'
					: 'Lagre';
	}

	// ── Tur (travel): fra/til-dato ──────────────────────────────────────────
	let tripStart = $state(theme.tripProfile?.startDate ?? '');
	let tripEnd = $state(theme.tripProfile?.endDate ?? '');
	let tripState = $state<SaveState>('idle');

	async function saveTrip() {
		tripState = 'saving';
		try {
			// Tur-APIet overskriver hele tripProfile, så vi sender med eksisterende
			// felter (destinasjon, overnattinger, kontofilter) uendret.
			const res = await fetch(`/api/tema/${theme.id}/trip`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					...(theme.tripProfile ?? {}),
					startDate: tripStart || undefined,
					endDate: tripEnd || undefined
				})
			});
			tripState = res.ok ? 'saved' : 'error';
		} catch {
			tripState = 'error';
		}
		if (tripState === 'saved') setTimeout(() => (tripState = 'idle'), 1800);
	}

	// ── Ferie: fra/til-dato (APIet merger feltvis) ──────────────────────────
	let ferieStart = $state(theme.ferieProfile?.startDate ?? '');
	let ferieEnd = $state(theme.ferieProfile?.endDate ?? '');
	let ferieState = $state<SaveState>('idle');

	async function saveFerie() {
		ferieState = 'saving';
		try {
			const res = await fetch(`/api/tema/${theme.id}/ferie`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ startDate: ferieStart || null, endDate: ferieEnd || null })
			});
			ferieState = res.ok ? 'saved' : 'error';
		} catch {
			ferieState = 'error';
		}
		if (ferieState === 'saved') setTimeout(() => (ferieState = 'idle'), 1800);
	}

	// ── Helse: terskelverdier (gjenbruker eksisterende sheet) ───────────────
	let metricOpen = $state(false);
	let metricSettings = $state<MetricSettingsMap>(theme.metricSettings ?? {});
	const metricCount = $derived(Object.keys(metricSettings).length);

	// ── Bøker: bibliotek-epostregler (globale i dag, filtrert på type) ──────
	interface EmailRule {
		id: string;
		name: string;
		processingType: string;
		senderPattern: string | null;
		subjectPattern: string | null;
		isActive: boolean;
	}
	let libraryRules = $state<EmailRule[] | null>(null);

	async function loadLibraryRules() {
		try {
			const res = await fetch('/api/settings/email-rules');
			if (res.ok) {
				const rules: EmailRule[] = await res.json();
				libraryRules = rules.filter((r) => r.processingType === 'library');
			} else {
				libraryRules = [];
			}
		} catch {
			libraryRules = [];
		}
	}

	// ── Økonomi: kontoer (read-only) ────────────────────────────────────────
	interface Account {
		accountId: string;
		accountName: string;
		accountType: string | null;
		balance: number | null;
		currency: string | null;
	}
	let accounts = $state<Account[] | null>(null);

	async function loadAccounts() {
		try {
			const res = await fetch('/api/economics/accounts');
			accounts = res.ok ? await res.json() : [];
		} catch {
			accounts = [];
		}
	}

	function fmtBalance(a: Account): string {
		if (a.balance == null) return '';
		return new Intl.NumberFormat('nb-NO', {
			style: 'currency',
			currency: a.currency || 'NOK',
			maximumFractionDigits: 0
		}).format(a.balance);
	}

	onMount(() => {
		if (theme.kind === 'books') void loadLibraryRules();
		if (theme.kind === 'economics') void loadAccounts();
	});
</script>

<div class="panel">
	{#if theme.kind === 'travel'}
		<div class="field-group">
			<h4>Reisedatoer</h4>
			<div class="date-row">
				<label>
					<span>Fra</span>
					<DateInput bind:value={tripStart} ariaLabel="Startdato for turen" />
				</label>
				<label>
					<span>Til</span>
					<DateInput bind:value={tripEnd} ariaLabel="Sluttdato for turen" />
				</label>
				<Button
					variant="secondary"
					disabled={tripState === 'saving'}
					ariaLabel="Lagre reisedatoer"
					onClick={() => void saveTrip()}
				>
					{saveLabel(tripState)}
				</Button>
			</div>
		</div>
	{:else if theme.kind === 'ferie'}
		<div class="field-group">
			<h4>Ferievindu</h4>
			<div class="date-row">
				<label>
					<span>Fra</span>
					<DateInput bind:value={ferieStart} ariaLabel="Startdato for ferien" />
				</label>
				<label>
					<span>Til</span>
					<DateInput bind:value={ferieEnd} ariaLabel="Sluttdato for ferien" />
				</label>
				<Button
					variant="secondary"
					disabled={ferieState === 'saving'}
					ariaLabel="Lagre ferievindu"
					onClick={() => void saveFerie()}
				>
					{saveLabel(ferieState)}
				</Button>
			</div>
		</div>
	{:else if theme.kind === 'health'}
		<div class="field-group">
			<h4>Helsemål og terskler</h4>
			<p class="muted">
				{metricCount > 0
					? `${metricCount} metrikk${metricCount === 1 ? '' : 'er'} har egne terskler.`
					: 'Ingen egne terskler satt — standardverdier brukes.'}
			</p>
			<Button variant="secondary" onClick={() => (metricOpen = true)}>Rediger terskler</Button>
		</div>
	{:else if theme.kind === 'books'}
		<div class="field-group">
			<h4>Bibliotek-epostregler</h4>
			{#if libraryRules === null}
				<p class="muted">Laster …</p>
			{:else if libraryRules.length === 0}
				<p class="muted">Ingen epostregler for bibliotek enda.</p>
			{:else}
				<ul class="rule-list">
					{#each libraryRules as rule (rule.id)}
						<li>
							<span class="rule-name">{rule.name}</span>
							{#if rule.senderPattern}<span class="rule-meta">avsender: {rule.senderPattern}</span>{/if}
							<span class="rule-status {rule.isActive ? 'on' : 'off'}">
								{rule.isActive ? 'aktiv' : 'av'}
							</span>
						</li>
					{/each}
				</ul>
			{/if}
			<p class="muted small">
				Epostregler er foreløpig globale. Rediger dem under
				<a href="/settings/sources">Kilder</a>.
			</p>
		</div>
	{:else if theme.kind === 'economics'}
		<div class="field-group">
			<h4>Kontoer</h4>
			{#if accounts === null}
				<p class="muted">Laster …</p>
			{:else if accounts.length === 0}
				<p class="muted">Ingen kontoer registrert.</p>
			{:else}
				<ul class="account-list">
					{#each accounts as acc (acc.accountId)}
						<li>
							<span class="acc-name">{acc.accountName || acc.accountId}</span>
							<span class="acc-balance">{fmtBalance(acc)}</span>
						</li>
					{/each}
				</ul>
			{/if}
			<p class="muted small">
				Lønnskonto og foretrukne kontoer styres foreløpig under
				<a href="/settings/sources">Kilder</a>. Egne tema-innstillinger for økonomi kommer.
			</p>
		</div>
	{/if}
</div>

{#if theme.kind === 'health'}
	<ThemeMetricSettingsSheet
		open={metricOpen}
		settings={metricSettings}
		themeId={theme.id}
		onclose={() => (metricOpen = false)}
		onsave={(s) => {
			metricSettings = s;
			metricOpen = false;
		}}
	/>
{/if}

<style>
	.panel {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.field-group {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	h4 {
		margin: 0;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-tertiary);
	}

	.date-row {
		display: flex;
		gap: 0.75rem;
		align-items: flex-end;
		flex-wrap: wrap;
	}

	.date-row label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		/* La feltene krympe og bryte i stedet for å sprenge kortet på mobil. */
		flex: 1 1 8rem;
		min-width: 0;
	}

	.date-row label span {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	.muted {
		margin: 0;
		color: var(--text-tertiary);
		font-size: 0.85rem;
	}

	.muted.small {
		font-size: 0.78rem;
	}

	.muted a {
		color: var(--accent-primary);
	}

	.rule-list,
	.account-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.rule-list li,
	.account-list li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		font-size: 0.85rem;
	}

	.rule-name,
	.acc-name {
		color: var(--text-primary);
		font-weight: 500;
	}

	.rule-meta {
		color: var(--text-tertiary);
		font-size: 0.78rem;
	}

	.rule-status {
		font-size: 0.72rem;
		border-radius: 999px;
		padding: 0.1rem 0.45rem;
	}

	.rule-status.on {
		background: color-mix(in srgb, #4ade80 18%, transparent);
		color: #4ade80;
	}

	.rule-status.off {
		background: #222;
		color: var(--text-tertiary);
	}

	.acc-balance {
		margin-left: auto;
		color: var(--text-secondary);
		font-variant-numeric: tabular-nums;
	}
</style>
