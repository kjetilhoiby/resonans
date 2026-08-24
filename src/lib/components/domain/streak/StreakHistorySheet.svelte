<!--
  StreakHistorySheet — bunnpanelet bak et streak-kort: hva som faktisk har skjedd.

  Kortet svarer på «hvor mange på rad nå». Det neste spørsmålet er alltid «hva
  skjedde?» — når brøt den, hvor tett har det egentlig vært, var forrige måned
  bedre. Panelet er svaret, og kalenderen er formen som svarer på det: en rekke
  fylte celler er noe man SER, i motsetning til et tall man må tro på.

  ## Historikken hentes når panelet åpnes

  Dagslistene for alle streaks i hver hjem- og temalasting ville vært payload
  ingen hadde bedt om. `GET /api/streaks/[id]/history` leser samme kilde og samme
  vindu som telleren på kortet, så kalenderen summerer til tallet ved siden av.

  Feil vises med melding fra `extractApiErrorMessage` — et `catch {}` med «kunne
  ikke laste» gjør en prod-feil uløselig.
-->
<script lang="ts">
	import BottomSheet from '../../ui/BottomSheet.svelte';
	import StreakCalendar from './StreakCalendar.svelte';
	import { extractApiErrorMessage } from '$lib/client/api-error';
	import { streakLabel, streakSublabel, type StreakState } from '$lib/domain/streaks';
	import {
		firstMonthWithEvents,
		monthOf,
		type StreakHistoryDay
	} from '$lib/domain/streak-history';
	import type { StreakRule, StreakConfig } from '$lib/domain/streaks';

	interface Props {
		definitionId: string;
		/** Vises umiddelbart, så panelet ikke er tomt mens historikken lastes. */
		title: string;
		emoji?: string;
		color?: string;
		onclose: () => void;
	}

	let { definitionId, title, emoji = '🔥', color = 'var(--warning-text)', onclose }: Props =
		$props();

	interface History {
		definition: { title: string; emoji: string; rule: StreakRule; config: StreakConfig };
		state: StreakState;
		days: StreakHistoryDay[];
		lookbackDays: number;
		today: string;
	}

	let history = $state<History | null>(null);
	let error = $state('');
	let month = $state('');

	$effect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const res = await fetch(`/api/streaks/${definitionId}/history`);
				if (!res.ok) {
					error = extractApiErrorMessage(res.status, await res.text());
					return;
				}
				const data = (await res.json()) as History;
				if (cancelled) return;
				history = data;
				// Åpner på inneværende måned — spørsmålet er «hvordan går det nå».
				month = monthOf(data.today);
			} catch (err) {
				if (!cancelled) error = err instanceof Error ? err.message : 'Ukjent feil';
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	const meta = $derived.by(() => {
		if (!history) return null;
		const parts = [streakLabel(history.state), streakSublabel(history.state)].filter(
			(p): p is string => !!p && p.length > 0
		);
		return parts.length > 0 ? parts.join(' · ') : null;
	});

	const earliest = $derived(history ? firstMonthWithEvents(history.days) : null);

	/** «Beste: 14 dager på rad» — historikken føles ikke tapt når rekka brytes. */
	const best = $derived.by(() => {
		if (!history || history.state.bestCount <= 0) return null;
		return streakLabel({ count: history.state.bestCount, unit: history.state.unit });
	});
</script>

<BottomSheet {onclose} ariaLabel={`Historikk for ${title}`}>
	<header class="sh-header">
		<div class="sh-heading">
			<h2>{emoji} {title}</h2>
			{#if meta}<p class="sh-meta">{meta}</p>{/if}
		</div>
		<button class="sh-close" onclick={onclose} aria-label="Lukk historikk">✕</button>
	</header>

	<div class="sh-body">
		{#if error}
			<p class="sh-error">{error}</p>
		{:else if !history}
			<p class="sh-note">Henter historikk…</p>
		{:else if history.days.length === 0}
			<p class="sh-note">
				Ingen registreringer i historikken ennå. Kalenderen fylles av seg selv når hendelsene
				kommer inn — streaken lagres aldri som en teller.
			</p>
		{:else}
			<StreakCalendar
				bind:month
				days={history.days}
				todayKey={history.today}
				rule={history.definition.rule}
				config={history.definition.config}
				{color}
				earliestMonth={earliest}
			/>

			<div class="sh-facts">
				{#if best}<span class="sh-fact">Beste: {best}</span>{/if}
				<span class="sh-fact">
					{history.days.length}
					{history.days.length === 1 ? 'dag' : 'dager'} registrert siste {history.lookbackDays}
					dager
				</span>
			</div>

			<p class="sh-note">
				Regnet fra hendelsene, ikke fra en lagret teller: kommer en økt inn i etterkant,
				reparerer den seg selv.
			</p>

			<!-- Veien til hele lista. Trykk på et streak-kort åpnet før /plan/rutiner, og
			     den veien skal ikke forsvinne fordi panelet tok over trykket. -->
			<a class="sh-link" href="/plan/rutiner" data-track="streak-historikk:alle-rutiner">
				Alle rutiner og streaks →
			</a>
		{/if}
	</div>
</BottomSheet>

<style>
	.sh-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 10px;
		padding: 18px 20px 8px;
	}

	.sh-heading {
		min-width: 0;
	}

	.sh-header h2 {
		margin: 0;
		font-size: 1rem;
		font-weight: 700;
		/* Eksplisitt farge: panelet portaleres til body og arver ellers hva som nå
		   står der — i galleriet ble tittelen nesten usynlig mot bakgrunnen. */
		color: var(--color-text, #eee);
	}

	.sh-meta {
		margin: 2px 0 0;
		font-size: 0.76rem;
		color: var(--color-text-secondary, #999);
	}

	.sh-close {
		background: none;
		border: none;
		color: var(--color-text-secondary, #999);
		cursor: pointer;
		padding: 6px;
		flex: 0 0 auto;
	}

	.sh-body {
		overflow-y: auto;
		padding: 6px 20px calc(20px + env(safe-area-inset-bottom));
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.sh-facts {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.sh-fact {
		padding: 4px 10px;
		border-radius: 999px;
		background: #1c1c1c;
		font-size: 0.72rem;
		color: #bbb;
	}

	.sh-note {
		margin: 0;
		font-size: 0.72rem;
		line-height: 1.5;
		color: var(--text-muted, #777);
	}

	.sh-link {
		align-self: flex-start;
		font-size: 0.76rem;
		color: var(--accent-light, #7c8ef5);
		text-decoration: none;
	}

	.sh-error {
		margin: 0;
		font-size: 0.78rem;
		color: #ee8c8c;
	}
</style>
