<!--
  Brevet — PROTOTYPE. Se docs/changelog/2026-10-06-brev-prototype.md.

  Hva hjemskjermens brev ville sagt akkurat nå, med brukerens ekte data. Siden
  finnes for å svare på ett spørsmål før noe bygges inn i hjemskjermen: blir
  brevet en innboks med rød prikk? Derfor kan de to linsene ses hver for seg —
  «hva som venter» er påminnelsene, «hvor du står» ber ikke om noe — og derfor
  står det som ble valgt bort under, så utvalget kan etterprøves.

  Ingenting sendes og ingenting lagres.
-->
<script lang="ts">
	import { AppPage, PageSection, PageHeader, TabButton } from '$lib/components/ui';
	import type { LetterLens, LetterLine } from '$lib/domain/home-letter';

	let { data } = $props();

	type View = 'alt' | LetterLens;
	let view = $state<View>('alt');

	const shown = $derived(
		view === 'alt' ? data.letter.lines : data.letter.lines.filter((l: LetterLine) => l.lens === view)
	);

	const LENS_LABEL: Record<LetterLens, string> = { venter: 'venter', status: 'status' };

	const lastVisit = $derived(
		data.raw.lastVisit
			? new Date(data.raw.lastVisit).toLocaleString('nb-NO', {
					timeZone: 'Europe/Oslo',
					weekday: 'long',
					day: 'numeric',
					month: 'long',
					hour: '2-digit',
					minute: '2-digit'
				})
			: null
	);
</script>

<AppPage>
	<PageSection>
		<PageHeader title="Brev" titleHref="/" />

		<p class="intro">
			Prototype. Slik ville brevet øverst på hjemskjermen sett ut akkurat nå, med dine
			egne data. Ingenting sendes og ingenting lagres.
		</p>

		<div class="tabs" role="tablist" aria-label="Linse">
			<TabButton active={view === 'alt'} onClick={() => (view = 'alt')}>Hele brevet</TabButton>
			<TabButton active={view === 'venter'} onClick={() => (view = 'venter')}>Hva som venter</TabButton>
			<TabButton active={view === 'status'} onClick={() => (view = 'status')}>Hvor du står</TabButton>
		</div>

		<article class="letter" data-track="brev:lesing">
			<p class="greeting">{data.letter.greeting}</p>
			{#if shown.length === 0}
				<p class="line quiet">Ingenting å si her akkurat nå.</p>
			{:else}
				{#each shown as line (line.id)}
					<p class="line">
						{#if line.href}
							<a href={line.href} data-track="brev:lenke">{line.text}</a>
						{:else}
							{line.text}
						{/if}
					</p>
				{/each}
			{/if}
		</article>

		<section class="behind">
			<h2>Bak brevet</h2>
			<p class="note">
				Linsen står til venstre: <em>venter</em> ber om noe, <em>status</em> gjør ikke det.
				Kilden er regelen setningen kom fra — den samme som lager push-varslene.
			</p>
			<ul class="sources">
				{#each data.letter.lines as line (line.id)}
					<li><span class="tag">{LENS_LABEL[line.lens as LetterLens]}</span><span class="src">{line.source}</span>{line.text}</li>
				{/each}
			</ul>

			{#if data.letter.dropped.length > 0}
				<h3>Valgt bort</h3>
				<p class="note">Reglene hadde mer å si, men hver linse får maks tre linjer.</p>
				<ul class="sources dropped">
					{#each data.letter.dropped as line (line.id)}
						<li><span class="tag">{LENS_LABEL[line.lens as LetterLens]}</span><span class="src">{line.source}</span>{line.text}</li>
					{/each}
				</ul>
			{/if}

			<p class="note">
				{#if lastVisit}Forrige besøk: {lastVisit}.{:else}Fant ikke forrige besøk.{/if}
				{#if data.failed.length > 0}
					Kilder som feilet: {data.failed.join(', ')}.
				{/if}
			</p>
		</section>
	</PageSection>
</AppPage>

<style>
	.intro {
		margin: 0 0 1rem;
		font-size: 0.85rem;
		line-height: 1.5;
		color: var(--text-secondary);
	}
	.tabs {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}
	.letter {
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
		border-radius: 16px;
		padding: 1.25rem 1.1rem;
		margin-bottom: 1.75rem;
	}
	.greeting {
		margin: 0 0 0.75rem;
		font-size: 1.15rem;
		font-weight: 600;
		color: var(--text-primary);
	}
	.line {
		margin: 0 0 0.65rem;
		font-size: 1rem;
		line-height: 1.55;
		color: var(--text-primary);
	}
	.line:last-child {
		margin-bottom: 0;
	}
	.line a {
		color: inherit;
		text-decoration: underline;
		text-decoration-color: var(--border-subtle);
		text-underline-offset: 3px;
	}
	.quiet {
		color: var(--text-secondary);
	}
	.behind h2 {
		margin: 0 0 0.4rem;
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-primary);
	}
	.behind h3 {
		margin: 1.25rem 0 0.3rem;
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--text-primary);
	}
	.note {
		margin: 0 0 0.6rem;
		font-size: 0.8rem;
		line-height: 1.5;
		color: var(--text-secondary);
	}
	.sources {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.sources li {
		font-size: 0.82rem;
		line-height: 1.45;
		color: var(--text-secondary);
	}
	.dropped li {
		opacity: 0.75;
	}
	.tag,
	.src {
		display: inline-block;
		margin-right: 0.4rem;
		padding: 0 0.35rem;
		border-radius: 6px;
		font-size: 0.7rem;
		border: 1px solid var(--border-subtle);
	}
</style>
