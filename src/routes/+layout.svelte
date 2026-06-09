<script lang="ts">
	import '../app.css';
	import { afterNavigate, beforeNavigate, onNavigate } from '$app/navigation';
	import { updated } from '$app/state';
	import { onMount } from 'svelte';
	import { initUsageTracking, trackPageView } from '$lib/client/usage-logger';

	let { children } = $props();

	// Hvor lenge appen må ha vært i bakgrunnen før en oppdaget ny versjon gir
	// auto-reload ved forgrunning. Korte app-bytter (kopiere noe, svare en melding)
	// skal aldri kaste bort utkast midt i skriving.
	const RELOAD_AFTER_HIDDEN_MS = 30 * 60_000;
	let hiddenAt: number | null = null;

	onMount(() => {
		initUsageTracking();

		// PWA-økter lever lenge i bakgrunnen. Ved forgrunning: be SW-en sjekke seg selv,
		// og sjekk om en ny app-versjon er deployet. Lang bakgrunnstid → reload med en
		// gang (brukeren har ikke rukket å starte på noe); ellers tar beforeNavigate det.
		const onVisibilityChange = () => {
			if (document.visibilityState === 'hidden') {
				hiddenAt = Date.now();
				return;
			}
			void navigator.serviceWorker?.getRegistration()
				.then((reg) => reg?.update())
				.catch(() => {});
			const hiddenLong = hiddenAt !== null && Date.now() - hiddenAt > RELOAD_AFTER_HIDDEN_MS;
			void updated.check().then((hasNewVersion) => {
				if (hasNewVersion && hiddenLong) location.reload();
			}).catch(() => {});
		};
		document.addEventListener('visibilitychange', onVisibilityChange);
		return () => document.removeEventListener('visibilitychange', onVisibilityChange);
	});

	// Ny versjon deployet → la neste klient-navigasjon bli en full sidelast,
	// så vi aldri prøver å laste chunks som ikke finnes lenger.
	beforeNavigate(({ willUnload, to }) => {
		if (updated.current && !willUnload && to?.url) {
			location.href = to.url.href;
		}
	});

	onNavigate((navigation) => {
		document.documentElement.classList.add('is-navigating');
		if (!document.startViewTransition) return;
		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
		});
	});

	afterNavigate((navigation) => {
		document.documentElement.classList.remove('is-navigating');
		const path = navigation.to?.url.pathname;
		if (path) trackPageView(path);
	});
</script>

<svelte:head>
	<title>Resonans</title>
</svelte:head>

{@render children?.()}

