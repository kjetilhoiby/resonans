<script lang="ts">
	import { goto } from '$app/navigation';
	import { KavalkadeShow, buildShowSlides } from '$lib/components/domain/kavalkade';
	import { kavalkadeShowInputMock } from '../mocks';

	// Live-demo av kavalkade-showet med faste mocks — full animasjon og
	// auto-fremdrift, uten DB. Lenket fra ShowSlide-demoen på /design.
	// Ikke i visuell regresjon (kun /design-rotens seksjoner screenshottes).
	const slides = buildShowSlides(kavalkadeShowInputMock);

	let skin = $state<'dark' | 'fest'>('dark');
</script>

<svelte:head>
	<title>Design — kavalkade-show</title>
</svelte:head>

<KavalkadeShow {slides} {skin} onclose={() => goto('/design')} />

<div class="skin-toggle">
	<button class:active={skin === 'dark'} onclick={() => (skin = 'dark')}>Mørk</button>
	<button class:active={skin === 'fest'} onclick={() => (skin = 'fest')} data-track="design-kavalkade-show:festskinn">Fest</button>
</div>

<style>
	.skin-toggle {
		position: fixed;
		bottom: calc(18px + env(safe-area-inset-bottom, 0px));
		left: 50%;
		transform: translateX(-50%);
		z-index: 1001;
		display: flex;
		gap: 4px;
		padding: 4px;
		border-radius: 999px;
		background: rgb(0 0 0 / 0.45);
		backdrop-filter: blur(8px);
	}

	.skin-toggle button {
		border: none;
		border-radius: 999px;
		padding: 6px 14px;
		font-size: 0.8rem;
		font-weight: 600;
		background: transparent;
		color: rgb(255 255 255 / 0.7);
		cursor: pointer;
	}

	.skin-toggle button.active {
		background: rgb(255 255 255 / 0.92);
		color: #111;
	}
</style>
