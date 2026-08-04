<!--
  NutritionHistory — maten de foregående dagene, dag for dag.

  Bakgrunnen: «Kan jeg se gårsdagens mat?» Dagskortet viser bare i dag, så alt som
  ble logget i går var utilgjengelig — også for retting. Man oppdager sjelden at et
  måltid mangler samme dag; man oppdager det dagen etter.

  I går er åpen, resten lukket. Det er den dagen man faktisk spør etter, og fjorten
  åpne dager ville vært en vegg av tekst.

  Radene er samme `NutritionEntryRow` som i dagskortet, så retting og sletting
  virker likt uansett hvilken dag måltidet ligger på.
-->
<script lang="ts">
	import SectionLabel from '../../ui/SectionLabel.svelte';
	import NutritionEntryRow from './NutritionEntryRow.svelte';
	import { groupByDay, sumEntries, type LoggedEntry } from '$lib/domain/nutrition/day-summary';

	interface Props {
		/** Loggen i vinduet, nyeste først. */
		entries: LoggedEntry[];
		/** Dagens Oslo-dato. Utelates fra lista — den har sitt eget kort. */
		today: string;
		onChanged?: () => void;
	}

	let { entries, today, onChanged }: Props = $props();

	/**
	 * Dagene nyeste først, men måltidene *innenfor* en dag kronologisk. Loggen
	 * kommer nyeste først, og en dag som begynner med kveldsmaten leses baklengs.
	 */
	const days = $derived(
		groupByDay(entries)
			.filter((day) => day.date !== today)
			.map((day) => ({
				...day,
				entries: [...day.entries].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
			}))
	);

	/** Åpne dager. I går er åpen fra start; se komponentkommentaren. */
	let open = $state(new Set<string>());
	let initialised = $state(false);

	$effect(() => {
		if (initialised || days.length === 0) return;
		initialised = true;
		open = new Set([days[0].date]);
	});

	function toggle(date: string) {
		const next = new Set(open);
		if (next.has(date)) next.delete(date);
		else next.add(date);
		open = next;
	}

	function nb(value: number): string {
		return Math.round(value).toLocaleString('nb-NO');
	}

	/**
	 * «I går» og «Lørdag 2. august» framfor en ISO-dato.
	 *
	 * Ukedagen er med fordi det er den man husker etter: «hva spiste jeg på lørdag»
	 * er et spørsmål man stiller, «hva spiste jeg 2026-08-02» er det ikke.
	 */
	function dayLabel(date: string): string {
		const parsed = new Date(`${date}T12:00:00Z`);
		if (Number.isNaN(parsed.getTime())) return date;

		const todayMs = Date.parse(`${today}T12:00:00Z`);
		if (Number.isFinite(todayMs)) {
			const diff = Math.round((todayMs - parsed.getTime()) / 86_400_000);
			if (diff === 1) return 'I går';
			if (diff === 2) return 'I forgårs';
		}

		const label = new Intl.DateTimeFormat('nb-NO', {
			timeZone: 'Europe/Oslo',
			weekday: 'long',
			day: 'numeric',
			month: 'long'
		}).format(parsed);
		return label.charAt(0).toUpperCase() + label.slice(1);
	}
</script>

{#if days.length > 0}
	<section class="history">
		<SectionLabel tag="h2">Tidligere dager</SectionLabel>

		<ul class="days">
			{#each days as day (day.date)}
				{@const totals = sumEntries(day.entries)}
				{@const isOpen = open.has(day.date)}
				<li class="day">
					<button
						type="button"
						class="day-head"
						aria-expanded={isOpen}
						onclick={() => toggle(day.date)}
						data-track="ernaering:apne-tidligere-dag"
					>
						<span class="day-name">{dayLabel(day.date)}</span>
						<span class="day-sum">
							{nb(totals.kcal)} kcal · {nb(totals.proteinG)} g protein
							<span class="day-count">
								{day.entries.length}
								{day.entries.length === 1 ? 'måltid' : 'måltider'}
							</span>
						</span>
						<span class="day-chevron" aria-hidden="true">{isOpen ? '−' : '+'}</span>
					</button>

					{#if isOpen}
						<ul class="entries">
							{#each day.entries as entry (entry.id)}
								<NutritionEntryRow {entry} {onChanged} />
							{/each}
						</ul>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}

<style>
	.history {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.days,
	.entries {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.day {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.day-head {
		display: grid;
		grid-template-columns: 1fr auto auto;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 11px 12px;
		font: inherit;
		text-align: left;
		color: inherit;
		background: var(--card-bg-subtle, #141414);
		border: none;
		border-radius: 12px;
		cursor: pointer;
	}

	.day-name {
		font-size: 0.85rem;
		color: #eee;
	}

	.day-sum {
		display: flex;
		flex-direction: column;
		gap: 1px;
		font-size: 0.72rem;
		text-align: right;
		color: #888;
	}

	.day-count {
		color: #666;
	}

	.day-chevron {
		width: 14px;
		font-size: 0.95rem;
		text-align: center;
		color: #666;
	}

	/* Måltidene rykkes inn, slik at de leses som innholdet i dagen over. */
	.entries {
		padding-left: 10px;
	}
</style>
