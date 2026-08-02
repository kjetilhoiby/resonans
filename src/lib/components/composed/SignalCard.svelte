<!--
  SignalCard — ett beregnet kryss-domene-signal, gjort lesbart.

  Kortet svarer på «hva henger sammen her» og gjør sammenhengen navigerbar:
  kryss-lenkene peker på de to temaene signalet forbinder, slik at man kan gå
  rett videre i stedet for å lete.

  Generisk over domener — økonomi- og hjem-dashboardene kan bruke den uendret.
  All oversetting fra signalType til tittel/setning/tone bor i
  $lib/domain/health/signal-presentation (og tilsvarende per domene), ikke her.
-->
<script lang="ts">
	interface CrossLink {
		label: string;
		href: string | null;
	}

	interface Props {
		title: string;
		sentence: string;
		tone?: 'nøytral' | 'positiv' | 'varsel' | 'kritisk';
		crossLinks?: CrossLink[];
		/** Vises dempet under setningen, f.eks. «målt i går». */
		meta?: string | null;
	}

	let { title, sentence, tone = 'nøytral', crossLinks = [], meta = null }: Props = $props();
</script>

<article class="signal-card" data-tone={tone}>
	<span class="signal-dot" aria-hidden="true"></span>
	<div class="signal-body">
		<h4 class="signal-title">{title}</h4>
		<p class="signal-sentence">{sentence}</p>
		{#if crossLinks.length > 0}
			<div class="signal-cross">
				{#each crossLinks as link, i (link.label)}
					{#if i > 0}<span class="signal-cross-sep" aria-hidden="true">↔</span>{/if}
					{#if link.href}
						<a class="signal-cross-link" href={link.href} data-track="helse-signal:apne-kryss">
							{link.label}
						</a>
					{:else}
						<span class="signal-cross-link is-inert">{link.label}</span>
					{/if}
				{/each}
			</div>
		{/if}
		{#if meta}
			<p class="signal-meta">{meta}</p>
		{/if}
	</div>
</article>

<style>
	.signal-card {
		display: flex;
		gap: 10px;
		padding: 14px 16px;
		background: var(--card-bg-subtle, #141414);
		border-radius: var(--card-radius, 16px);
	}

	.signal-dot {
		flex: 0 0 auto;
		width: 8px;
		height: 8px;
		margin-top: 6px;
		border-radius: 50%;
		background: var(--signal-tone, #6b7280);
	}

	/* Tonen bæres av én variabel, så prikken og eventuelle framtidige
	   aksenter aldri kommer i utakt. */
	.signal-card[data-tone='nøytral'] { --signal-tone: #6b7280; }
	.signal-card[data-tone='positiv'] { --signal-tone: #82c882; }
	.signal-card[data-tone='varsel'] { --signal-tone: #f0b429; }
	.signal-card[data-tone='kritisk'] { --signal-tone: #e07070; }

	.signal-body {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}

	.signal-title {
		margin: 0;
		font-size: 0.74rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #888;
	}

	.signal-sentence {
		margin: 0;
		font-size: 0.92rem;
		line-height: 1.45;
		color: #e7e7e7;
	}

	.signal-cross {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 2px;
	}

	.signal-cross-link {
		font-size: 0.76rem;
		color: #9aa7f0;
		text-decoration: none;
		border-bottom: 1px solid transparent;
	}

	.signal-cross-link:hover {
		border-bottom-color: currentColor;
	}

	.signal-cross-link.is-inert {
		color: #666;
	}

	.signal-cross-sep {
		font-size: 0.72rem;
		color: #555;
	}

	.signal-meta {
		margin: 2px 0 0;
		font-size: 0.72rem;
		color: #666;
	}
</style>
