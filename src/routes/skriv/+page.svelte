<!--
  Skriveprosjekter — lista.

  Toppnivå-rute, søsken til /notater. Bok-domenet bor under tema, men her ville
  det kostet en ny DashboardKind i THEME_DASHBOARD_MATCHERS, der «skriv» er 5
  tegn og matcher som delstreng. Prosjektet kan fortsatt knyttes til et tema via
  writing_projects.themeId. Se docs/changelog/2026-08-07-skriveprosjekt.md.
-->
<script lang="ts">
	import { AppPage, PageSection, PageHeader, Input, Textarea, Button } from '$lib/components/ui';
	import { extractApiErrorMessage } from '$lib/client/api-error';
	import { goto } from '$app/navigation';

	let { data } = $props();

	let projects = $state(data.projects);
	let creating = $state(false);
	let saving = $state(false);
	let error = $state<string | null>(null);

	let title = $state('');
	let genre = $state('');
	let summary = $state('');

	async function create() {
		if (!title.trim()) {
			error = 'Prosjektet trenger en tittel.';
			return;
		}
		saving = true;
		error = null;
		try {
			const res = await fetch('/api/skriveprosjekt', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ title, genre, summary })
			});
			if (!res.ok) {
				error = extractApiErrorMessage(res.status, await res.text());
				return;
			}
			const project = await res.json();
			await goto(`/skriv/${project.id}`);
		} catch (err) {
			error = `Kunne ikke opprette: ${err instanceof Error ? err.message : String(err)}`;
		} finally {
			saving = false;
		}
	}

	function fmt(iso: string): string {
		return new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short' }).format(new Date(iso));
	}
</script>

<AppPage>
	<PageSection>
		<PageHeader title="Skriving" titleHref="/" />

		<!-- Streaken teller dager skrevet, ikke ord: en kveld med tung redigering
		     gir negativ ordproduksjon og er likevel en kveld du skrev. -->
		<p class="streak">
			{#if data.streak.days > 0}🔥 {/if}{data.streak.label}
			{#if data.streak.wroteToday}<span class="today">Skrevet i dag.</span>{/if}
		</p>

		{#if creating}
			<div class="form">
				<Input bind:value={title} placeholder="Tittel" dataTrack="skriv:nytt-prosjekt-tittel" ariaLabel="Tittel" />
				<Input bind:value={genre} placeholder="Sjanger (roman, diktsamling…)" dataTrack="skriv:nytt-prosjekt-sjanger" ariaLabel="Sjanger" />
				<Textarea bind:value={summary} rows={3} placeholder="Premiss — hva handler det om?" dataTrack="skriv:nytt-prosjekt-premiss" ariaLabel="Premiss" />
				{#if error}<p class="error" role="alert">{error}</p>{/if}
				<div class="actions">
					<Button onClick={create} disabled={saving}>{saving ? 'Oppretter…' : 'Opprett'}</Button>
					<Button variant="ghost" onClick={() => (creating = false)}>Avbryt</Button>
				</div>
			</div>
		{:else}
			<div class="toolbar">
				<Button onClick={() => (creating = true)}>Nytt skriveprosjekt</Button>
				<a class="link" href="/notater">Notatblokka</a>
			</div>
			{#if error}<p class="error" role="alert">{error}</p>{/if}
		{/if}

		{#if projects.length === 0}
			<p class="empty">
				Ingen skriveprosjekter ennå. Et prosjekt samler scener, karakterer og steder — og får
				sin egen kompisleser.
			</p>
		{:else}
			<ul class="list">
				{#each projects as p (p.id)}
					<li>
						<a class="row" href={`/skriv/${p.id}`} data-track="skriv:apne-prosjekt">
							<span class="row-main">
								<span class="row-title">{p.title}</span>
								{#if p.summary}<span class="row-sub">{p.summary}</span>{/if}
							</span>
							<span class="row-meta">
								{#if p.genre}<span>{p.genre}</span>{/if}
								<span>{fmt(p.updatedAt)}</span>
							</span>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</PageSection>
</AppPage>

<style>
	.toolbar {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 16px;
	}
	.streak {
		color: var(--text-secondary);
		font-size: var(--text-sm);
		margin: 0 0 16px;
	}
	.today {
		color: var(--text-tertiary);
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-bottom: 20px;
	}
	.actions {
		display: flex;
		gap: 8px;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.row {
		display: flex;
		gap: 12px;
		align-items: flex-start;
		background: var(--card-bg);
		border: 1px solid var(--card-border);
		border-radius: var(--card-radius);
		padding: var(--card-padding);
		color: var(--text-primary);
		text-decoration: none;
	}
	.row:hover {
		background: var(--card-bg-subtle);
	}
	.row-main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.row-title {
		font-weight: 600;
	}
	.row-sub {
		color: var(--text-secondary);
		font-size: var(--text-sm);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.row-meta {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 4px;
		font-size: var(--text-xs);
		color: var(--text-tertiary);
		white-space: nowrap;
	}
	.link {
		color: var(--accent-primary);
		font-size: var(--text-sm);
	}
	.empty {
		color: var(--text-tertiary);
		font-size: var(--text-sm);
	}
	.error {
		color: var(--color-danger, #ff6b6b);
		font-size: var(--text-sm);
	}
</style>
