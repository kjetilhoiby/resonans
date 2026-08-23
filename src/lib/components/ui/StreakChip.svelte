<!--
  StreakChip — streaken i kompakt form: flamme, teller og navn på én linje.

  `StreakCard` er det brede uttrykket (hjemskjerm, /plan/rutiner), der titlene er
  brukerskrevne setninger som trenger horisontal plass. På en temaside er streaken
  ikke det man kom for — den er en påminnelse i toppen av flaten — og et bredt kort
  per streak ville skjøvet dashboardet under falsen.

  Trykkflaten er hele chipen: den åpner historikken.
-->
<script lang="ts">
	interface Props {
		count: number;
		title: string;
		emoji?: string;
		/** Kort sekundærtekst, f.eks. «8 dager på rad». */
		meta?: string | null;
		color?: string;
		muted?: boolean;
		onclick?: () => void;
		dataTrack?: string;
	}

	let {
		count,
		title,
		emoji,
		meta = null,
		color = 'var(--warning-text)',
		muted = false,
		onclick,
		dataTrack
	}: Props = $props();

	const isMuted = $derived(muted || count === 0);
	const accent = $derived(isMuted ? 'var(--text-muted)' : color);
</script>

<button
	type="button"
	class="chip"
	class:is-muted={isMuted}
	style="--c:{accent}"
	data-track={dataTrack}
	aria-label={meta ? `${title}: ${meta}` : title}
	{onclick}
>
	<span class="badge" aria-hidden="true">
		<span class="flame">{isMuted ? '💤' : '🔥'}</span>
		<span class="num">{count}</span>
	</span>
	<span class="text">
		<span class="title">{#if emoji}<span class="emoji">{emoji}</span>{/if}{title}</span>
		{#if meta}<span class="meta">{meta}</span>{/if}
	</span>
</button>

<style>
	.chip {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 0 0 auto;
		max-width: 240px;
		padding: 6px 12px 6px 8px;
		border: 1px solid var(--card-border, #242424);
		border-radius: 999px;
		background: var(--card-bg-subtle, #141414);
		color: inherit;
		cursor: pointer;
		text-align: left;
	}

	.chip.is-muted {
		opacity: 0.72;
	}

	.badge {
		display: flex;
		align-items: center;
		gap: 2px;
		flex: 0 0 auto;
		padding: 2px 7px 2px 5px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--c) 18%, transparent);
	}

	.flame {
		font-size: 0.72rem;
		line-height: 1;
	}

	.num {
		font-size: 0.82rem;
		font-weight: 700;
		color: var(--c);
		font-variant-numeric: tabular-nums;
	}

	.text {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.title {
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--color-text, #eee);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.emoji {
		margin-right: 5px;
	}

	.meta {
		font-size: 0.66rem;
		color: var(--text-muted, #777);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
