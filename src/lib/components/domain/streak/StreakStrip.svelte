<!--
  StreakStrip — streakene som hører på denne flaten, med historikk ett trykk unna.

  ## Hvorfor streaken står på temasiden

  En streak lever på hjemskjermen, men den handler om ett område: løpestreaken er
  et treningstall. Åpner man Trening for å se på treningen sin, er «8 dager på rad»
  en del av svaret — og uten den må man tilbake til forsiden for å se om rekka
  fortsatt lever.

  Hvilke streaks som hører hvor avgjøres av `streak-relevance.ts` (kilden, eller en
  eksplisitt temakobling), aldri av en liste over temanavn her.

  Strippen skjuler seg helt når ingenting er relevant: en tom rad med et
  seksjonsnavn er verre enn ingen rad, fordi den ser ut som noe som mangler.
-->
<script lang="ts">
	import ChipStrip from '../../ui/ChipStrip.svelte';
	import StreakChip from '../../ui/StreakChip.svelte';
	import StreakHistorySheet from './StreakHistorySheet.svelte';
	import { streakLabel, streakSublabel, type StreakState } from '$lib/domain/streaks';

	export interface StreakStripItem {
		definition: { id: string; title: string; emoji: string };
		state: StreakState;
	}

	interface Props {
		streaks: StreakStripItem[];
		/** Brukes i data-track, så klikkene kan skilles per flate. */
		area?: string;
	}

	let { streaks, area = 'tema' }: Props = $props();

	// Samme palett som StreakList og hjemskjermen, så en streak kjennes igjen på farge.
	const PALETTE = [
		'var(--warning-text)',
		'var(--accent-light)',
		'var(--success-text)',
		'var(--accent-muted)'
	];

	let openStreak = $state<StreakStripItem | null>(null);
	let openColor = $state('var(--warning-text)');

	/** Kort meta: rekka først, kravet nå etter — begge deler er valgfrie. */
	function metaLine(state: StreakState): string | null {
		return streakLabel(state) || streakSublabel(state) || null;
	}
</script>

{#if streaks.length > 0}
	<ChipStrip ariaLabel="Streaks" class="streak-strip">
		{#each streaks as streak, i (streak.definition.id)}
			<StreakChip
				count={streak.state.count}
				title={streak.definition.title}
				emoji={streak.definition.emoji}
				meta={metaLine(streak.state)}
				color={PALETTE[i % PALETTE.length]}
				dataTrack={`${area}-streaks:apne-historikk`}
				onclick={() => {
					openStreak = streak;
					openColor = PALETTE[i % PALETTE.length];
				}}
			/>
		{/each}
	</ChipStrip>
{/if}

{#if openStreak}
	<StreakHistorySheet
		definitionId={openStreak.definition.id}
		title={openStreak.definition.title}
		emoji={openStreak.definition.emoji}
		color={openColor}
		onclose={() => (openStreak = null)}
	/>
{/if}
