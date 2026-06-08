<script lang="ts">
	import { AppPage, Button, Input, PageHeader, SectionCard, Select } from '$lib/components/ui';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let expiresPreset = $state('90');
	let copiedSecret = $state(false);

	const secrets = $derived(data.secrets ?? []);
	const tableReady = $derived(data.tableReady !== false);
	const createdSecret = $derived((form as ActionData & { createdSecret?: string })?.createdSecret ?? null);
	const actionMessage = $derived((form as ActionData & { message?: string })?.message ?? null);
	const actionError = $derived((form as ActionData & { error?: string })?.error ?? null);
	const showCustomExpires = $derived(expiresPreset === 'custom');

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

	async function copySecret() {
		if (!createdSecret) return;
		try {
			await navigator.clipboard.writeText(createdSecret);
			copiedSecret = true;
			setTimeout(() => {
				copiedSecret = false;
			}, 1800);
		} catch {
			copiedSecret = false;
		}
	}
</script>

<AppPage className="external-apps-page">
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
			<div class="secret-copy-row">
				<Button type="button" variant="secondary" onClick={copySecret}>{copiedSecret ? 'Kopiert' : 'Kopier secret'}</Button>
			</div>
			<pre>{createdSecret}</pre>
		</SectionCard>
	{/if}

	<SectionCard title="Opprett nytt secret">
		<form method="POST" action="?/createSecret" class="stack">
			<label for="label">Navn</label>
			<Input id="label" name="label" type="text" placeholder="F.eks. Scriptable iPhone" required disabled={!tableReady} />

			<label for="expiresPreset">Utløp</label>
			<Select id="expiresPreset" name="expiresPreset" bind:value={expiresPreset} disabled={!tableReady}>
				<option value="never">Ingen utløp</option>
				<option value="7">7 dager</option>
				<option value="30">30 dager</option>
				<option value="90">90 dager (anbefalt)</option>
				<option value="180">180 dager</option>
				<option value="365">365 dager</option>
				<option value="730">730 dager</option>
				<option value="custom">Egendefinert</option>
			</Select>

			{#if showCustomExpires}
				<label for="expiresCustomDays">Egendefinert antall dager</label>
				<Input id="expiresCustomDays" name="expiresCustomDays" type="number" min="1" max="3650" placeholder="f.eks. 45" disabled={!tableReady} />
			{/if}

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

	<SectionCard title="Autentisering">
		<p>Alle API-kall krever secret som Bearer token:</p>
		<pre>Authorization: Bearer rsn_ditt_secret_her</pre>
		<p class="muted">Alternativt: <code>x-resonans-api-secret</code>-header.</p>
	</SectionCard>

	<SectionCard title="API-oversikt" className="api-ref">
		<h4>Hent widget-data (Scriptable / Snarveier)</h4>
		<pre>{`GET ${data.origin}/api/widget-data/{widgetId}`}</pre>
		<p class="muted">Returnerer beregnet widget-data som JSON. Finn widget-ID på forsiden (lang-trykk → innstillinger).</p>

		<h4>App-tilkobling (Ekko o.l.)</h4>
		<p class="muted">Apper som kobler seg til via deep link. Åpne authorize-URL i en webview — brukeren logger inn, og appen mottar et secret via deep link tilbake.</p>
		<pre>{`GET ${data.origin}/api/apps/authorize?app={appId}
GET ${data.origin}/api/apps/status`}</pre>

		<h4>Last opp fil</h4>
		<p class="muted">Treningsfiler (GPX/TCX) parses automatisk. Bilder (JPG/PNG/HEIC) lagres i skyen og knyttes til en sensor-event.</p>
		<pre>{`POST ${data.origin}/api/apps/upload
Content-Type: multipart/form-data

app       = {appId}          (påkrevd)
file      = {fil}            (påkrevd)
sessionId = {unikId}         (anbefalt, dedup)
sportType = running|cycling   (valgfri, kun GPX)
eventType = meal|observation  (valgfri, kun bilde)
dataType  = food_photo        (valgfri, kun bilde)
caption   = "Fritekst"        (valgfri, kun bilde)`}</pre>

		<h4>Send hendelse (JSON)</h4>
		<p class="muted">For enkle sensor-events uten fil — f.eks. IoT-enheter, automations, Snarveier.</p>
		<pre>{`POST ${data.origin}/api/apps/event
Content-Type: application/json

{
  "app": "{appId}",
  "eventType": "appliance_cycle",
  "dataType": "dishwasher",
  "data": { "program": "eco" },
  "timestamp": "2026-05-15T18:30:00Z",
  "dedupeKey": "valgfri-unik-id"
}`}</pre>
		<p class="muted"><code>timestamp</code> og <code>dedupeKey</code> er valgfrie.</p>
	</SectionCard>

	<SectionCard title="Scriptable-eksempel">
		<p>Widget-data i Scriptable:</p>
		<pre>{`const secret = Keychain.get("resonans_api_secret")
const req = new Request("${data.origin}/api/widget-data/WIDGET_ID")
req.headers = {
  "Authorization": ` + "`Bearer ${secret}`" + `
}
const data = await req.loadJSON()`}</pre>

		<p>Send hendelse fra Scriptable:</p>
		<pre>{`const secret = Keychain.get("resonans_api_secret")
const req = new Request("${data.origin}/api/apps/event")
req.method = "POST"
req.headers = {
  "Authorization": ` + "`Bearer ${secret}`" + `,
  "Content-Type": "application/json"
}
req.body = JSON.stringify({
  app: "scriptable",
  eventType: "observation",
  dataType: "mood",
  data: { score: 8, note: "God dag" }
})
await req.loadJSON()`}</pre>
	</SectionCard>

	<SectionCard title="Snarveier-eksempel">
		<p>Send data fra Snarveier-appen på iPhone:</p>
		<ol>
			<li>Legg til «Hent innhold fra URL»-handling</li>
			<li>URL: <code>{data.origin}/api/apps/event</code></li>
			<li>Metode: POST</li>
			<li>Hode: <code>Authorization</code> → <code>Bearer ditt_secret</code></li>
			<li>Brødtekst: JSON med <code>app</code>, <code>eventType</code>, <code>dataType</code>, <code>data</code></li>
		</ol>
	</SectionCard>

	<SectionCard title="Anbefalt praksis">
		<ul>
			<li>Lag ett secret per klient/enhet (f.eks. iPhone-widget, Mac-script).</li>
			<li>Bruk utløp der det er praktisk, og roter secret jevnlig.</li>
			<li>Deaktiver secret umiddelbart hvis du mistenker lekkasje.</li>
			<li>Sjekk «Sist brukt» for å oppdage uventet aktivitet.</li>
		</ul>
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

	:global(select) {
		width: 100%;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: #111216;
		color: var(--text-primary);
		padding: 0.55rem 0.6rem;
	}

	:global(select:disabled) {
		opacity: 0.65;
	}

	.secret-copy-row {
		display: flex;
		justify-content: flex-start;
		margin-bottom: 0.65rem;
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

	:global(.api-ref) h4 {
		margin: 1.2rem 0 0.35rem;
		color: var(--text-primary);
		font-size: 0.95rem;
	}

	:global(.api-ref) h4:first-child {
		margin-top: 0;
	}

	:global(.api-ref) pre {
		margin-bottom: 0.5rem;
	}

	code {
		background: #191b22;
		padding: 0.15rem 0.35rem;
		border-radius: 4px;
		font-size: 0.84rem;
	}

	ol {
		margin: 0;
		padding-left: 1.2rem;
		line-height: 1.6;
	}

	.muted {
		color: var(--text-secondary);
		margin: 0;
	}

	ul {
		margin: 0;
		padding-left: 1rem;
		line-height: 1.6;
	}

	@media (max-width: 720px) {
		.secret-row {
			flex-direction: column;
		}
	}
</style>
