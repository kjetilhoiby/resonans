<!--
  Manus-fanen: delene i rekkefølge, med flytting og sammenhengende lesing.

  Rekkefølgen sendes som HELE lista til serveren, ikke som «flytt denne opp».
  Det gjør operasjonen idempotent, og to raske trykk kan ikke bytte plass med
  hverandre. Optimistisk oppdatering lokalt, med rulling tilbake hvis serveren
  avviser — ellers føles pilene trege nok til at man trykker to ganger.
-->
<script lang="ts">
	import { Button } from '$lib/components/ui';
	import { extractApiErrorMessage } from '$lib/client/api-error';
	import { compileManuscript, moveDoc, type MoveDirection } from '$lib/domain/writing/manuscript';

	interface Doc {
		id: string;
		kind: string;
		title: string;
		body: string;
		status: string;
		sortOrder: number;
		words: number;
		updatedAt: string;
	}

	interface Props {
		projectId: string;
		docs: Doc[];
		onOpen: (doc: Doc) => void;
		onNew: (kind: string) => void;
		onImport: () => void;
	}

	let { projectId, docs, onOpen, onNew, onImport }: Props = $props();

	let items = $state<Doc[]>([...docs]);
	let error = $state<string | null>(null);
	let reading = $state(false);
	let busy = $state(false);

	// Serveren er sannheten når siden lastes på nytt (ny scene, sletting).
	$effect(() => {
		items = [...docs];
	});

	const compiled = $derived(compileManuscript(items));

	async function move(id: string, direction: MoveDirection) {
		if (busy) return;
		const previous = items;
		const next = moveDoc(items, id, direction);
		if (next === items) return; // ytterst — no-op, ikke en feil

		items = next as Doc[];
		busy = true;
		error = null;
		try {
			const res = await fetch(`/api/skriveprosjekt/${projectId}/rekkefolge`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ order: next.map((d) => d.id) })
			});
			if (!res.ok) {
				items = previous;
				error = extractApiErrorMessage(res.status, await res.text());
				return;
			}
			items = await res.json();
		} catch (err) {
			items = previous;
			error = `Kunne ikke lagre rekkefølgen: ${err instanceof Error ? err.message : String(err)}`;
		} finally {
			busy = false;
		}
	}
</script>

<div class="toolbar">
	<Button onClick={() => onNew('scene')}>Ny scene</Button>
	<Button variant="ghost" onClick={() => onNew('kapittel')}>Nytt kapittel</Button>
	<Button variant="ghost" onClick={onImport}>Hent inn notat</Button>
	{#if items.length > 0}
		<Button variant="ghost" onClick={() => (reading = !reading)}>
			{reading ? 'Tilbake til lista' : 'Les sammenhengende'}
		</Button>
	{/if}
</div>

{#if error}<p class="error" role="alert">{error}</p>{/if}

{#if items.length === 0}
	<p class="empty">Manuset er tomt. En scene er et godt sted å begynne.</p>
{:else if reading}
	<p class="total">{compiled.words} ord i {compiled.parts.length} deler</p>
	{#if compiled.text}
		<article class="read">{compiled.text}</article>
	{:else}
		<p class="empty">Delene finnes, men ingen av dem har tekst ennå.</p>
	{/if}
{:else}
	<p class="total">{compiled.words} ord i {items.length} deler</p>
	<ul class="list">
		{#each items as doc, i (doc.id)}
			<li class="row">
				<span class="order">
					<button
						class="arrow"
						disabled={i === 0 || busy}
						onclick={() => move(doc.id, 'opp')}
						aria-label={`Flytt «${doc.title || 'uten tittel'}» opp`}
					>↑</button>
					<button
						class="arrow"
						disabled={i === items.length - 1 || busy}
						onclick={() => move(doc.id, 'ned')}
						aria-label={`Flytt «${doc.title || 'uten tittel'}» ned`}
					>↓</button>
				</span>
				<button class="main" onclick={() => onOpen(doc)} data-track="skriv:apne-manusdel">
					<span class="row-title">{doc.title || '(uten tittel)'}</span>
					<span class="row-sub">{doc.body.slice(0, 140)}</span>
				</button>
				<span class="row-meta">
					<span>{doc.words} ord</span>
					<span>{doc.kind}</span>
				</span>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.toolbar {
		display: flex;
		gap: 8px;
		margin-bottom: 12px;
		flex-wrap: wrap;
	}
	.total {
		color: var(--text-tertiary);
		font-size: var(--text-sm);
		margin: 0 0 8px;
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
		gap: 10px;
		align-items: stretch;
		background: var(--card-bg);
		border: 1px solid var(--card-border);
		border-radius: var(--card-radius);
		padding: var(--card-padding);
	}
	.order {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 2px;
	}
	.arrow {
		background: none;
		border: 1px solid var(--card-border);
		border-radius: 6px;
		color: var(--text-secondary);
		cursor: pointer;
		/* Tommelvennlig: pilene skal treffes på mobil uten å zoome. */
		min-width: 32px;
		min-height: 28px;
		font-size: var(--text-sm);
		line-height: 1;
	}
	.arrow:disabled {
		opacity: 0.3;
		cursor: default;
	}
	.main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
		text-align: left;
		background: none;
		border: none;
		color: var(--text-primary);
		cursor: pointer;
		padding: 0;
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
		justify-content: center;
		gap: 4px;
		font-size: var(--text-xs);
		color: var(--text-tertiary);
		white-space: nowrap;
	}

	.read {
		white-space: pre-wrap;
		background: var(--card-bg);
		border: 1px solid var(--card-border);
		border-radius: var(--card-radius);
		padding: var(--card-padding);
		/* Lesbar linjelengde — sammenhengende lesing er lesing, ikke redigering. */
		max-width: 68ch;
		line-height: 1.65;
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
