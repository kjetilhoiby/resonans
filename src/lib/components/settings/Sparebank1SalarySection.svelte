<!--
  Sparebank1SalarySection — Salary profile management for SpareBank 1.
  Shows detected salary profile, manual setup, profile editing, and backfill.
-->
<script lang="ts">
	import { Button, Input, Select } from '$lib/components/ui';

	type SalaryProfileData = {
		userId: string;
		sourceAccountId: string;
		descriptionFingerprint: string;
		amountMin: number;
		amountMax: number;
		typicalDom: number;
		typicalDow: number;
	};
	type PaycheckRow = {
		id: string;
		canonicalDate: string;
		amount: string;
		description: string | null;
		paycheckType: string;
	};
	type AccountRow = { accountId: string; accountName: string | null; accountType: string | null };
	type IncomeTx = { id: string; canonicalDate: string; amount: string; description: string };

	interface Props {
		salaryProfile: SalaryProfileData | null;
		salaryProfileNextPayday: string | null;
		salaryProfilePaychecks: PaycheckRow[];
		loadingSalaryProfile: boolean;
		onProfileChanged: () => void;
	}

	let {
		salaryProfile,
		salaryProfileNextPayday,
		salaryProfilePaychecks,
		loadingSalaryProfile,
		onProfileChanged
	}: Props = $props();

	let showSalaryProfile = $state(false);
	let rebuildingProfile = $state(false);
	let rebuildProfileResult = $state<{ success: boolean; message: string } | null>(null);
	let backfillingPaychecks = $state(false);
	let backfillResult = $state<{ success: boolean; message: string } | null>(null);
	let editingProfile = $state(false);
	let profileEditFingerprint = $state('');
	let profileEditAmountMin = $state(0);
	let profileEditAmountMax = $state(0);
	let profileEditDom = $state(0);
	let savingProfileEdit = $state(false);
	let profileEditResult = $state<{ success: boolean; message: string } | null>(null);

	// Manual salary setup
	let salaryAccounts = $state<AccountRow[]>([]);
	let manualAccountId = $state('');
	let accountTransactions = $state<IncomeTx[]>([]);
	let loadingAccountTxs = $state(false);
	let selectedTxId = $state('');
	let buildingFromTx = $state(false);
	let buildFromTxResult = $state<{ success: boolean; message: string } | null>(null);

	async function loadSalaryAccounts() {
		if (salaryAccounts.length > 0) return;
		try {
			const res = await fetch('/api/economics/accounts');
			if (res.ok) salaryAccounts = await res.json();
		} catch { /* non-critical */ }
	}

	async function loadAccountTransactions() {
		if (!manualAccountId) { accountTransactions = []; return; }
		loadingAccountTxs = true;
		accountTransactions = [];
		selectedTxId = '';
		buildFromTxResult = null;
		try {
			const res = await fetch(`/api/admin/salary-profile/account-transactions?accountId=${encodeURIComponent(manualAccountId)}`);
			if (res.ok) accountTransactions = await res.json();
		} finally {
			loadingAccountTxs = false;
		}
	}

	async function buildProfileFromTransaction() {
		if (!selectedTxId) return;
		buildingFromTx = true;
		buildFromTxResult = null;
		try {
			const res = await fetch('/api/admin/salary-profile/from-transaction', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ transactionId: selectedTxId })
			});
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(payload?.error || 'Bygging feilet');
			buildFromTxResult = { success: true, message: 'Profil bygget fra valgt transaksjon.' };
			onProfileChanged();
		} catch (err) {
			buildFromTxResult = { success: false, message: err instanceof Error ? err.message : 'Ukjent feil' };
		} finally {
			buildingFromTx = false;
		}
	}

	async function rebuildSalaryProfile() {
		rebuildingProfile = true;
		rebuildProfileResult = null;
		try {
			const res = await fetch('/api/admin/salary-profile/rebuild', { method: 'POST' });
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(payload?.error || 'Bygging feilet');
			rebuildProfileResult = { success: true, message: 'Lønnsprofile bygget.' };
			onProfileChanged();
		} catch (err) {
			rebuildProfileResult = { success: false, message: err instanceof Error ? err.message : 'Ukjent feil' };
		} finally {
			rebuildingProfile = false;
		}
	}

	async function backfillPaychecks(dryRun: boolean) {
		backfillingPaychecks = true;
		backfillResult = null;
		try {
			const url = `/api/admin/salary-profile/backfill${dryRun ? '?dryRun=true' : ''}`;
			const res = await fetch(url, { method: 'POST' });
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(payload?.error || 'Backfill feilet');
			if (dryRun) {
				const { wouldTag, wouldClear } = payload;
				backfillResult = {
					success: true,
					message: `Tørrtest: ville tagget ${wouldTag?.main ?? 0} hoved + ${wouldTag?.supplementary ?? 0} tillegg, fjernet ${wouldClear ?? 0} foreldede tagger`
				};
			} else {
				const { tagged, cleared } = payload;
				backfillResult = {
					success: true,
					message: `Tagget ${tagged?.main ?? 0} hoved + ${tagged?.supplementary ?? 0} tillegg, fjernet ${cleared ?? 0} foreldede tagger`
				};
				onProfileChanged();
			}
		} catch (err) {
			backfillResult = { success: false, message: err instanceof Error ? err.message : 'Ukjent feil' };
		} finally {
			backfillingPaychecks = false;
		}
	}

	function startEditProfile() {
		if (!salaryProfile) return;
		profileEditFingerprint = salaryProfile.descriptionFingerprint;
		profileEditAmountMin = salaryProfile.amountMin;
		profileEditAmountMax = salaryProfile.amountMax;
		profileEditDom = salaryProfile.typicalDom;
		editingProfile = true;
		profileEditResult = null;
	}

	async function saveProfileEdit() {
		savingProfileEdit = true;
		profileEditResult = null;
		try {
			const safeDom = Math.max(1, Math.min(31, Math.floor(Number(profileEditDom) || 25)));
			profileEditDom = safeDom;
			const res = await fetch('/api/admin/salary-profile', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					descriptionFingerprint: profileEditFingerprint.trim().toUpperCase(),
					amountMin: Number(profileEditAmountMin),
					amountMax: Number(profileEditAmountMax),
					typicalDom: safeDom
				})
			});
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(payload?.error || 'Lagring feilet');
			profileEditResult = { success: true, message: 'Lønnsprofile oppdatert.' };
			editingProfile = false;
			onProfileChanged();
		} catch (err) {
			profileEditResult = { success: false, message: err instanceof Error ? err.message : 'Ukjent feil' };
		} finally {
			savingProfileEdit = false;
		}
	}
