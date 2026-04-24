<script lang="ts">
	import { AppPage, Button, Input, PageHeader } from '$lib/components/ui';
	import { onMount } from 'svelte';

	interface TaskRule {
		id: string;
		category: string;
		keywords: string[];
		priority: number;
		active: boolean;
		description: string | null;
		updatedAt: string;
	}

	let rules = $state<TaskRule[]>([]);
	let loading = $state(true);
	let saving = $state(false);
	let deleting = $state<string | null>(null);
	let editingRule = $state<TaskRule | null>(null);
	let showNewRuleForm = $state(false);

	let newRule = $state({
		category: '',
		keywords: '',
		priority: 2,
		description: ''
	});

	onMount(async () => {
		await loadRules();
	});

	async function loadRules() {
		loading = true;
		try {
			const res = await fetch('/api/task-classification-rules');
			if (res.ok) {
				const data = await res.json();
				rules = data.rules || [];
			}
		} catch (err) {
			console.error('Failed to load rules:', err);
		} finally {
			loading = false;
		}
	}

	async function saveRule() {
		if (!newRule.category.trim() || !newRule.keywords.trim()) {
			alert('Kategori og keywords må fylles ut');
			return;
		}

		saving = true;
		try {
			const keywords = newRule.keywords
				.split(',')
				.map((k) => k.trim())
				.filter(Boolean);

			const res = await fetch('/api/task-classification-rules', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					category: newRule.category.trim(),
					keywords,
					priority: newRule.priority,
					description: newRule.description.trim() || null
				})
			});

			if (res.ok) {
				newRule = { category: '', keywords: '', priority: 2, description: '' };
				showNewRuleForm = false;
				await loadRules();
			} else {
				const data = await res.json();
				alert(data.error || 'Kunne ikke lagre regel');
			}
		} catch (err) {
			console.error('Failed to save rule:', err);
			alert('Feil ved lagring');
		} finally {
			saving = false;
		}
	}

	async function toggleRuleActive(rule: TaskRule) {
		try {
			const res = await fetch(`/api/task-classification-rules/${rule.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ active: !rule.active })
			});

			if (res.ok) {
				await loadRules();
			} else {
				alert('Kunne ikke oppdatere regel');
			}
		} catch (err) {
			console.error('Failed to toggle rule:', err);
			alert('Feil ved oppdatering');
		}
	}

	async function deleteRule(id: string) {
		if (!confirm('Slett denne regelen permanent?')) return;

		deleting = id;
		try {
			const res = await fetch(`/api/task-classification-rules/${id}`, { method: 'DELETE' });
			if (res.ok) {
				await loadRules();
			} else {
				alert('Kunne ikke slette regel');
			}
		} catch (err) {
			console.error('Failed to delete rule:', err);
			alert('Feil ved sletting');
		} finally {
			deleting = null;
		}
	}
</script>

<AppPage width="full" theme="dark" className="rules-page">
	<PageHeader
		title="Oppgaveklassifisering"
		titleHref="/settings/classification"
		titleLabel="Gå til klassifisering"
	/>

	<main class="content">
		<section class="info-box">
			<h2>Globale matchingregler</h2>
			<p>
				Disse reglene matcher aktiviteter mot oppgaver basert på keywords i mål/oppgavetitler.
				Når en aktivitet logges, får oppgaver poeng basert på hvor mange keywords som matcher.
			</p>
		</section>

		<section class="actions-section">
			<Button
				type="button"
				onClick={() => showNewRuleForm = !showNewRuleForm}
			>
				{showNewRuleForm ? '✕ Avbryt' : '➕ Ny regel'}
			</Button>
		</section>

		{#if showNewRuleForm}
			<section class="new-rule-form">
				<h3>Opprett ny regel</h3>
				<div class="form-group">
					<label for="category">Kategori</label>
					<Input
						id="category"
						bind:value={newRule.category}
						placeholder="workout, relationship, mental..."
					/>
				</div>
				<div class="form-group">
					<label for="keywords">Keywords (kommaseparert)</label>
					<Input
						id="keywords"
						bind:value={newRule.keywords}
						placeholder="trening, løp, km, workout"
					/>
					<small class="hint">Skriv inn keywords separert med komma</small>
				</div>
				<div class="form-group">
					<label for="priority">Poeng per keyword-match</label>
					<Input
						id="priority"
						type="number"
						bind:value={newRule.priority}
						min="1"
						max="10"
					/>
				</div>
				<div class="form-group">
					<label for="description">Beskrivelse (valgfri)</label>
					<Input
						id="description"
						bind:value={newRule.description}
						placeholder="For eksempel: Matches workout and exercise activities"
					/>
				</div>
				<div class="form-actions">
					<Button type="button" onClick={saveRule} disabled={saving}>
						{saving ? 'Lagrer...' : 'Lagre regel'}
					</Button>
					<Button variant="ghost" type="button" onClick={() => showNewRuleForm = false}>
						Avbryt
					</Button>
				</div>
			</section>
		{/if}

		{#if loading}
			<div class="loading">Laster regler...</div>
		{:else}
			<section class="rules-section">
				<h2>Aktive regler ({rules.filter(r => r.active).length}/{rules.length})</h2>
				{#if rules.length === 0}
					<p class="empty">Ingen regler enda. Opprett den første!</p>
				{:else}
					<ul class="rule-list">
						{#each rules as rule}
							<li class="rule-item" class:inactive={!rule.active}>
								<div class="rule-main">
									<div class="rule-header">
										<div class="rule-category">{rule.category}</div>
										<div class="rule-priority">Poeng: {rule.priority}</div>
									</div>
									<div class="rule-keywords">
										{#each rule.keywords as keyword}
											<span class="keyword-badge">{keyword}</span>
										{/each}
									</div>
									{#if rule.description}
										<div class="rule-description">{rule.description}</div>
									{/if}
								</div>
								<div class="rule-actions">
									<button
										type="button"
										class="toggle-btn"
										onclick={() => toggleRuleActive(rule)}
										aria-label={rule.active ? 'Deaktiver' : 'Aktiver'}
										title={rule.active ? 'Deaktiver regel' : 'Aktiver regel'}
									>
										{rule.active ? '✓' : '◯'}
									</button>
									<button
										type="button"
										class="delete-btn"
										disabled={deleting === rule.id}
										onclick={() => deleteRule(rule.id)}
										aria-label="Slett regel"
									>
										{deleting === rule.id ? '...' : '🗑'}
									</button>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/if}
	</main>
</AppPage>

<style>
	:global(.rules-page) { color: #aaa; }

	.content {
		padding: 1.5rem 1rem;
	}

	.info-box {
		background: #171717;
		border: none;
		border-radius: 12px;
		padding: 1.25rem;
		margin-bottom: 1.5rem;
	}

	.info-box h2 {
		margin: 0 0 0.5rem 0;
		font-size: 1rem;
		font-weight: 600;
		color: #ddd;
	}

	.info-box p {
		margin: 0;
		font-size: 0.9rem;
		line-height: 1.5;
		color: #999;
	}

	.actions-section {
		margin-bottom: 1.5rem;
	}

	.new-rule-form {
		background: #171717;
		border: none;
		border-radius: 12px;
		padding: 1.5rem;
		margin-bottom: 2rem;
	}

	.new-rule-form h3 {
		margin: 0 0 1rem 0;
		font-size: 1.1rem;
		font-weight: 600;
		color: #ddd;
	}

	.form-group {
		margin-bottom: 1rem;
	}

	.form-group label {
		display: block;
		margin-bottom: 0.5rem;
		font-size: 0.9rem;
		font-weight: 600;
		color: #bbb;
	}

	.hint {
		display: block;
		margin-top: 0.5rem;
		font-size: 0.8rem;
		color: #666;
	}

	.form-actions {
		display: flex;
		gap: 0.75rem;
		margin-top: 1.5rem;
	}

	.loading {
		text-align: center;
		padding: 3rem 0;
		color: #666;
	}

	.rules-section {
		margin-bottom: 2rem;
	}

	.rules-section h2 {
		margin: 0 0 1rem 0;
		font-size: 1.1rem;
		font-weight: 600;
		color: #ddd;
	}

	.empty {
		color: #666;
		font-size: 0.9rem;
		padding: 1.5rem 0;
		text-align: center;
	}

	.rule-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.rule-item {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		background: #171717;
		border: none;
		border-radius: 10px;
		padding: 1rem;
	}

	.rule-item.inactive {
		opacity: 0.5;
	}

	.rule-main {
		flex: 1;
		min-width: 0;
	}

	.rule-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.5rem;
	}

	.rule-category {
		font-size: 1rem;
		font-weight: 600;
		color: #eee;
	}

	.rule-priority {
		font-size: 0.75rem;
		color: #888;
	}

	.rule-keywords {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}

	.keyword-badge {
		background: #222;
		border: none;
		border-radius: 6px;
		padding: 0.25rem 0.5rem;
		font-size: 0.8rem;
		color: #aaa;
	}

	.rule-description {
		font-size: 0.8rem;
		color: #777;
		font-style: italic;
	}

	.rule-actions {
		display: flex;
		gap: 0.5rem;
	}

	.toggle-btn {
		background: transparent;
		border: none;
		border-radius: 8px;
		padding: 0.5rem 0.75rem;
		color: #4ade80;
		font-size: 1rem;
		cursor: pointer;
		transition: all 0.15s;
	}

	.toggle-btn:hover {
		background: rgba(74, 222, 128, 0.08);
		border-color: rgba(74, 222, 128, 0.2);
	}

	.delete-btn {
		background: transparent;
		border: none;
		border-radius: 8px;
		padding: 0.5rem 0.75rem;
		color: #e07070;
		font-size: 1rem;
		cursor: pointer;
		transition: all 0.15s;
		flex-shrink: 0;
	}

	.delete-btn:hover:not(:disabled) {
		background: rgba(224, 112, 112, 0.08);
		border-color: #6a2a2a;
	}

	.delete-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
