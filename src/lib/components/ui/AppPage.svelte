<script lang="ts">
	import { browser } from '$app/environment';
	import type { Snippet } from 'svelte';

	type AppPageWidth = 'full' | 'content' | 'narrow';
	type AppPagePadding = 'none' | 'default' | 'comfortable';
	type AppPageGap = 'sm' | 'md' | 'lg';
	type AppPageSurface = 'default' | 'subtle' | 'transparent';

	interface Props {
		width?: AppPageWidth;
		padding?: AppPagePadding;
		gap?: AppPageGap;
		surface?: AppPageSurface;
		className?: string;
		children: Snippet;
	}

	let {
		width = 'full',
		padding = 'default',
		gap = 'md',
		surface = 'default',
		className = '',
		children
	}: Props = $props();

	$effect(() => {
		if (!browser) return;
		const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim() || '#0f0f0f';
		document.documentElement.style.background = bg;
		document.body.style.background = bg;
		return () => {
			document.documentElement.style.background = '';
			document.body.style.background = '';
		};
	});
</script>

<main class={`app-page width-${width} pad-${padding} gap-${gap} surface-${surface} ${className}`.trim()}>
	{@render children()}
</main>

<style>
	.app-page {
		width: 100%;
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		color: var(--text-primary);
		background: var(--bg-primary);

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

	/* Surface */
	.app-page.surface-default { background: var(--bg-primary); }
	.app-page.surface-subtle { background: var(--bg-secondary); }
	.app-page.surface-transparent { background: transparent; }

	/* Padding */
	.app-page.pad-none { padding: 0; }
	.app-page.pad-default { padding: clamp(20px, 4vw, 32px) clamp(16px, 3vw, 24px); }
	.app-page.pad-comfortable { padding: clamp(24px, 5vw, 40px) clamp(18px, 4vw, 32px); }

	/* Gap */
	.app-page.gap-sm { gap: var(--space-md); }
	.app-page.gap-md { gap: var(--space-lg); }
	.app-page.gap-lg { gap: var(--space-xl); }

	/* Width */
	.app-page.width-full { max-width: none; }
	.app-page.width-content { max-width: 760px; margin: 0 auto; }
	.app-page.width-narrow { max-width: 560px; margin: 0 auto; }

	/* Safe area */
	@media (max-width: 720px) {
		.app-page.pad-default,
		.app-page.pad-comfortable {
			padding-top: max(20px, env(safe-area-inset-top));
			padding-bottom: max(20px, env(safe-area-inset-bottom));
		}
	}
</style>
