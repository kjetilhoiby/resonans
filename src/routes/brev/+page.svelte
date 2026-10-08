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
	import { SECTION_TITLES, type LetterLens, type LetterLine, type LetterSection } from '$lib/domain/home-letter';

	let { data } = $props();

	type View = 'alt' | LetterLens;
	let view = $state<View>('alt');

	const shown = $derived(
		view === 'alt' ? data.letter.lines : data.letter.lines.filter((l: LetterLine) => l.lens === view)
	);

	const LENS_LABEL: Record<LetterLens, string> = { venter: 'venter', status: 'status' };

	const SECTION_ORDER: LetterSection[] = ['maal', 'uka', 'trader', 'registrering', 'ellers'];
	const sections = $derived(
		SECTION_ORDER.map((section) => ({
			section,
			title: SECTION_TITLES[section],
			lines: shown.filter((l: LetterLine) => l.section === section)
		})).filter((s) => s.lines.length > 0)
	);

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
			<TabButton active={view === 'alt'} onClick={() => (view = 'alt')}>Alt</TabButton>
			<TabButton active={view === 'venter'} onClick={() => (view = 'venter')}>Venter</TabButton>
			<TabButton active={view === 'status'} onClick={() => (view = 'status')}>Status</TabButton>
		</div>

		<div class="versions">
		<div class="version">
		<h2 class="version-title">Regler</h2>
		<article class="letter" data-track="brev:lesing">
			<p class="greeting">{data.letter.greeting}</p>
			{#if sections.length === 0}
				<p class="line quiet">Ingenting å si her akkurat nå.</p>
			{:else}
				{#each sections as part (part.section)}
					<h2 class="part">{part.title}</h2>
					{#each part.lines as line (line.id)}
						<p class="line">
							{#if line.href}
								<a href={line.href} data-track="brev:lenke">{line.text}</a>
							{:else}
								{line.text}
							{/if}
						</p>
					{/each}
				{/each}
			{/if}
		</article>
		</div>

		<div class="version">
			<h2 class="version-title">Modell</h2>
			<article class="letter prose" data-track="brev:modell">
				{#await data.prose}
					<p class="line quiet">Modellen skriver …</p>
				{:then prose}
					{#if prose.paragraphs.length > 0}
						{#each prose.paragraphs as paragraph, i (i)}
							<p class="line">
								{#each paragraph as segment, j (j)}
									{#if 'ref' in segment && segment.href}
										<a class="cta" href={segment.href} data-track="brev:modell-lenke">{segment.text}</a>
									{:else if 'ref' in segment}
										<strong class="cta">{segment.text}</strong>
									{:else}
										{segment.text}
									{/if}
								{/each}
							</p>
						{/each}
					{:else}
						<p class="line quiet">{prose.error ?? 'Ingen tekst.'}</p>
					{/if}
				{:catch}
					<p class="line quiet">Modellbrevet kunne ikke lages.</p>
				{/await}
			</article>
			{#await data.prose then prose}
				{#if prose.unknownNumbers.length > 0}
					<p class="warn">
						Modellen skrev tall som ikke står i faktaene: {prose.unknownNumbers.join(', ')}. Les dem som
						oppfunnet til det motsatte er vist.
					</p>
				{/if}
				{#if prose.omitted.length > 0}
					<div class="omitted">
						<p class="note">Utelatt av modellen:</p>
						{#each prose.omitted as line (line.id)}
							<p class="note">
								{#if line.href}<a href={line.href} data-track="brev:utelatt-lenke">{line.text}</a>{:else}{line.text}{/if}
							</p>
						{/each}
					</div>
				{/if}
				<p class="note">
					{#if prose.model}Skrevet av {prose.model}{prose.cached ? ', lagret fra tidligere i dag' : ', nå'}.{/if}
					{#if prose.error && prose.text} {prose.error} Viser siste lagrede.{/if}
					Modellen får linjene fra reglene og tallene bak dem, og skal ikke legge til noe. De uthevede ordene er lenkene.
				</p>
			{/await}
		</div>
		</div>

		{#if data.registration}
			<section class="coverage" aria-label="Registrering siste sju dager">
				<h2>Registrering, siste sju dager</h2>
				{#each data.registration as row (row.domain)}
					<div class="cov-row" aria-label={`${row.label}: ${row.last7} av 7 dager`}>
						<span class="cov-label">{row.label}</span>
						<span class="cov-dots">
							{#each row.week as hit, i (i)}
								<span class="cov-dot" class:hit class:today={i === row.week.length - 1}></span>
							{/each}
						</span>
						<span class="cov-count">{row.last7}/7</span>
					</div>
				{/each}
				<p class="note">Siste prikk er i dag. En prikk er en dag med minst én registrering.</p>
			</section>
		{/if}

		<section class="behind">
			<h2>Bak brevet</h2>
			<p class="note">
				Linsen står til venstre: <em>venter</em> ber om noe, <em>status</em> gjør ikke det.
				Kilden er motoren setningen kom fra — den samme som flaten eller varselet den
				hører til.
			</p>
			<ul class="sources">
				{#each data.letter.lines as line (line.id)}
					<li><span class="tag">{LENS_LABEL[line.lens as LetterLens]}</span><span class="src">{line.source}</span>{line.text}</li>
				{/each}
			</ul>

			{#if data.letter.dropped.length > 0}
				<h3>Valgt bort</h3>
				<p class="note">
					Kildene hadde mer å si. Noe fikk ikke plass, og noe er erstattet av et bedre
					styringssignal: overliggere fra i går av sju dagers løse tråder, kalenderuka
					av de løpende sju dagene, og vektkrydderet av vektmålet.
				</p>
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
	.versions {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.5rem;
		margin-bottom: 1.25rem;
	}
	@media (min-width: 760px) {
		.versions {
			grid-template-columns: 1fr 1fr;
			gap: 1rem;
		}
	}
	.version-title {
		margin: 0 0 0.4rem;
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-secondary);
	}
	.warn {
		margin: -1rem 0 0.6rem;
		font-size: 0.8rem;
		line-height: 1.5;
		color: var(--text-primary);
		border-left: 2px solid var(--border-subtle);
		padding-left: 0.6rem;
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
	.part {
		margin: 1rem 0 0.35rem;
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-secondary);
	}
	.greeting + .part {
		margin-top: 0.25rem;
	}
	.line a {
		color: inherit;
		text-decoration: underline;
		text-decoration-color: var(--border-subtle);
		text-underline-offset: 3px;
	}
	.line .cta {
		color: var(--text-primary);
		font-weight: 600;
		text-decoration: underline;
		text-decoration-color: var(--accent-light);
		text-decoration-thickness: 2px;
		text-underline-offset: 3px;
	}
	.omitted {
		margin-bottom: 0.6rem;
	}
	.omitted .note {
		margin-bottom: 0.25rem;
	}
	.omitted a {
		color: inherit;
	}
	.quiet {
		color: var(--text-secondary);
	}
	.coverage {
		margin-bottom: 1.75rem;
	}
	.coverage h2 {
		margin: 0 0 0.6rem;
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-primary);
	}
	.cov-row {
		display: grid;
		grid-template-columns: 7.5rem 1fr auto;
		align-items: center;
		gap: 0.5rem;
		padding: 0.3rem 0;
	}
	.cov-label {
		font-size: 0.85rem;
		color: var(--text-primary);
	}
	.cov-dots {
		display: flex;
		gap: 0.4rem;
	}
	.cov-dot {
		width: 0.8rem;
		height: 0.8rem;
		border-radius: 50%;
		border: 1px solid var(--border-subtle);
	}
	.cov-dot.hit {
		background: var(--text-primary);
		border-color: var(--text-primary);
	}
	.cov-dot.today:not(.hit) {
		border-style: dashed;
		border-color: var(--text-secondary);
	}
	.cov-count {
		font-size: 0.78rem;
		color: var(--text-secondary);
		font-variant-numeric: tabular-nums;
	}
	.behind {
		/* Plass til den flytende «+»-knappen, som ellers ligger over siste linje. */
		padding-bottom: 5rem;
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