</script>

<div class="salary-section">
	<div class="salary-header">
		<h3>Lønnsdeteksjon</h3>
		<Button
			type="button"
			variant="ghost"
			onClick={() => { showSalaryProfile = !showSalaryProfile; if (showSalaryProfile) loadSalaryAccounts(); }}
		>
			{showSalaryProfile ? 'Skjul' : 'Vis detaljer'}
		</Button>
	</div>

	{#if loadingSalaryProfile}
		<p class="meta">Laster lønnsprofile...</p>
	{:else if salaryProfile}
		<p class="meta">
			Neste lønning: <strong>{salaryProfileNextPayday ?? '–'}</strong>
			· Dag i mnd: <strong>{salaryProfile.typicalDom}</strong>
			· Beløpsintervall: <strong>{Math.round(salaryProfile.amountMin).toLocaleString('nb-NO')} – {Math.round(salaryProfile.amountMax).toLocaleString('nb-NO')} kr</strong>
		</p>
	{:else}
		<p class="meta">Ingen aktiv lønnsprofile. Bygg profil basert på historikk.</p>
	{/if}

	{#if showSalaryProfile}
		<div class="salary-detail">
			{#if salaryProfile}
				<div class="profile-grid">
					<span class="profile-label">Fingeravtrykk</span>
					<span class="profile-value mono">{salaryProfile.descriptionFingerprint || '–'}</span>
					<span class="profile-label">Kildekonto</span>
					<span class="profile-value mono">{salaryProfile.sourceAccountId}</span>
					<span class="profile-label">Typisk ukedag</span>
					<span class="profile-value">{['', 'Man', 'Tir', 'Ons', 'Tor', 'Fre'][salaryProfile.typicalDow] ?? '–'}</span>
				</div>
			{/if}

			<!-- Edit profile -->
			{#if editingProfile}
				<div class="profile-edit-form">
					<div class="field">
						<label for="profile-fingerprint">Fingeravtrykk (3 ord, store bokstaver)</label>
						<Input id="profile-fingerprint" className="input" bind:value={profileEditFingerprint} placeholder="EKS ARBEIDSGIVER AS" />
					</div>
					<div class="field row">
						<div>
							<label for="profile-amount-min">Min beløp (kr)</label>
							<Input id="profile-amount-min" className="input" type="number" min="0" bind:value={profileEditAmountMin} />
						</div>
						<div>
							<label for="profile-amount-max">Maks beløp (kr)</label>
							<Input id="profile-amount-max" className="input" type="number" min="0" bind:value={profileEditAmountMax} />
						</div>
						<div>
							<label for="profile-dom">Dag i mnd</label>
							<Input id="profile-dom" className="input" type="number" min="1" max="31" bind:value={profileEditDom} />
						</div>
					</div>
					<div class="row">
						<Button onClick={saveProfileEdit} disabled={savingProfileEdit}>
							{savingProfileEdit ? 'Lagrer...' : 'Lagre endringer'}
						</Button>
						<Button variant="ghost" onClick={() => { editingProfile = false; profileEditResult = null; }}>Avbryt</Button>
					</div>
					{#if profileEditResult}
						<p class={profileEditResult.success ? 'ok' : 'err'}>{profileEditResult.message}</p>
					{/if}
				</div>
			{/if}

			<!-- Action buttons -->
			<div class="row salary-actions">
				<Button variant="secondary" onClick={rebuildSalaryProfile} disabled={rebuildingProfile}>
					{rebuildingProfile ? 'Bygger...' : 'Bygg ny profil fra historikk'}
				</Button>
				{#if salaryProfile && !editingProfile}
					<Button variant="secondary" onClick={startEditProfile}>Korriger manuelt</Button>
				{/if}
			</div>
			{#if rebuildProfileResult}
				<p class={rebuildProfileResult.success ? 'ok' : 'err'}>{rebuildProfileResult.message}</p>
			{/if}

			<!-- Manual setup: pick account + transaction -->
			<div class="manual-setup-section">
				<h4>Manuelt oppsett (velg lønnskonto og transaksjon)</h4>
				<p class="field-desc">Bruk dette om automatikken plukker feil lønningsdag. Velg kontoen lønnen treffer og klikk på riktig lønnstransaksjon.</p>
				<div class="field">
					<label for="salary-account-select">Lønnskonto</label>
					<Select
						id="salary-account-select"
						className="input"
						bind:value={manualAccountId}
						onChange={loadAccountTransactions}
					>
						<option value="">Velg konto...</option>
						{#each salaryAccounts as acc}
							<option value={acc.accountId}>{acc.accountName ?? acc.accountId}{acc.accountType ? ` (${acc.accountType})` : ''}</option>
						{/each}
					</Select>
				</div>

				{#if loadingAccountTxs}
					<p class="meta">Laster transaksjoner...</p>
				{:else if accountTransactions.length > 0}
					<div class="field">
						<p class="field-title">Velg en representativ lønnstransaksjon</p>
						<div class="tx-picker">
							{#each accountTransactions as tx}
								<label class="tx-option" class:tx-selected={selectedTxId === tx.id}>
									<input type="radio" name="salary-tx-pick" value={tx.id} bind:group={selectedTxId} />
									<span class="tx-date">{tx.canonicalDate}</span>
									<span class="tx-amount">{Number(tx.amount).toLocaleString('nb-NO', { minimumFractionDigits: 2 })} kr</span>
									<span class="tx-desc">{tx.description || '–'}</span>
								</label>
							{/each}
						</div>
					</div>
					<div class="row">
						<Button onClick={buildProfileFromTransaction} disabled={!selectedTxId || buildingFromTx}>
							{buildingFromTx ? 'Bygger...' : 'Bygg profil fra valgt transaksjon'}
						</Button>
					</div>
					{#if buildFromTxResult}
						<p class={buildFromTxResult.success ? 'ok' : 'err'}>{buildFromTxResult.message}</p>
					{/if}
				{:else if manualAccountId}
					<p class="meta">Ingen store inntektstransaksjoner (≥ 10 000 kr) funnet på denne kontoen.</p>
				{/if}
			</div>

			<!-- Backfill -->
			{#if salaryProfile}
				<div class="backfill-section">
					<p class="field-desc">Tagg eksisterende transaksjoner med lønnsstatus basert på aktiv profil.</p>
					<div class="row">
						<Button variant="secondary" onClick={() => backfillPaychecks(true)} disabled={backfillingPaychecks}>
							Tørrtest
						</Button>
						<Button variant="secondary" onClick={() => backfillPaychecks(false)} disabled={backfillingPaychecks}>
							{backfillingPaychecks ? 'Kjører...' : 'Kjør backfill'}
						</Button>
					</div>
					{#if backfillResult}
						<p class={backfillResult.success ? 'ok' : 'err'}>{backfillResult.message}</p>
					{/if}
				</div>
			{/if}

			<!-- Recent paychecks -->
			{#if salaryProfilePaychecks.length > 0}
				<div class="paycheck-list">
					<p class="field-title">Siste lønnsinnbetalinger (siste 12 mnd)</p>
					<table class="debug-table">
						<thead>
							<tr>
								<th>Dato</th>
								<th>Beløp</th>
								<th>Beskrivelse</th>
								<th>Type</th>
							</tr>
						</thead>
						<tbody>
							{#each salaryProfilePaychecks as pc}
								<tr>
									<td>{pc.canonicalDate}</td>
									<td>{Number(pc.amount).toLocaleString('nb-NO', { minimumFractionDigits: 2 })} kr</td>
									<td>{pc.description || '–'}</td>
									<td>{pc.paycheckType === 'main' ? 'Hoved' : 'Tillegg'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else if salaryProfile}
				<p class="meta">Ingen taggede lønnsinnbetalinger funnet siste 12 måneder.</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.ok { color: var(--success-text); margin: 0.6rem 0 0; }
	.err { color: var(--error-text); margin: 0.6rem 0 0; }
	.meta { color: var(--text-tertiary); font-size: 0.82rem; margin: 0.2rem 0 0.6rem; }
	.field { margin-bottom: 0.9rem; }
	.field label { display: block; margin-bottom: 0.4rem; color: var(--text-secondary); font-size: 0.82rem; }
	.field-title { margin: 0 0 0.4rem; font-size: 0.84rem; font-weight: 500; color: var(--text-secondary); }
	.field-desc { color: var(--text-tertiary); font-size: 0.84rem; margin: 0 0 0.8rem; }
	.row { display: flex; gap: 0.6rem; flex-wrap: wrap; }

	.salary-section {
		margin-top: 1.25rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border-color);
	}
	.salary-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.4rem;
	}
	.salary-header h3 {
		margin: 0;
		font-size: 0.92rem;
		font-weight: 600;
		color: var(--text-primary);
	}
	.salary-detail {
		margin-top: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.profile-grid {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.25rem 0.75rem;
		font-size: 0.84rem;
	}
	.profile-label { color: var(--text-tertiary); }
	.profile-value { color: var(--text-secondary); }
	.profile-value.mono { font-family: monospace; font-size: 0.82rem; }
	.salary-actions { flex-wrap: wrap; gap: 0.5rem; }
	.profile-edit-form {
		padding: 0.75rem;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		background: var(--bg-elevated);
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.backfill-section {
		padding: 0.65rem 0.75rem;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		background: var(--bg-elevated);
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.paycheck-list { margin-top: 0.25rem; }
	.manual-setup-section {
		padding: 0.75rem;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		background: var(--bg-elevated);
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
	}
	.manual-setup-section h4 {
		margin: 0;
		font-size: 0.88rem;
		font-weight: 600;
		color: var(--text-secondary);
	}
	.tx-picker {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		max-height: 16rem;
		overflow-y: auto;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		padding: 0.25rem;
	}
	.tx-option {
		display: grid;
		grid-template-columns: 1fr max-content 2fr;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 0.6rem;
		border-radius: 6px;
		cursor: pointer;
		font-size: 0.84rem;
		color: var(--text-secondary);
		border: 1px solid transparent;
	}
	.tx-option input[type="radio"] { display: none; }
	.tx-option:hover { background: var(--border-subtle); }
	.tx-option.tx-selected { background: #1a2a1a; border-color: #2d5a2d; color: var(--text-primary); }
	.tx-date { color: var(--text-tertiary); font-size: 0.8rem; white-space: nowrap; }
	.tx-amount { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
	.tx-desc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.debug-table { width: 100%; border-collapse: collapse; font-size: 0.79rem; color: var(--text-secondary); }
	.debug-table th, .debug-table td { padding: 0.34rem 0.45rem; text-align: left; border-bottom: 1px solid var(--border-color); white-space: nowrap; }
	.debug-table th { color: var(--text-tertiary); font-weight: 500; }
</style>
