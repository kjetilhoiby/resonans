<!--
  ChatCalendarSheet — kalender for å hoppe til en dag i samtalen.

  Henter dager med meldinger fra days-endepunktet (konvertert til klientens
  tidssone) og viser MonthCalendar med markører. Trykk på en dag hopper dit.
-->
<script lang="ts">
	import BottomSheet from '$lib/components/ui/BottomSheet.svelte';
	import MonthCalendar from '$lib/components/ui/MonthCalendar.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';

	export interface MessageDay {
		day: string;
		count: number;
	}

	export interface ChatCalendarApi {
		getMessageDays(conversationId: string, tz: string): Promise<MessageDay[]>;
	}

	const defaultApi: ChatCalendarApi = {
		async getMessageDays(conversationId, tz) {
			const res = await fetch(
				`/api/conversations/${conversationId}/messages/days?tz=${encodeURIComponent(tz)}`
			);
			if (!res.ok) throw new Error('Kunne ikke hente dager');
			const data = await res.json();
			return data.days ?? [];
		}
	};

	interface Props {
		conversationId: string;
		onclose: () => void;
		onJump: (day: string) => void;
		/** Nettverkslag — injiseres som mock på /design. Default: ekte API. */
		api?: ChatCalendarApi;
	}

	let { conversationId, onclose, onJump, api = defaultApi }: Props = $props();

	let loading = $state(true);
	let failed = $state(false);
	let markedDays = $state<Record<string, number>>({});
	let initialMonth = $state<string | undefined>(undefined);

	$effect(() => {
		void load();
	});

	async function load() {
		loading = true;
		failed = false;
		try {
			const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Oslo';
			const days = await api.getMessageDays(conversationId, tz);
			markedDays = Object.fromEntries(days.map((d) => [d.day, d.count]));
			// Start i måneden for den nyeste dagen med meldinger.
			const newest = days.at(-1)?.day;
			initialMonth = newest ? newest.slice(0, 7) : undefined;
		} catch {
			failed = true;
		} finally {
			loading = false;
		}
	}
</script>

<BottomSheet {onclose} ariaLabel="Kalender">
	<div class="cs-header">
		<h2 class="cs-title">Kalender</h2>
		<button class="cs-close" aria-label="Lukk" onclick={onclose}>
			<Icon name="close" size={18} />
		</button>
	</div>

	<div class="cs-body">
		{#if loading}
			<p class="cs-hint">Laster…</p>
		{:else if failed}
			<p class="cs-hint">Kunne ikke hente kalenderen. Prøv igjen.</p>
		{:else if Object.keys(markedDays).length === 0}
			<p class="cs-hint">Ingen meldinger ennå.</p>
		{:else}
			<MonthCalendar {initialMonth} {markedDays} onSelectDay={onJump} />
		{/if}
	</div>
</BottomSheet>

<style>
	.cs-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 18px 20px 10px;
	}

	.cs-title {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 700;
		color: var(--text-primary, #eee);
	}

	.cs-close {
		background: none;
		border: none;
		color: var(--text-secondary, #aaa);
		cursor: pointer;
		padding: 6px;
		border-radius: 8px;
		display: flex;
	}
	.cs-close:hover {
		background: var(--bg-elevated, #141414);
		color: var(--text-primary, #eee);
	}

	.cs-body {
		padding: 0 20px max(env(safe-area-inset-bottom), 20px);
		min-height: 260px;
	}

	.cs-hint {
		margin: 32px auto;
		font-size: 0.85rem;
		color: var(--text-secondary, #777);
		text-align: center;
	}
</style>
