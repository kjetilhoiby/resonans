<!--
  StreakList — streaks som en liste med brede kort.

  Ett visuelt språk for alle tre regler: dager på rad (yoga), perioder over en
  terskel (≥2 løpeturer) og runder med periodisk vedlikehold (hårklipp, badevask).
  Regel-kunnskapen bor i $lib/domain/streaks.ts — denne komponenten velger bare
  farge og viser «Logg runde» for manuelle streaks.

  Brede kort framfor en rad med smale badges: titlene er brukerskrevne setninger
  som trenger horisontal plass, og på bredt skjerm legges kortene i to kolonner.

  Trykk på et kort åpner historikken (`StreakHistorySheet`). «Logg»-knappen er
  søsken til trykkflaten, ikke inni den — se NB-en i StreakCard.
-->
<script lang="ts">
	import { StreakCard } from '$lib/components/ui';
	import StreakHistorySheet from '../streak/StreakHistorySheet.svelte';
	import { streakLabel, streakSublabel, type StreakState } from '$lib/domain/streaks';

	export interface StreakListItem {
		definition: {
			id: string;
			title: string;
			emoji: string;
			rule: string;
			source: { kind: string };
		};
		state: StreakState;
	}

	interface Props {
		streaks: StreakListItem[];
		/** Registrer en gjennomført runde (kun manuelle streaks). */
		onLogRound?: (definitionId: string) => Promise<void> | void;
		busyId?: string | null;
	}

	let { streaks, onLogRound, busyId = null }: Props = $props();

	/** Åpen historikk. Panelet ligger utenfor lista, så det ikke arver kortets layout. */
	let openIndex = $state<number | null>(null);
	const open = $derived(openIndex === null ? null : (streaks[openIndex] ?? null));

	// Faste aksentfarger fra designsystemet, syklet så hver streak skiller seg visuelt.
	const PALETTE = [
		'var(--warning-text)',
		'var(--accent-light)',
		'var(--success-text)',
		'var(--accent-muted)'
	];

	/** «6 dager på rad · gjenstår i dag» — begge delene er valgfrie. */
	function metaLine(state: StreakState): string | null {
		const parts = [streakLabel(state), streakSublabel(state)].filter(
			(p): p is string => !!p && p.length > 0
		);
		return parts.length > 0 ? parts.join(' · ') : null;
	}
</script>

{#if streaks.length > 0}
	<div class="streak-list">
		{#each streaks as { definition, state }, i (definition.id)}
			<StreakCard
				count={state.count}
				title={definition.title}
				emoji={definition.emoji}
				meta={metaLine(state)}
				dots={state.dots}
				color={PALETTE[i % PALETTE.length]}
				dataTrack="rutiner-streaks:apne-historikk"
				onpress={() => (openIndex = i)}
			>
				{#snippet action()}
					{#if onLogRound && definition.source.kind === 'manual'}
						<button
							type="button"
							class="streak-log"
							class:is-urgent={state.status === 'overdue' || state.status === 'due_soon'}
							disabled={busyId === definition.id}
							data-track="streaks:logg-runde"
							onclick={() => onLogRound?.(definition.id)}
						>
							{busyId === definition.id ? '…' : 'Logg'}
						</button>
					{/if}
				{/snippet}
			</StreakCard>
		{/each}
	</div>
{/if}

{#if open}
	<StreakHistorySheet
		definitionId={open.definition.id}
		title={open.definition.title}
		emoji={open.definition.emoji}
		color={PALETTE[(openIndex ?? 0) % PALETTE.length]}
		onclose={() => (openIndex = null)}
	/>
{/if}

<style>
	.streak-list {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: var(--space-sm);
	}

	.streak-log {
		background: var(--bg-input);
		border: 1px solid var(--border-color);
		color: var(--text-secondary);
		border-radius: var(--radius-sm);
		padding: 4px 10px;
		font-size: var(--font-size-caption);
		cursor: pointer;
	}

	.streak-log:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--text-primary);
	}

	.streak-log.is-urgent {
		border-color: var(--warning-border);
		color: var(--warning-text);
	}

	.streak-log:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
