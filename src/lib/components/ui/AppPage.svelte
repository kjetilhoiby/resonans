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

	type AppPageWidth = 'full' | 'content' | 'narrow';

	interface Props {
		width?: AppPageWidth;
		bg?: string;
		className?: string;
		/**
		 * «a» tegner siden i uttrykk A (blekk på krem, nattmodus) og følger
		 * brukerens fargetema. Uten den står siden i det gamle mørke uttrykket —
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

	// Portalerte ark ligger utenfor <main> og arver ikke variablene derfra.
	// Mens en side i uttrykk A er åpen, bærer <body> dem også.
	$effect(() => {
		if (!browser || !uttrykk) return;
		document.body.dataset.uttrykk = uttrykk;
		return () => {
			delete document.body.dataset.uttrykk;
		};
	});
</script>

<main
	bind:this={mainEl}
	class={`app-page width-${width} ${className}`.trim()}
	data-uttrykk={uttrykk}
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

	/* Det gamle, mørke uttrykket — bare for sider som ikke er flyttet ennå.
	   `:not` gjør at A-variablene ikke tapes på spesifisitet mot denne blokka. */
	.app-page:not([data-uttrykk='a']) {
		/* Bakgrunner */
		--bg-primary: #0f0f0f;
		--bg-secondary: #111;
		--bg-card: #171717;
		--bg-elevated: #141414;
		--bg-header: #111;
		--bg-input: #1a1a1a;
		--bg-hover: #23262b;
		--bg-overlay: rgba(0, 0, 0, 0.5);

		/* Tekst */
		--text-primary: #eee;
		--text-secondary: #aaa;
		--text-tertiary: #777;
		--text-muted: #555;

		/* Rammer */
		--border-color: #2a2a2a;
		--border-subtle: #1e1e1e;

		/* Accent */
		--accent-primary: #4a5af0;
		--accent-hover: #3f4de0;
		--accent-light: #7c8ef5;
		--accent-muted: #8ba0f5;
		--accent-contrast: #fff;

		/* Status */
		--success-bg: rgba(74, 222, 128, 0.08);
		--success-text: #4ade80;
		--success-border: rgba(74, 222, 128, 0.2);
		--warning-bg: rgba(240, 180, 41, 0.08);
		--warning-text: #f0b429;
		--warning-border: rgba(240, 180, 41, 0.2);
		--error-bg: rgba(224, 112, 112, 0.08);
		--error-text: #e07070;
		--error-border: #6a2a2a;
		--info-bg: rgba(74, 90, 240, 0.12);
		--info-border: rgba(74, 90, 240, 0.3);

		/* Skygger */
		--shadow-sm: 0 8px 22px rgba(0, 0, 0, 0.28);
		--shadow-md: 0 14px 34px rgba(0, 0, 0, 0.34);

		--card-bg-inset: #0d0d0d;
	}

	/* Width */
	.app-page.width-full { max-width: none; }
	.app-page.width-content { max-width: 760px; margin: 0 auto; }
	.app-page.width-narrow { max-width: 560px; margin: 0 auto; }

</style>
