<!--
  StreakCard — bredt streak-kort: ring til venstre, tekst med luft til høyre.

  Foretrukket uttrykk for streaks. Titler er brukerskrevne setninger («Løpe minst
  15 minutter hver dag»), ikke korte etiketter, så de trenger horisontal plass —
  i en smal kolonne brekker de over tre linjer og drar ringene ut av flukt.

  Rent presentasjonelt: regel-kunnskapen bor i $lib/domain/streaks.ts. Kallstedet
  sender ferdig `streakLabel()`/`streakSublabel()`-tekst inn som `meta`.

  Props:
    count    antall runder på rad (0 = brutt, tegnes dempet)
    title    streakens navn (klippes etter titleLines)
    emoji    vises foran tittelen
    meta     sekundærlinje, f.eks. «6 dager på rad · gjenstår i dag»
    dots     historikk, eldste først: true = runde holdt
    color    aksentfarge
    muted    tegn dempet
    action   valgfri handling til høyre (f.eks. «Logg runde»)
    titleLines  hvor mange linjer tittelen får før den klippes (default 2).
                Sett 1 der korthøyden må være forutsigbar — f.eks. i widget-sonen
                på hjemmeskjermen, der tre kort skal passe i en fast høyde.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		count: number;
		title: string;
		emoji?: string;
		meta?: string | null;
		dots?: boolean[];
		color?: string;
		muted?: boolean;
		action?: Snippet;
		titleLines?: 1 | 2;
	}

	let {
		count,
		title,
		emoji,
		meta = null,
		dots = [],
		color = 'var(--warning-text)',
		muted = false,
		action,
		titleLines = 2,
	}: Props = $props();

	const isMuted = $derived(muted || count === 0);
	const accent = $derived(isMuted ? 'var(--text-muted)' : color);
	// Siste holdte runde markeres tydeligere enn de foregående.
	const latestIdx = $derived(dots.reduce((acc, v, i) => (v ? i : acc), -1));
</script>

<div class="streak-card" class:is-muted={isMuted} style="--c:{accent}; --title-lines:{titleLines}">
	<div class="ring" aria-hidden="true">
		<span class="flame">{isMuted ? '💤' : '🔥'}</span>
		<span class="num">{count}</span>
	</div>

	<div class="body">
		<span class="title">{#if emoji}<span class="emoji">{emoji}</span>{/if}{title}</span>
		<div class="metarow">
			{#if dots.length > 0}
				<div class="dots" role="list" aria-label="Historikk">
					{#each dots as done, i}
						<div class="dot" class:done class:latest={done && i === latestIdx} role="listitem"></div>
					{/each}
				</div>
			{/if}
			{#if meta}<span class="meta">{meta}</span>{/if}
		</div>
	</div>

	{#if action}
		<div class="action">{@render action()}</div>
	{/if}
</div>

<style>
	.streak-card {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		box-sizing: border-box;
		padding: 6px 10px;
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		min-height: 52px;
	}

	.ring {
		flex: 0 0 auto;
		width: 40px;
		height: 40px;
		border-radius: 50%;
		border: 2px solid var(--c);
		background: radial-gradient(
			ellipse at 40% 30%,
			color-mix(in srgb, var(--c) 14%, var(--bg-input)),
			var(--bg-primary)
		);
		box-shadow: 0 0 12px color-mix(in srgb, var(--c) 18%, transparent);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		line-height: 1;
	}

	.streak-card.is-muted .ring {
		box-shadow: none;
		opacity: 0.8;
	}

	.flame {
		font-size: 0.62rem;
	}

	.num {
		font-size: 0.9rem;
		font-weight: 700;
		color: var(--c);
	}

	.body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.title {
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--text-primary);
		/* Setnings-titler klippes etter titleLines — aldri uppercase her. */
		display: -webkit-box;
		-webkit-line-clamp: var(--title-lines, 2);
		line-clamp: var(--title-lines, 2);
		-webkit-box-orient: vertical;
		overflow: hidden;
		line-height: 1.25;
	}

	.emoji {
		margin-right: 5px;
	}

	/* Prikker + metatekst på samme linje, så kortets høyre kant holdes fri.
	   På hjemmeskjermen ligger «+»-knappen der. */
	.metarow {
		display: flex;
		align-items: center;
		gap: 7px;
		min-width: 0;
	}

	.meta {
		font-size: var(--font-size-caption);
		color: var(--text-tertiary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.dots {
		flex: 0 0 auto;
		display: flex;
		gap: 3px;
	}

	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--border-color);
		border: 1px solid var(--border-color);
	}

	.dot.done {
		background: var(--c);
		border-color: var(--c);
		opacity: 0.65;
	}

	.dot.done.latest {
		opacity: 1;
		box-shadow: 0 0 5px var(--c);
	}

	.action {
		flex: 0 0 auto;
	}
</style>
