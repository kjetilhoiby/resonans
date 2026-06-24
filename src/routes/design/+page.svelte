<script lang="ts">
	import { AppPage, PageSection, PageHeader } from '$lib/components/ui';
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
		{ id: 'livskompasset', label: 'Livskompasset (prototype)' },
		{ id: 'lab', label: 'Lab' }
	] as const;
</script>

<svelte:head>
	<title>Design</title>
</svelte:head>

<AppPage>
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
		<Livskompasset />
		<Lab />

	</main>
	</div>
	</div>
	</PageSection>
</AppPage>
