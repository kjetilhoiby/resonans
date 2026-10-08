<script lang="ts">
	import { AppPage, PageSection, PageHeader } from '$lib/components/ui';
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import { parseFargetema } from '$lib/domain/fargetema';
	import './design.css';

	import Prinsipper from './sections/prinsipper.svelte';
	import Typografi from './sections/typografi.svelte';
	import Blokktyper from './sections/blokktyper.svelte';
	import Oppgaverader from './sections/oppgaverader.svelte';
	import Layout from './sections/layout-struktur.svelte';
	import Knapper from './sections/knapper.svelte';
	import Ikoner from './sections/ikoner.svelte';
	import Ringer from './sections/ringer.svelte';
	import Dashboardkort from './sections/dashboardkort.svelte';
	import UtvidbareKort from './sections/utvidbare-kort.svelte';
	import Chat from './sections/chat.svelte';
	import Skjema from './sections/skjema.svelte';
	import Navigasjon from './sections/navigasjon.svelte';
	import Sheets from './sections/sheets.svelte';
	import Modaler from './sections/modaler.svelte';
	import Kalender from './sections/kalender.svelte';
	import Livskompasset from './sections/livskompasset.svelte';
	import Lab from './sections/lab.svelte';

	const sections = [
		{ id: 'prinsipper', label: 'Designprinsipper' },
		{ id: 'typografi', label: 'Typografi' },
		{ id: 'blokktyper', label: 'Blokktyper' },
		{ id: 'oppgaverader', label: 'Oppgaverader' },
		{ id: 'layout', label: 'Layout & struktur' },
		{ id: 'knapper', label: 'Knapper' },
		{ id: 'ikoner', label: 'Ikoner & tema-hue' },
		{ id: 'ringer', label: 'Ringer & widgets' },
		{ id: 'dashboardkort', label: 'Dashboard-kort' },
		{ id: 'utvidbare-kort', label: 'Utvidbare kort' },
		{ id: 'chat', label: 'Chat' },
		{ id: 'skjema', label: 'Skjema' },
		{ id: 'navigasjon', label: 'Navigasjon' },
		{ id: 'sheets', label: 'Sheets & paneler' },
		{ id: 'modaler', label: 'Menyer & modaler' },
		{ id: 'kalender', label: 'Kalender' },
		{ id: 'livskompasset', label: 'Livskompasset (prototype)' },
		{ id: 'lab', label: 'Lab' }
	] as const;

	// Forhåndsvisning av fargetemaene (docs/DESIGN.md, «Grunnregler»):
	// ?uttrykk=a tegner galleriet i uttrykk A, &fargetema=lys|mork velger tema.
	// Påvirker bare denne visningen — cookien til brukeren røres ikke.
	const uttrykk = $derived(page.url.searchParams.get('uttrykk') === 'a' ? ('a' as const) : undefined);
	const forhandsvisning = $derived(page.url.searchParams.get('fargetema'));

	$effect(() => {
		if (!browser || !forhandsvisning) return;
		const html = document.documentElement;
		const forrige = html.dataset.fargetema;
		html.dataset.fargetema = parseFargetema(forhandsvisning);
		return () => {
			if (forrige === undefined) delete html.dataset.fargetema;
			else html.dataset.fargetema = forrige;
		};
	});
</script>

<svelte:head>
	<title>Design</title>
</svelte:head>

<AppPage {uttrykk}>
	<PageSection>
	<div class="design-root">
	<div class="page">

	<!-- ── Sidemeny ── -->
	<nav class="sidenav">
		{#each sections as s}
			<a class="sidenav-link" href="#{s.id}">{s.label}</a>
		{/each}
	</nav>

	<main class="content">

		<PageHeader title="Design" titleHref="/">
			{#snippet actions()}
				<a class="design-xlink" href="/design/flater">Flater →</a>
			{/snippet}
		</PageHeader>
		<p class="page-sub">
			Levende dokumentasjon: alle demoer rendrer appens faktiske komponenter med mock-data — ingen gjenskapt markup.
			Nye komponenter utvikles og tilpasses her (under «Lab») før de tas inn i appen.
			Hele app-skjermer ligger under <a href="/design/flater">Flater</a>.
		</p>
		<p class="page-sub">
			Vis i: <a href="/design">gammelt mørkt</a> ·
			<a href="/design?uttrykk=a&amp;fargetema=lys">A, lyst</a> ·
			<a href="/design?uttrykk=a&amp;fargetema=mork">A, mørkt</a>.
			Alle flater skal finnes i valgt tema; det gamle mørke uttrykket er gjeld.
		</p>

		<Prinsipper />
		<Typografi />
		<Blokktyper />
		<Oppgaverader />
		<Layout />
		<Knapper />
		<Ikoner />
		<Ringer />
		<Dashboardkort />
		<UtvidbareKort />
		<Chat />
		<Skjema />
		<Navigasjon />
		<Sheets />
		<Modaler />
		<Kalender />
		<Livskompasset />
		<Lab />

	</main>
	</div>
	</div>
	</PageSection>
</AppPage>
