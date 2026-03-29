<!--
  ThemeRail — horisontal, scrollbar-fri pill-rekke med aktive temaer.
  Brukes i Sone 2 på hjemskjermen.

  Props:
    themes      liste av { id, name, emoji, color? } fra DB
    activeId    id-en til valgt tema (eller null)
    onselect    callback med tema-id
-->
<script lang="ts">
	interface Theme {
		id: string;
		name: string;
		emoji: string;
		color?: string | null;
	}

	interface Props {
		themes: Theme[];
		activeId?: string | null;
		onselect?: (id: string) => void;
	}

	let { themes, activeId = null, onselect }: Props = $props();

	const FALLBACK_COLORS = [
		'#7c8ef5',
		'#5fa0a0',
		'#e07070',
		'#f0b429',
		'#d4829a',
		'#82c882',
		'#c882c8',
	];

	function colorFor(t: Theme, i: number) {
		return t.color ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length];
	}
</script>

<div class="theme-rail" role="list" aria-label="Temaer">
	{#each themes as theme, i (theme.id)}
		<button
			class="theme-pill"
			class:active={activeId === theme.id}
			style="--c:{colorFor(theme, i)}"
			onclick={() => onselect?.(theme.id)}
			aria-label="{theme.emoji} {theme.name}"
		>
			<span class="pill-emoji">{theme.emoji}</span>
			<span class="pill-name">{theme.name}</span>
		</button>
	{/each}
</div>

<style>
	.theme-rail {
		display: flex;
		flex-direction: row;
		gap: 8px;
		overflow-x: auto;
		padding: 2px 4px 6px;
		/* Hide scrollbar but keep scrollability */
		scrollbar-width: none;
	}
	.theme-rail::-webkit-scrollbar {
		display: none;
	}

	.theme-pill {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 6px 14px;
		border-radius: 99px;
		border: none;
		background: color-mix(in srgb, var(--c) 12%, #202020);
		color: color-mix(in srgb, var(--c) 65%, #aaa);
		font-size: 0.75rem;
		font-weight: 500;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s;
		flex-shrink: 0;
	}

	.theme-pill:hover {
		background: color-mix(in srgb, var(--c) 20%, #272727);
		color: color-mix(in srgb, var(--c) 80%, #ccc);
	}

	.theme-pill.active {
		background: color-mix(in srgb, var(--c) 24%, #1a1a1a);
		color: #fff;
		box-shadow: 0 0 12px color-mix(in srgb, var(--c) 18%, transparent);
	}

	.pill-emoji {
		font-size: 0.85rem;
		line-height: 1;
	}

	.pill-name {
		letter-spacing: 0.01em;
	}
</style>
