<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { Snippet } from 'svelte';

	type AppPageWidth = 'full' | 'content' | 'narrow';
	type AppPagePadding = 'none' | 'default' | 'comfortable';
	type AppPageGap = 'sm' | 'md' | 'lg';
	type AppPageSurface = 'default' | 'subtle' | 'transparent';
	type AppPageTheme = 'default' | 'dark';

	interface Props {
		width?: AppPageWidth;
		padding?: AppPagePadding;
		gap?: AppPageGap;
		surface?: AppPageSurface;
		theme?: AppPageTheme;
		className?: string;
		children: Snippet;
	}

	let {
		width = 'full',
		padding = 'default',
		gap = 'md',
		surface = 'default',
		theme = 'default',
		className = '',
		children
	}: Props = $props();

	const darkBg: Record<AppPageSurface, string> = {
		default: '#0f0f0f',
		subtle: '#111',
		transparent: '#0f0f0f'
	};

	$effect(() => {
		const color = theme === 'dark' ? darkBg[surface] : '';
		document.documentElement.style.background = color;
	});

	onDestroy(() => {
		document.documentElement.style.background = '';
	});
</script>

<main class={`app-page width-${width} pad-${padding} gap-${gap} surface-${surface} theme-${theme} ${className}`.trim()}>
	{@render children()}
</main>

<style>
	.app-page {
		width: 100%;
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
	}

	.app-page.theme-dark {
		--bg-primary: #0f0f0f;
		--bg-secondary: #111;
		--bg-card: #171717;
		--bg-header: #111;
		--bg-input: #1a1a1a;
		--bg-hover: #23262b;

		--text-primary: #eee;
		--text-secondary: #aaa;
		--text-tertiary: #777;

		--border-color: #2a2a2a;
		--border-subtle: #1e1e1e;

		--accent-primary: #4a5af0;
		--accent-hover: #3f4de0;

		--success-bg: rgba(74, 222, 128, 0.08);
		--success-text: #4ade80;
		--success-border: rgba(74, 222, 128, 0.2);

		--error-bg: rgba(224, 112, 112, 0.08);
		--error-text: #e07070;
		--error-border: #6a2a2a;

		--info-bg: rgba(74, 90, 240, 0.12);
		--info-border: rgba(74, 90, 240, 0.3);

		--shadow-sm: 0 8px 22px rgba(0, 0, 0, 0.28);
		--shadow-md: 0 14px 34px rgba(0, 0, 0, 0.34);
	}

	.app-page.surface-default {
		background: var(--bg-primary);
	}

	.app-page.surface-subtle {
		background: var(--bg-secondary);
	}

	.app-page.surface-transparent {
		background: transparent;
	}

	.app-page.pad-none {
		padding: 0;
	}

	.app-page.pad-default {
		padding: clamp(20px, 4vw, 32px) clamp(16px, 3vw, 24px);
	}

	.app-page.pad-comfortable {
		padding: clamp(24px, 5vw, 40px) clamp(18px, 4vw, 32px);
	}

	.app-page.gap-sm {
		gap: 12px;
	}

	.app-page.gap-md {
		gap: 16px;
	}

	.app-page.gap-lg {
		gap: 24px;
	}

	.app-page.width-content,
	.app-page.width-narrow {
		margin: 0 auto;
	}

	.app-page.width-content {
		max-width: 760px;
	}

	.app-page.width-narrow {
		max-width: 560px;
	}

	.app-page.width-full {
		max-width: none;
	}

	@media (max-width: 720px) {
		.app-page.pad-default,
		.app-page.pad-comfortable {
			padding-top: max(20px, env(safe-area-inset-top));
			padding-bottom: max(20px, env(safe-area-inset-bottom));
		}
	}
</style>