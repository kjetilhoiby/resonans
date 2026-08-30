<script lang="ts">
	import { AppPage, PageSection, PageHeader } from '$lib/components/ui';
	import '../design.css';

	import Ukeplan from '../sections/ukeplan.svelte';
	import Kavalkade from '../sections/kavalkade.svelte';
	import Hjem from '../sections/hjem.svelte';
	import Boker from '../sections/boker.svelte';
	import Reise from '../sections/reise.svelte';
	import Mat from '../sections/mat.svelte';

	const sections = [
		{ id: 'ukeplan', label: 'Ukeplan' },
		{ id: 'kavalkade', label: 'Kavalkade' },
		{ id: 'hjem', label: 'Hjemskjerm-elementer' },
		{ id: 'boker', label: 'Bøker' },
		{ id: 'reise', label: 'Reise' },
		{ id: 'mat', label: 'Mat & matplan' }
	] as const;
</script>

<svelte:head>
	<title>Design · Flater</title>
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

		<!-- Ingen «← Komponenter»-lenke: `titleHref` på samme header går allerede dit,
		     og tittelen ER tilbakeknappen. -->
		<PageHeader title="Flater" titleHref="/design" />
		<p class="page-sub">
			Komposisjoner: hele app-skjermer bygget av domene-komponentene (<code>domain/</code>) med mock-data.
			De rene byggeklossene bor under <a href="/design">Komponenter</a>.
		</p>

		<Ukeplan />
		<Kavalkade />
		<Hjem />
		<Boker />
		<Reise />
		<Mat />

	</main>
	</div>
	</div>
	</PageSection>
</AppPage>
