<!--
  SONE 1B: I dag
  Styringssignalene fra brevet som korte linjer man kan trykke på. Reglene bor i
  $lib/domain/home-today.ts; se docs/changelog/2026-10-12-i-dag-pa-hjemskjermen.md.
-->
<script lang="ts">
	import { fade } from 'svelte/transition';
	import type { HomeToday } from '$lib/domain/home-today';

	/**
	 * Tar primitiver, ikke HOME_CTX, så galleriet kan vise den med mock-data
	 * (`/design/flater`, hjem-seksjonen).
	 */
	interface Props {
		/** Strømmet fra lasteren; null når innhentingen feilet. */
		homeToday: Promise<(HomeToday & { failed: string[] }) | null> | null;
		/** Skjult mens chatfeltet er åpent, som tittelsonen. */
		hidden?: boolean;
	}

	let { homeToday, hidden = false }: Props = $props();
</script>

{#if !hidden && homeToday}
	{#await homeToday then today}
		{#if today && (today.lines.length > 0 || today.failed.length > 0)}
			<section class="zone-today" aria-labelledby="i-dag-tittel" in:fade={{ duration: 220 }}>
				<h2 id="i-dag-tittel" class="label">I dag</h2>
				<ul class="lines">
					{#each today.lines as line (line.id)}
						<li>
							{#if line.href}
								<a class="line" href={line.href} data-track="hjem:i-dag">
									<span class="dot" class:venter={line.kind === 'venter'} aria-hidden="true"></span>
									<span class="text">{line.text}</span>
									<span class="chevron" aria-hidden="true">›</span>
								</a>
							{:else}
								<div class="line">
									<span class="dot" class:venter={line.kind === 'venter'} aria-hidden="true"></span>
									<span class="text">{line.text}</span>
								</div>
							{/if}
						</li>
					{/each}
				</ul>
				{#if today.more > 0}
					<a class="more" href="/brev" data-track="hjem:i-dag-mer">
						{today.more === 1 ? 'Én ting til' : `${today.more} ting til`} i brevet ›
					</a>
				{/if}
				{#if today.failed.length > 0}
					<!-- Færre linjer fordi en kilde døde, skal ikke se ut som en roligere dag. -->
					<p class="failed">Fikk ikke lest: {today.failed.join(', ')}.</p>
				{/if}
			</section>
		{/if}
	{/await}
{/if}

<style>
	.zone-today {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding-bottom: var(--space-lg);
	}

	.label {
		margin: 0 0 4px;
		font-size: 0.75rem;
		font-weight: 600;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--text-tertiary);
	}

	.lines {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.lines li + li .line {
		border-top: 1px solid var(--border-color);
	}

	.line {
		display: flex;
		align-items: baseline;
		gap: 12px;
		min-height: 44px;
		padding: 11px 0;
		box-sizing: border-box;
		color: var(--text-primary);
		text-decoration: none;
		font-size: 0.98rem;
		line-height: 1.42;
	}

	a.line:active .text {
		opacity: 0.7;
	}

	.dot {
		flex: 0 0 8px;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--border-color);
		transform: translateY(-1px);
	}

	/* Det som venter på deg får uttrykkets sol; resten er en stille prikk. */
	.dot.venter {
		background: var(--accent-light);
	}

	.text {
		flex: 1 1 auto;
		min-width: 0;
	}

	.chevron {
		flex: 0 0 auto;
		color: var(--text-tertiary);
		font-size: 1.1rem;
	}

	.more {
		align-self: flex-start;
		margin-top: 2px;
		padding: 8px 0;
		font-size: 0.88rem;
		font-weight: 600;
		color: var(--accent-primary);
		text-decoration: none;
	}

	.failed {
		margin: 4px 0 0;
		font-size: 0.8rem;
		color: var(--text-tertiary);
	}
</style>
