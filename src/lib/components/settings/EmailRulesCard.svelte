<script lang="ts">
	import { Button, Input, Select } from '$lib/components/ui';
	import { onMount } from 'svelte';

	type EmailImports = {
		last7Days: number;
		workouts: number;
		libraryItems: number;
	};

	type Person = { id: string; name: string; kind?: string };

	interface Props {
		emailWebhookConfigured: boolean;
		emailEndpoint: string;
		emailAppsScriptSource: string | null;
		emailImports: EmailImports;
		userEmail?: string | null;
		people?: Person[];
	}

	let { emailWebhookConfigured, emailEndpoint, emailAppsScriptSource, emailImports, userEmail, people = [] }: Props = $props();

	let emailScriptCopied = $state(false);
	let emailEndpointCopied = $state(false);
	let emailTestRunning = $state(false);
	let emailTestResult = $state<{ ok: boolean; message: string } | null>(null);
	let emailGuideOpen = $state(false);

	// Email rules
	type EmailRule = {
		id: string;
		name: string;
		labelPattern: string | null;
		senderPattern: string | null;
		subjectPattern: string | null;
		processingType: string;
		extractionPrompt: string | null;
		personId: string | null;
		eventType: string;
		dataType: string;
		isActive: boolean;
		lastMatchedAt: string | null;
		matchCount: number;
	};
	let emailRulesData = $state<EmailRule[]>([]);
	let loadingEmailRules = $state(false);
	let showEmailRuleForm = $state(false);
	let editingRuleId = $state<string | null>(null);
	let ruleForm = $state({
		name: '',
		labelPattern: '',
		senderPattern: '',
		subjectPattern: '',
		processingType: 'workout_files' as string,
		extractionPrompt: '',
		personId: '' as string,
		eventType: 'email_content',
		dataType: 'email',
	});
	let savingRule = $state(false);
	let ruleResult = $state<{ success: boolean; message: string } | null>(null);

	async function loadEmailRules() {
		loadingEmailRules = true;
		try {
			const res = await fetch('/api/settings/email-rules');
			if (res.ok) emailRulesData = await res.json();
		} finally {
			loadingEmailRules = false;
		}
	}

	onMount(() => { loadEmailRules(); });

	async function copyToClipboard(text: string): Promise<boolean> {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			return false;
		}
	}

	async function copyAppsScript() {
		if (!emailAppsScriptSource) return;
		const ok = await copyToClipboard(emailAppsScriptSource);
		if (ok) {
			emailScriptCopied = true;
			setTimeout(() => (emailScriptCopied = false), 2000);
		}
	}

	async function copyEmailEndpoint() {
		const ok = await copyToClipboard(emailEndpoint);
		if (ok) {
			emailEndpointCopied = true;
			setTimeout(() => (emailEndpointCopied = false), 2000);
		}
	}

	async function runEmailTest() {
		if (!userEmail) {
			emailTestResult = { ok: false, message: 'Mangler bruker-e-post.' };
			return;
		}
		emailTestRunning = true;
		emailTestResult = null;
		try {
			const dueDate = new Date();
			dueDate.setDate(dueDate.getDate() + 7);
			const dd = String(dueDate.getDate()).padStart(2, '0');
			const mm = String(dueDate.getMonth() + 1).padStart(2, '0');
			const yyyy = dueDate.getFullYear();

			const res = await fetch('/api/settings/email-test', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					gmailMessageId: `test-${Date.now()}`,
					gmailThreadId: `test-thread-${Date.now()}`,
					internalDate: Date.now(),
					from: 'no-reply@bibliotek.no',
					to: userEmail,
					subject: 'Lånefrist nærmer seg',
					bodyText: `Hei!\n\nDu må levere boken "Resonans testbok" innen ${dd}.${mm}.${yyyy}.\n\nVennlig hilsen,\nBiblioteket`,
					label: 'Resonans/Bibliotek',
					attachments: []
				})
			});
			const body = await res.json();
			if (res.ok) {
				emailTestResult = {
					ok: true,
					message: `Test-respons: ${JSON.stringify(body)}`
				};
			} else {
				emailTestResult = {
					ok: false,
					message: `Status ${res.status}: ${JSON.stringify(body)}`
				};
			}
		} catch (err) {
			emailTestResult = {
				ok: false,
				message: err instanceof Error ? err.message : String(err)
			};
		} finally {
			emailTestRunning = false;
		}
	}

	function resetRuleForm() {
		ruleForm = {
			name: '', labelPattern: '', senderPattern: '', subjectPattern: '',
			processingType: 'workout_files', extractionPrompt: '', personId: '',
			eventType: 'email_content', dataType: 'email',
		};
		editingRuleId = null;
		showEmailRuleForm = false;
		ruleResult = null;
	}

	function editRule(rule: EmailRule) {
		ruleForm = {
			name: rule.name,
			labelPattern: rule.labelPattern ?? '',
			senderPattern: rule.senderPattern ?? '',
			subjectPattern: rule.subjectPattern ?? '',
			processingType: rule.processingType,
			extractionPrompt: rule.extractionPrompt ?? '',
			personId: rule.personId ?? '',
			eventType: rule.eventType,
			dataType: rule.dataType,
		};
		editingRuleId = rule.id;
		showEmailRuleForm = true;
		ruleResult = null;
	}

	async function saveEmailRule() {
		savingRule = true;
		ruleResult = null;
		try {
			const method = editingRuleId ? 'PATCH' : 'POST';
			const body = editingRuleId
				? { id: editingRuleId, ...ruleForm }
				: ruleForm;
			const res = await fetch('/api/settings/email-rules', {
				method,
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!res.ok) {
				const err = await res.json();
				throw new Error(err.error || 'Kunne ikke lagre regel');
			}
			ruleResult = { success: true, message: editingRuleId ? 'Regel oppdatert' : 'Regel opprettet' };
			resetRuleForm();
			await loadEmailRules();
		} catch (error) {
			ruleResult = { success: false, message: error instanceof Error ? error.message : 'Ukjent feil' };
		} finally {
			savingRule = false;
		}
	}

	async function toggleRule(rule: EmailRule) {
		await fetch('/api/settings/email-rules', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ id: rule.id, isActive: !rule.isActive })
		});
		await loadEmailRules();
	}

	async function deleteRule(rule: EmailRule) {
		if (!confirm(`Slett regelen "${rule.name}"?`)) return;
		await fetch('/api/settings/email-rules', {
			method: 'DELETE',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ id: rule.id })
		});
		await loadEmailRules();
	}
