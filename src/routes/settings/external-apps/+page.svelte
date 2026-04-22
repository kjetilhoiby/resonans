<script lang="ts">
	import { AppPage, Button, Input, PageHeader, SectionCard } from '$lib/components/ui';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const secrets = $derived(data.secrets ?? []);
	const tableReady = $derived(data.tableReady !== false);
	const createdSecret = $derived((form as ActionData & { createdSecret?: string })?.createdSecret ?? null);
	const actionMessage = $derived((form as ActionData & { message?: string })?.message ?? null);
	const actionError = $derived((form as ActionData & { error?: string })?.error ?? null);

	function fmt(iso: string | Date | null) {
		if (!iso) return 'Aldri';
		return new Intl.DateTimeFormat('nb-NO', {
			year: 'numeric',
			month: 'short',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		}).format(new Date(iso));
	}
</script>

<AppPage width="full" theme="dark" className="external-apps-page">
	<PageHeader
		title="Eksterne apper"
		subtitle="Opprett personlige API-secrets for Scriptable og andre klienter."
		titleHref="/settings"
		titleLabel="Gå til innstillinger"
	/>

	{#if actionMessage}
		<div class="alert success">✅ {actionMessage}</div>
	{/if}
	{#if actionError}
		<div class="alert error">❌ {actionError}</div>
	{/if}
	{#if !tableReady}
		<div class="alert error">
			⚠️ API-secrets-tabellen mangler i databasen. Kjør <strong>npm run db:push</strong> (eller migrering i prod) og refresh siden.
		</div>
	{/if}

	{#if createdSecret}
		<SectionCard title="Nytt secret (vises kun en gang)" className="secret-once-card">
			<p>Lagre dette i passordhvelv eller i Scriptable Keychain. Etter side-reload kan det ikke hentes igjen.</p>
			<pre>{createdSecret}</pre>
		</SectionCard>
	{/if}

	<SectionCard title="Opprett nytt secret">
		<form method="POST" action="?/createSecret" class="stack">
			<label for="label">Navn</label>
			<Input id="label" name="label" type="text" placeholder="F.eks. Scriptable iPhone" required disabled={!tableReady} />

			<label for="expiresInDays">Utløper om (dager, valgfritt)</label>
			<Input id="expiresInDays" name="expiresInDays" type="number" min="1" max="3650" placeholder="Tom = uten utløp" disabled={!tableReady} />

			<Button type="submit" disabled={!tableReady}>Opprett secret</Button>
		</form>
	</SectionCard>

	<SectionCard title="Aktive secrets">
		{#if secrets.length === 0}
			<p class="muted">Ingen aktive secrets enda.</p>
		{:else}
			<div class="secret-list">
				{#each secrets as secret (secret.id)}
					<div class="secret-row">
						<div>
							<p class="secret-title">{secret.label}</p>
							<p class="secret-meta">{secret.maskedSecret}</p>
							<p class="secret-meta">Opprettet: {fmt(secret.createdAt)} · Sist brukt: {fmt(secret.lastUsedAt)}</p>
							<p class="secret-meta">Utløper: {secret.expiresAt ? fmt(secret.expiresAt) : 'Aldri'}</p>
						</div>
						<form method="POST" action="?/revokeSecret">
							<input type="hidden" name="secretId" value={secret.id} />
							<Button variant="danger" type="submit">Deaktiver</Button>
						</form>
					</div>
				{/each}
			</div>
		{/if}
	</SectionCard>

	<SectionCard title="Scriptable eksempel">
		<p>Bytt ut SECRET og endpoint med ønsket API-rute. Bruk Bearer token eller x-resonans-api-secret.</p>
		<pre>{`const secret = Keychain.get("resonans_api_secret")
const req = new Request("${data.origin}/api/widget-data/PUTT_WIDGET_ID_HER")
req.method = "GET"
req.headers = {
  "Authorization": ` + "`Bearer ${secret}`" + `,
  "Accept": "application/json"
}
const payload = await req.loadJSON()
console.log(payload)`}</pre>
	</SectionCard>
</AppPage>

<style>
	:global(.external-apps-page) {
		color: var(--text-secondary);
	}

	.stack {
		display: grid;
		gap: 0.55rem;
	}

	label {
		color: var(--text-primary);
	}

	.secret-list {
		display: grid;
		gap: 0.75rem;
	}

	.secret-row {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		align-items: flex-start;
		padding: 0.65rem;
		border: 1px solid var(--border-color);
		border-radius: 10px;
		background: #0f0f12;
	}

	.secret-title {
		margin: 0;
		font-weight: 600;
	}

	.secret-meta {
		margin: 0.2rem 0 0;
		font-size: 0.86rem;
		color: var(--text-secondary);
	}

	.alert {
		padding: 0.65rem 0.75rem;
		border-radius: 10px;
		border: 1px solid;
	}

	.alert.success {
		background: rgba(67, 161, 101, 0.15);
		border-color: rgba(67, 161, 101, 0.5);
	}

	.alert.error {
		background: rgba(174, 70, 70, 0.15);
		border-color: rgba(174, 70, 70, 0.5);
	}

	pre {
		margin: 0;
		background: #090a0d;
		border: 1px solid #242632;
		border-radius: 8px;
		padding: 0.65rem;
		overflow-x: auto;
		font-size: 0.84rem;
		line-height: 1.5;
	}

	.muted {
		color: var(--text-secondary);
		margin: 0;
	}

	@media (max-width: 720px) {
		.secret-row {
			flex-direction: column;
		}
	}
</style>
