<script lang="ts">
	import { browser } from '$app/environment';
	import type { Snippet } from 'svelte';

	type AppPageWidth = 'full' | 'content' | 'narrow';

	interface Props {
		width?: AppPageWidth;
		bg?: string;
		className?: string;
		children: Snippet;
	}

	let {
		width = 'full',
		bg,
		className = '',
		children
	}: Props = $props();

	$effect(() => {
		if (!browser) return;
		const color = bg || getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim() || '#0f0f0f';
		document.documentElement.style.background = color;
		document.body.style.background = color;
		return () => {
			document.documentElement.style.background = '';
			document.body.style.background = '';
		};
	});
</script>

<main
	class={`app-page width-${width} ${className}`.trim()}
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

		width: 100%;
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		gap: var(--page-gap);
		padding: var(--page-pt) var(--page-px) var(--page-pb);
		color: var(--text-primary);
		background: var(--page-bg);
		transition: background 0.3s ease;

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
	}

	/* Width */
	.app-page.width-full { max-width: none; }
	.app-page.width-content { max-width: 760px; margin: 0 auto; }
	.app-page.width-narrow { max-width: 560px; margin: 0 auto; }

	/* Full-bleed utility: barn som trenger kant-til-kant */
	.app-page :global(.full-bleed) {
		margin-left: calc(-1 * var(--page-px));
		margin-right: calc(-1 * var(--page-px));
	}
</style>