</script>

<section class="card">
	<h2>E-post</h2>
	<p class="field-title">Konfigurer hvilke e-poster som skal importeres fra Gmail og hvordan de prosesseres.</p>

	{#if !emailWebhookConfigured}
		<p class="err">
			<code>EMAIL_WEBHOOK_SECRET</code> er ikke satt på serveren. Be admin
			generere en hemmelighet og deploye på nytt.
		</p>
	{:else}
		<div class="email-stats">
			<span class="ok">Aktiv</span>
			<span class="muted">·</span>
			<span>{emailImports.last7Days} e-poster siste 7 dager</span>
			{#if emailImports.last7Days > 0}
				<span class="muted">
					({emailImports.workouts} treninger, {emailImports.libraryItems} bibliotek)
				</span>
			{/if}
		</div>
	{/if}

	<h3>Regler</h3>
	{#if loadingEmailRules}
		<p>Laster...</p>
	{:else}
		{#if emailRulesData.length > 0}
			<div class="email-rules-list">
				{#each emailRulesData as rule}
					<div class="email-rule-item" class:rule-inactive={!rule.isActive}>
						<div class="email-rule-header">
							<div class="email-rule-info">
								<strong>{rule.name}</strong>
								<span class="email-rule-type">{rule.processingType === 'ai_extraction' ? 'AI-ekstraksjon' : rule.processingType === 'workout_files' ? 'Treningsfiler' : rule.processingType === 'library' ? 'Bibliotek' : rule.processingType === 'school_plan' ? 'Skole/barnehage' : 'Rå lagring'}</span>
								{#if rule.personId}
									<span class="email-rule-person">Person: {people.find((p) => p.id === rule.personId)?.name ?? '—'}</span>
								{/if}
							</div>
							<div class="email-rule-actions">
								<button class="rule-toggle" onclick={() => toggleRule(rule)} title={rule.isActive ? 'Deaktiver' : 'Aktiver'}>
									{rule.isActive ? 'På' : 'Av'}
								</button>
								<button class="rule-edit" onclick={() => editRule(rule)}>Rediger</button>
								<button class="rule-delete" onclick={() => deleteRule(rule)}>Slett</button>
							</div>
						</div>
						<div class="email-rule-filters">
							{#if rule.labelPattern}
								<span class="filter-chip">Label: {rule.labelPattern}</span>
							{/if}
							{#if rule.senderPattern}
								<span class="filter-chip">Avsender: {rule.senderPattern}</span>
							{/if}
							{#if rule.subjectPattern}
								<span class="filter-chip">Emne: {rule.subjectPattern}</span>
							{/if}
							{#if !rule.labelPattern && !rule.senderPattern && !rule.subjectPattern}
								<span class="filter-chip filter-warn">Ingen filter — matcher alle e-poster</span>
							{/if}
						</div>
						{#if rule.matchCount > 0}
							<p class="email-rule-stats">Treff: {rule.matchCount}{rule.lastMatchedAt ? ` · Sist: ${new Date(rule.lastMatchedAt).toLocaleDateString('nb-NO')}` : ''}</p>
						{/if}
					</div>
				{/each}
			</div>
		{:else if !showEmailRuleForm}
			<p style="color: var(--text-tertiary); font-size: 0.84rem;">Ingen regler ennå. Opprett en regel for å begynne å importere e-poster.</p>
		{/if}

		{#if showEmailRuleForm}
			<div class="email-rule-form">
				<h3>{editingRuleId ? 'Rediger regel' : 'Ny regel'}</h3>
				<div class="field">
					<label for="rule-name">Navn *</label>
					<Input id="rule-name" className="input" bind:value={ruleForm.name} placeholder="f.eks. Treningsklokke" />
				</div>
				<div class="field">
					<label for="rule-label">Gmail-label</label>
					<Input id="rule-label" className="input" bind:value={ruleForm.labelPattern} placeholder="f.eks. Resonans/Trening" />
					<p class="field-hint">Matcher e-poster med denne Gmail-labelen. Apps Script sender kun e-poster med labels som starter med «Resonans/».</p>
				</div>
				<div class="field">
					<label for="rule-sender">Avsender-filter</label>
					<Input id="rule-sender" className="input" bind:value={ruleForm.senderPattern} placeholder="f.eks. *@oda.com eller noreply@spond.com" />
					<p class="field-hint">Bruk * som wildcard. La stå tom for å matche alle avsendere.</p>
				</div>
				<div class="field">
					<label for="rule-subject">Emne-filter</label>
					<Input id="rule-subject" className="input" bind:value={ruleForm.subjectPattern} placeholder="f.eks. Ordrebekreftelse" />
					<p class="field-hint">Matcher om emnet inneholder teksten.</p>
				</div>
				<div class="field">
					<label for="rule-type">Prosessering</label>
					<Select id="rule-type" className="input" bind:value={ruleForm.processingType}>
						<option value="workout_files">Treningsfiler (GPX/TCX-vedlegg)</option>
						<option value="library">Bibliotek (lånefrist → sjekkliste)</option>
						<option value="ai_extraction">AI-ekstraksjon (GPT trekker ut data)</option>
						<option value="school_plan">Skole/barnehage (planer → dagsoppgaver + nudge)</option>
						<option value="raw_store">Rå lagring (lagre som tekst)</option>
					</Select>
				</div>
				{#if ruleForm.processingType === 'ai_extraction' || ruleForm.processingType === 'school_plan'}
					<div class="field">
						<label for="rule-prompt">Tilpasset AI-prompt (valgfritt)</label>
						<textarea id="rule-prompt" class="input" bind:value={ruleForm.extractionPrompt} rows="4" placeholder="La stå tom for standard-ekstraksjon. Skriv en tilpasset prompt for spesifikke behov."></textarea>
						{#if ruleForm.processingType === 'school_plan'}
							<p class="field-hint">Brukes i tillegg til standard skole-/barnehage-uttrekket. Bra for kilde-spesifikke vink (hvilket barn, hva som skal ignoreres osv.).</p>
						{/if}
					</div>
				{/if}
				{#if ruleForm.processingType === 'school_plan'}
					<div class="field">
						<label for="rule-person">Knytt til person</label>
						<Select id="rule-person" className="input" bind:value={ruleForm.personId}>
							<option value="">Ingen / utled fra innhold</option>
							{#each people as person}
								<option value={person.id}>{person.name}</option>
							{/each}
						</Select>
						<p class="field-hint">Oppgaver fra denne kilden tilskrives dette barnet (f.eks. barnehage-label → barnet). AI-en kan overstyre per punkt hvis et annet navn nevnes tydelig.</p>
					</div>
				{/if}
				<div class="row">
					<Button onClick={saveEmailRule} disabled={savingRule || !ruleForm.name.trim()}>
						{savingRule ? 'Lagrer...' : editingRuleId ? 'Oppdater' : 'Opprett'}
					</Button>
					<Button variant="ghost" onClick={resetRuleForm}>Avbryt</Button>
				</div>
				{#if ruleResult}
					<p class={ruleResult.success ? 'ok' : 'err'}>{ruleResult.message}</p>
				{/if}
			</div>
		{:else}
			<Button variant="secondary" onClick={() => { showEmailRuleForm = true; ruleResult = null; }}>
				Legg til regel
			</Button>
		{/if}
	{/if}

	{#if emailWebhookConfigured}
		<hr class="section-divider" />
		<h3>Gmail-tilkobling (Apps Script)</h3>
		<p class="muted">
			Et Apps Script i Google overvåker Gmail-labeler som starter med «Resonans/» og sender
			matchende e-poster hit. Opprett reglene over først — de bestemmer hva som prosesseres.
		</p>

		<div class="field">
			<p class="field-title">Endepunkt</p>
			<div class="row">
				<code class="endpoint-code">{emailEndpoint}</code>
				<Button variant="secondary" onClick={copyEmailEndpoint}>
					{emailEndpointCopied ? 'Kopiert ✓' : 'Kopier'}
				</Button>
			</div>
		</div>

		<div class="field">
			<p class="field-title">Apps Script-kildekode</p>
			<p class="muted">
				Lim inn dette i <a href="https://script.google.com" target="_blank" rel="noopener">script.google.com</a>
				→ nytt prosjekt → <code>Code.gs</code>. Endepunkt og token er
				pre-utfylt. Sett en tidsutløser som kjører <code>syncResonans</code>
				hvert 5. minutt.
			</p>
			<div class="row">
				<Button variant="secondary" onClick={copyAppsScript}>
					{emailScriptCopied ? 'Kopiert ✓' : 'Kopier kildekode'}
				</Button>
			</div>

			{#if emailAppsScriptSource}
				<details bind:open={emailGuideOpen} class="apps-script-details">
					<summary>Vis kildekode</summary>
					<pre class="apps-script-code"><code>{emailAppsScriptSource}</code></pre>
				</details>
			{/if}
		</div>

		<details class="email-guide">
			<summary>Trinnvis oppsett-guide</summary>
			<ol class="email-guide-list">
				<li>
					Opprett Gmail-labels med prefiks <code>Resonans/</code> som matcher reglene du har laget over
					(f.eks. <code>Resonans/Trening</code>).
				</li>
				<li>
					Sett opp filtre i Gmail for å auto-merke relevante e-poster.
					(Innstillinger → Filtre og blokkerte adresser → Opprett filter →
					Bruk label.)
				</li>
				<li>
					Åpne <a href="https://script.google.com" target="_blank" rel="noopener">script.google.com</a>,
					opprett et nytt prosjekt, lim inn kildekoden over i <code>Code.gs</code>.
				</li>
				<li>
					Klikk <em>Run</em> én gang for å autorisere scriptet (Google ber om
					tilgang til Gmail).
				</li>
				<li>
					Sett en tidsutløser: klokke-ikonet → <em>Add Trigger</em> →
					funksjon <code>syncResonans</code>, type <em>Time-driven</em>,
					intervall <em>Every 5 minutes</em>.
				</li>
				<li>
					Test ved å merke en e-post med en Resonans-label og vente
					5 minutter — regelen over bestemmer hva som skjer med e-posten.
				</li>
			</ol>
		</details>
	{/if}
</section>

<style>
	.ok { color: var(--success-text); margin: 0.6rem 0 0; }
	.err { color: var(--error-text); margin: 0.6rem 0 0; }
	.field { margin-bottom: 0.9rem; }
	.field label { display: block; margin-bottom: 0.4rem; color: var(--text-secondary); font-size: 0.82rem; }
	.field-title { margin: 0 0 0.4rem; color: var(--text-secondary); font-size: 0.82rem; }
	.row { display: flex; gap: 0.6rem; flex-wrap: wrap; }

	/* Email rules */
	.email-rules-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}
	.email-rule-item {
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		padding: 0.6rem 0.75rem;
		background: var(--bg-primary);
	}
	.email-rule-item.rule-inactive {
		opacity: 0.5;
	}
	.email-rule-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
	}
	.email-rule-info {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}
	.email-rule-info strong {
		color: var(--text-primary);
		font-size: 0.88rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.email-rule-type {
		font-size: 0.72rem;
		background: #1a2a3a;
		color: #6ea8e7;
		padding: 0.15rem 0.4rem;
		border-radius: 4px;
		white-space: nowrap;
	}
	.email-rule-person {
		font-size: 0.72rem;
		background: #2a1a2e;
		color: #d59ae7;
		padding: 0.15rem 0.4rem;
		border-radius: 4px;
		white-space: nowrap;
	}
	.email-rule-actions {
		display: flex;
		gap: 0.3rem;
		flex-shrink: 0;
	}
	.email-rule-actions button {
		font-size: 0.76rem;
		padding: 0.2rem 0.45rem;
		border-radius: 5px;
		border: 1px solid var(--border-color);
		background: transparent;
		color: var(--text-secondary);
		cursor: pointer;
	}
	.email-rule-actions button:hover { background: var(--border-subtle); }
	.rule-delete:hover { color: #e74c4c !important; border-color: #e74c4c !important; }
	.rule-toggle { min-width: 2rem; text-align: center; }
	.email-rule-filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin-top: 0.35rem;
	}
	.filter-chip {
		font-size: 0.74rem;
		background: #1a1a2a;
		color: #9a9ac0;
		padding: 0.12rem 0.4rem;
		border-radius: 4px;
	}
	.filter-warn { background: #2a2a1a; color: #c0b060; }
	.email-rule-stats {
		font-size: 0.74rem;
		color: var(--text-tertiary);
		margin: 0.25rem 0 0;
	}
	.email-rule-form {
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		padding: 0.75rem;
		background: var(--bg-primary);
		margin-top: 0.5rem;
	}
	.email-rule-form h3 {
		margin: 0 0 0.5rem;
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-primary);
	}
	.field-hint {
		font-size: 0.74rem;
		color: var(--text-tertiary);
		margin: 0.2rem 0 0;
	}
	.email-rule-form textarea.input {
		width: 100%;
		padding: 0.65rem;
		border: 1px solid var(--line, var(--border-color));
		border-radius: var(--radius-md);
		background: var(--surface-soft, var(--bg-card));
		color: inherit;
		font-family: inherit;
		font-size: 0.84rem;
		resize: vertical;
	}

	/* Email source */
	.email-stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
		font-size: 0.88rem;
		margin: 0 0 0.5rem;
	}
	.section-divider {
		border: none;
		border-top: 1px solid var(--border-color);
		margin: 1rem 0;
	}
	.endpoint-code {
		flex: 1;
		min-width: 0;
		overflow-x: auto;
		white-space: nowrap;
		font-family: monospace;
		font-size: 0.82rem;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--border-color);
		border-radius: 6px;
		background: var(--bg-elevated);
		color: var(--text-secondary);
	}
	.apps-script-details summary,
	.email-guide summary {
		cursor: pointer;
		font-size: 0.86rem;
		color: var(--text-secondary);
		padding: 0.3rem 0;
	}
	.apps-script-code {
		max-height: 22rem;
		overflow: auto;
		padding: 0.75rem;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-primary);
		font-family: monospace;
		font-size: 0.78rem;
		line-height: 1.45;
		color: var(--text-secondary);
		margin: 0.5rem 0 0;
	}
	.email-guide-list {
		margin: 0.5rem 0 0;
		padding-left: 1.2rem;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		font-size: 0.86rem;
		color: var(--text-secondary);
	}
	.email-guide-list code {
		font-family: monospace;
		font-size: 0.8rem;
		padding: 0.05rem 0.3rem;
		border-radius: 4px;
		background: var(--bg-card);
	}

	@media (max-width: 720px) {
		.email-rule-header {
			flex-direction: column;
			align-items: flex-start;
		}
	}
</style>
