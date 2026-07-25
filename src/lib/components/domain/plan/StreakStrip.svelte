<!--
  StreakStrip — streaks vist som en rad med badges.

  Ett visuelt språk for alle tre regler: dager på rad (yoga), uker over en terskel
  (≥2 løpeturer) og runder med periodisk vedlikehold (hårklipp, badevask). Regel-
  kunnskapen ligger i $lib/domain/streaks.ts — denne komponenten velger bare farge
  og viser «Logg runde» for manuelle streaks.
-->
<script lang="ts">
	import { StreakBadge } from '$lib/components/ui';
	import { streakSublabel, type StreakState } from '$lib/domain/streaks';

	export interface StreakStripItem {
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
		streaks: StreakStripItem[];
		/** Registrer en gjennomført runde (kun manuelle streaks). */
		onLogRound?: (definitionId: string) => Promise<void> | void;
		busyId?: string | null;
	}

	let { streaks, onLogRound, busyId = null }: Props = $props();

	// Faste aksentfarger fra designsystemet, syklet så hver streak skiller seg visuelt.
	const PALETTE = [
		'var(--warning-text)',
		'var(--accent-light)',
		'var(--success-text)',
		'var(--accent-muted)'
	];
</script>

{#if streaks.length > 0}
	<div class="streak-strip">
		{#each streaks as { definition, state }, i (definition.id)}
			<div class="streak-item">
				<StreakBadge
					count={state.count}
					unit={state.unit}
					dots={state.dots}
					label={`${definition.emoji} ${definition.title}`}
					sublabel={streakSublabel(state)}
					color={PALETTE[i % PALETTE.length]}
				/>
				{#if onLogRound && definition.source.kind === 'manual'}
					<button
						type="button"
						class="streak-log"
						class:is-urgent={state.status === 'overdue' || state.status === 'due_soon'}
						disabled={busyId === definition.id}
						data-track="streaks:logg-runde"
						onclick={() => onLogRound?.(definition.id)}
					>
						{busyId === definition.id ? '…' : 'Logg runde'}
					</button>
				{/if}
			</div>
		{/each}
	</div>
{/if}

<style>
	.streak-strip {
		display: flex;
		gap: var(--space-lg);
		overflow-x: auto;
		padding-bottom: var(--space-xs);
		scrollbar-width: none;
	}

	.streak-strip::-webkit-scrollbar {
		display: none;
	}

	.streak-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-sm);
		flex: 0 0 auto;
		min-width: 88px;
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
