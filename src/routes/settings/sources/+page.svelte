<script lang="ts">
	import { AppPage, Button, Input, PageHeader, PageSection, Select } from '$lib/components/ui';
	import {
		WithingsSourceCard,
		Sparebank1SourceCard,
		SpondSourceCard,
		GoogleSheetsSourceCard,
		StravaSourceCard,
		EmailRulesCard
	} from '$lib/components/settings';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let webhook = $state(data.user?.googleChatWebhook || '');
	let timezone = $state(data.user?.timezone || 'Europe/Oslo');
	let savingSourceConfig = $state(false);
	let sourceConfigResult = $state<{ success: boolean; message: string } | null>(null);

	// Track connected state from child components
	let withingsConnected = $state(false);
	let sparebank1Connected = $state(false);
	let googleSheetsConnected = $state(false);
	let spondConnected = $state(false);

	const connectedCount = $derived(
		(withingsConnected ? 1 : 0) +
		(sparebank1Connected ? 1 : 0) +
		(googleSheetsConnected ? 1 : 0) +
		(spondConnected ? 1 : 0) +
		(webhook.trim().length > 0 ? 1 : 0)
	);

	async function saveSourceConfig() {
		savingSourceConfig = true;
		sourceConfigResult = null;
		try {
			const res = await fetch('/api/settings/sources', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					googleChatWebhook: webhook.trim() || null,
					timezone
				})
			});
			if (!res.ok) throw new Error('Kunne ikke lagre kildeinnstillinger');
			sourceConfigResult = { success: true, message: 'Kildeinnstillinger lagret.' };
		} catch (error) {
			sourceConfigResult = {
				success: false,
				message: error instanceof Error ? error.message : 'Ukjent feil'
			};
		} finally {
			savingSourceConfig = false;
		}
	}
</script>

<AppPage className="sources-page">
	<PageSection>
	<PageHeader
		title="Kilder"
		subtitle={`${connectedCount}/4 tilkoblet`}
		titleHref="/settings"
		titleLabel="Gå til innstillinger"
	/>

	<div class="sources-content">
		<section class="card">
			<h2>Google Chat og tidssone</h2>
			<div class="field">
				<label for="webhook">Webhook URL</label>
				<Input id="webhook" className="input" type="url" bind:value={webhook} placeholder="https://chat.googleapis.com/v1/spaces/..." />
			</div>
			<div class="field">
				<label for="timezone">Tidssone</label>
				<Select id="timezone" className="input" bind:value={timezone}>
					<option value="Europe/Oslo">Europe/Oslo</option>
					<option value="Europe/Copenhagen">Europe/Copenhagen</option>
					<option value="Europe/Stockholm">Europe/Stockholm</option>
					<option value="UTC">UTC</option>
				</Select>
			</div>
			<Button onClick={saveSourceConfig} disabled={savingSourceConfig}>
				{savingSourceConfig ? 'Lagrer...' : 'Lagre'}
			</Button>
			{#if sourceConfigResult}
				<p class={sourceConfigResult.success ? 'ok' : 'err'}>{sourceConfigResult.message}</p>
			{/if}
		</section>

		<WithingsSourceCard onConnectedChange={(c) => withingsConnected = c} />
		<SpondSourceCard onConnectedChange={(c) => spondConnected = c} />
		<Sparebank1SourceCard onConnectedChange={(c) => sparebank1Connected = c} />
		<EmailRulesCard
			emailWebhookConfigured={data.emailWebhookConfigured}
			emailEndpoint={data.emailEndpoint}
			emailAppsScriptSource={data.emailAppsScriptSource}
			emailImports={data.emailImports}
			userEmail={data.user?.email}
		/>
		<GoogleSheetsSourceCard onConnectedChange={(c) => googleSheetsConnected = c} />
		<StravaSourceCard />
	</div>
	</PageSection>
</AppPage>

<style>
	:global(.sources-page) {
		color: var(--text-secondary);
		--surface: var(--bg-card);
		--surface-soft: var(--bg-card);
		--surface-strong: var(--bg-card);
		--line: var(--border-color);
		--accent: var(--accent-primary);
	}

	.sources-content {
		display: flex;
		flex-direction: column;
		gap: 0.95rem;
	}

	.card,
	:global(.sources-content > section.card) {
		background: var(--surface);
		border: none;
		border-radius: var(--radius-lg);
		padding: 1rem 1rem 1.05rem;
		box-shadow: none;
	}
	:global(.sources-content > section.card h2) {
		margin: 0 0 0.55rem;
		color: var(--text-primary);
		font-size: 1rem;
		font-weight: 620;
	}
	.field { margin-bottom: 0.9rem; }
	.field label { display: block; margin-bottom: 0.4rem; color: var(--text-secondary); font-size: 0.82rem; }
	:global(.input) {
		width: 100%;
		padding: 0.65rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-secondary);
		color: var(--text-primary);
	}
	:global(.input:focus) {
		outline: none;
		border-color: var(--accent);
		box-shadow: 0 0 0 2px rgba(74, 90, 240, 0.18);
	}
	:global(.days-input) { width: 6rem; padding: 0.35rem 0.45rem; }
	:global(.btn-primary), :global(.btn-secondary), :global(.btn-ghost) { text-decoration: none; }
	.ok { color: var(--success-text); margin: 0.6rem 0 0; }
	.err { color: var(--error-text); margin: 0.6rem 0 0; }
	:global(.sources-content .muted) { color: var(--text-tertiary); }

	@media (max-width: 720px) {
		.sources-content {
			gap: 0.8rem;
		}
	}
</style>
