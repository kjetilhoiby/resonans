<!--
  StreakBadge — sirkel med teller og prikker under.

  Rent presentasjonelt: all regel-kunnskap (hva som teller, hva som kreves nå)
  bor i $lib/domain/streaks.ts. Samme badge brukes for dager på rad, uker over en
  terskel og runder med periodisk vedlikehold — ett visuelt språk for alle streaks.

  Props:
    count     antall runder på rad (0 = brutt, vises dempet)
    unit      'day' | 'week' | 'round' — styrer teksten under tallet
    dots      historikk, eldste først: true = runde holdt
    label     tittel under prikkene (f.eks. «Yoga»)
    sublabel  hva som kreves nå (f.eks. «forfaller om 3 dager»)
    color     aksentfarge
    muted     tegn dempet (brukes når streaken er brutt / på overtid)
-->
<script lang="ts">
	import type { StreakUnit } from '$lib/domain/streaks';

	interface Props {
		count: number;
		unit?: StreakUnit;
		dots?: boolean[];
		label?: string;
		sublabel?: string | null;
		color?: string;
		muted?: boolean;
	}

	let {
		count,
		unit = 'day',
		dots = [],
		label,
		sublabel = null,
		color = 'var(--warning-text)',
		muted = false,
	}: Props = $props();

	const UNIT_TEXT: Record<StreakUnit, [singular: string, plural: string]> = {
		day: ['dag', 'dager'],
		week: ['uke', 'uker'],
		round: ['runde', 'runder'],
	};

	const unitText = $derived(count === 1 ? UNIT_TEXT[unit][0] : UNIT_TEXT[unit][1]);
	// Siste holdte runde markeres tydeligere enn de foregående.
	const latestIdx = $derived(dots.reduce((acc, v, i) => (v ? i : acc), -1));
	const isMuted = $derived(muted || count === 0);
	const accent = $derived(isMuted ? 'var(--text-muted)' : color);
</script>

<div class="streak-wrap">
	<div class="streak-circ" class:is-muted={isMuted} style="--c:{accent}">
		<span class="streak-flame">{isMuted ? '💤' : '🔥'}</span>
		<span class="streak-num" style="color:{accent}">{count}</span>
		<span class="streak-unit">{unitText}</span>
	</div>
	{#if dots.length > 0}
		<div class="streak-dots" role="list" aria-label="Historikk">
			{#each dots as done, i}
				<div
					class="dot"
					class:done
					class:latest={done && i === latestIdx}
					style="--c:{accent}"
					role="listitem"
				></div>
			{/each}
		</div>
	{/if}
	{#if label}
		<span class="streak-label">{label}</span>
	{/if}
	{#if sublabel}
		<span class="streak-sublabel">{sublabel}</span>
	{/if}
</div>

<style>
	.streak-wrap {
		--circ: 80px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
	}

	.streak-circ {
		width: var(--circ);
		height: var(--circ);
		border-radius: 50%;
		border: 2.5px solid var(--c);
		background: radial-gradient(
			ellipse at 40% 30%,
			color-mix(in srgb, var(--c) 12%, var(--bg-input)),
			var(--bg-secondary)
		);
		box-shadow: 0 0 18px color-mix(in srgb, var(--c) 15%, transparent);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0;
	}

	.streak-circ.is-muted {
		box-shadow: none;
		opacity: 0.75;
	}

	.streak-flame {
		font-size: 0.9rem;
		line-height: 1;
	}

	.streak-num {
		font-size: 1.1rem;
		font-weight: 700;
		line-height: 1;
	}

	.streak-unit {
		font-size: 0.58rem;
		color: var(--text-muted);
		text-transform: lowercase;
	}

	.streak-dots {
		display: flex;
		gap: var(--space-xs);
	}

	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--border-color);
		border: 1px solid var(--border-color);
		transition: background 0.15s;
	}

	.dot.done {
		background: var(--c);
		border-color: var(--c);
		opacity: 0.65;
	}

	.dot.done.latest {
		opacity: 1;
		box-shadow: 0 0 6px var(--c);
	}

	.streak-label {
		font-size: 0.6rem;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.07em;
		text-align: center;
	}

	.streak-sublabel {
		font-size: 0.58rem;
		color: var(--text-muted);
		text-align: center;
		margin-top: -4px;
	}

</style>
