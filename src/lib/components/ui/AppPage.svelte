<script lang="ts" module>
	const bodyUttrykkStack: { uttrykk: 'a' | 'gammel' }[] = [];

	function applyBodyUttrykk() {
		const top = bodyUttrykkStack.at(-1);
		if (top) document.body.dataset.uttrykk = top.uttrykk;
		else delete document.body.dataset.uttrykk;
	}
</script>

<script lang="ts">
	import { browser } from '$app/environment';
	import type { Snippet } from 'svelte';
	import '@fontsource/petrona/latin-600.css';
	import '@fontsource/petrona/latin-700.css';
	import '@fontsource/hanken-grotesk/latin-400.css';
	import '@fontsource/hanken-grotesk/latin-500.css';
	import '@fontsource/hanken-grotesk/latin-600.css';
	import '@fontsource/hanken-grotesk/latin-700.css';
	import '$lib/styles/uttrykk-a.css';
	import '$lib/styles/uttrykk-gammel.css';

	type AppPageWidth = 'full' | 'content' | 'narrow';

	interface Props {
		width?: AppPageWidth;
		bg?: string;
		className?: string;
		/**
		 * «a» tegner siden i uttrykk A (blekk på krem, nattmodus) og følger
		 * brukerens fargetema. Uten den står siden i det gamle mørke uttrykket
		 * ($lib/styles/uttrykk-gammel.css) —
		 * gjeld som ryddes rom for rom, se «Grunnregler» i docs/DESIGN.md. Når
		 * alle sider er over, blir A standarden og propen forsvinner.
		 */
		uttrykk?: 'a';
		children: Snippet;
	}

	let {
		width = 'full',
		bg,
		className = '',
		uttrykk,
		children
	}: Props = $props();

	const resolvedUttrykk = $derived<'a' | 'gammel'>(uttrykk ?? 'gammel');

	let mainEl = $state<HTMLElement | undefined>();

	$effect(() => {
		if (!browser || !mainEl) return;
		const el = mainEl;
		const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
		const previousThemeColor = meta?.content;

		// Lest fra <main>, ikke fra <html>: det er her sidens variabler bor, og
		// i uttrykk A er de andre enn app.css sine. Statuslinja i en installert
		// PWA tegnes i theme-color; står den på app.html sin mørke verdi over en
		// krem side, får siden en svart kant.
		const sync = () => {
			const color = bg || getComputedStyle(el).getPropertyValue('--bg-primary').trim() || '#0f0f0f';
			document.documentElement.style.background = color;
			document.body.style.background = color;
			if (meta) meta.content = color;
		};
		sync();

		// Fargetemaet kan skifte mens siden står åpen: brukeren velger i
		// innstillingene, eller telefonen går over i nattmodus.
		const observer = new MutationObserver(sync);
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-fargetema'] });
		const media = window.matchMedia('(prefers-color-scheme: dark)');
		media.addEventListener('change', sync);

		return () => {
			observer.disconnect();
			media.removeEventListener('change', sync);
			document.documentElement.style.background = '';
			document.body.style.background = '';
			if (meta && previousThemeColor !== undefined) meta.content = previousThemeColor;
		};
	});

	// Portalerte ark ligger utenfor <main> og arver ikke variablene derfra, så
	// <body> bærer uttrykket til siden som står åpen. Stabelen (modulnivå, se
	// over) gjør at den nyeste siden vinner også når den monteres før den
	// forrige har ryddet etter seg under en navigasjon.
	$effect(() => {
		if (!browser) return;
		const entry = { uttrykk: resolvedUttrykk };
		bodyUttrykkStack.push(entry);
		applyBodyUttrykk();
		return () => {
			const i = bodyUttrykkStack.indexOf(entry);
			if (i >= 0) bodyUttrykkStack.splice(i, 1);
			applyBodyUttrykk();
		};
	});
</script>

<main
	bind:this={mainEl}
	class={`app-page width-${width} ${className}`.trim()}
	data-uttrykk={resolvedUttrykk}
	style={bg ? `--page-bg: ${bg}` : undefined}
>
	{@render children()}
</main>

<style>
	.app-page {
		/* Layout grid */
		--page-px: clamp(16px, 4vw, 24px);
		--page-pt: max(20px, env(safe-area-inset-top, 0px));
		--page-pb: max(20px, env(safe-area-inset-bottom, 0px));
		--page-gap: var(--space-lg);
		--page-bg: var(--bg-primary);

		/* Border-radius */
		--radius-sm: 8px;
		--radius-md: 12px;
		--radius-lg: 16px;
		--radius-xl: 20px;

		/* Spacing */
		--space-xs: 4px;
		--space-sm: 8px;
		--space-md: 12px;
		--space-lg: 16px;
		--space-xl: 24px;
		--space-2xl: 32px;

		/* Typografi */
		--font-size-caption: 0.72rem; /* hints, delta, meta-tekst */
		--font-size-label: 0.78rem;   /* SectionLabel (uppercase-labels) */
		--font-size-body: 0.9rem;     /* brødtekst i kort */
		--font-size-title: 1rem;      /* kort-titler (CardTitle) */
		--font-size-value: 1.9rem;    /* store nøkkeltall */

		/* Kort (blokktyper) — kontekster (temasider, ukeplan) kan overstyre */
		--card-bg: var(--bg-card);
		--card-bg-subtle: var(--bg-elevated);
		--card-border: var(--border-color);
		--card-radius: var(--radius-lg);
		--card-padding: var(--space-lg);

		width: 100%;
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		gap: var(--page-gap);
		padding: 0;
		color: var(--text-primary);
		background: var(--page-bg);
		transition: background 0.3s ease;
	}

	/* Uttrykk A: fargene kommer fra $lib/styles/uttrykk-a.css og følger
	   fargetemaet. Skriften er uttrykkets egen. */
	.app-page[data-uttrykk='a'] {
		font-family: var(--font-body);
	}

	/* Width */
	.app-page.width-full { max-width: none; }
	.app-page.width-content { max-width: 760px; margin: 0 auto; }
	.app-page.width-narrow { max-width: 560px; margin: 0 auto; }

</style>
