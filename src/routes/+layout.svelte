<script lang="ts">
	import '../app.css';
	import { afterNavigate, beforeNavigate, goto, onNavigate } from '$app/navigation';
	import { updated } from '$app/state';
	import { onMount } from 'svelte';
	import { initUsageTracking, trackPageView } from '$lib/client/usage-logger';

	let { children } = $props();

	// Hvor lenge appen må ha vært i bakgrunnen før en oppdaget ny versjon gir
	// auto-reload ved forgrunning. Korte app-bytter (kopiere noe, svare en melding)
	// skal aldri kaste bort utkast midt i skriving.
	const RELOAD_AFTER_HIDDEN_MS = 30 * 60_000;
	let hiddenAt: number | null = null;

	/**
	 * Satt idet et push-varsel har bedt oss rute. Hindrer at
	 * `visibilitychange`-reloaden fyrer i samme øyeblikk: to navigasjoner
	 * samtidig i en iOS-PWA gir blank skjerm, og det var slik varselet «krasjet»
	 * appen etter en deploy.
	 */
	let routingFromNotification = false;

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
				// Ikke reload mens et varsel ruter oss — se `routingFromNotification`.
				if (hasNewVersion && hiddenLong && !routingFromNotification) location.reload();
			}).catch(() => {});
		};
		document.addEventListener('visibilitychange', onVisibilityChange);

		// Service workeren ber oss rute selv når et varsel trykkes, i stedet for å
		// kalle `WindowClient.navigate()` utenfra. Da går turen gjennom `goto` →
		// `beforeNavigate` → versjonsvakten under, som gjør den til en full
		// sidelast når en ny versjon er deployet.
		const onServiceWorkerMessage = (event: MessageEvent) => {
			const data = event.data as { type?: string; url?: string } | undefined;
			if (data?.type !== 'resonans:navigate' || typeof data.url !== 'string') return;
			// Bekreft FØR navigasjonen: rekker vi ikke det, faller SW-en tilbake til
			// `navigate()` og vi får to navigasjoner — nøyaktig det vi vil unngå.
			event.ports[0]?.postMessage({ ok: true });
			routingFromNotification = true;
			void goto(data.url).finally(() => {
				routingFromNotification = false;
			});
		};
		navigator.serviceWorker?.addEventListener('message', onServiceWorkerMessage);

		return () => {
			document.removeEventListener('visibilitychange', onVisibilityChange);
			navigator.serviceWorker?.removeEventListener('message', onServiceWorkerMessage);
		};
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

