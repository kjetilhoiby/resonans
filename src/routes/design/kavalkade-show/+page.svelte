<script lang="ts">
	import { goto } from '$app/navigation';
	import { KavalkadeShow, buildShowSlides } from '$lib/components/domain/kavalkade';
	import { kavalkadeShowInputMock } from '../mocks';

	// Live-demo av kavalkade-showet med faste mocks — full animasjon og
	// auto-fremdrift, uten DB. Lenket fra ShowSlide-demoen på /design.
	// Ikke i visuell regresjon (kun /design-rotens seksjoner screenshottes).
	const slides = buildShowSlides(kavalkadeShowInputMock);
</script>

<svelte:head>
	<title>Design — kavalkade-show</title>
</svelte:head>

<KavalkadeShow {slides} onclose={() => goto('/design')} />
