<!--
  SleepDisturbanceList — urolige netter, nyeste først.

  Gruppert per natt og ikke per hendelse: tre oppvåkninger samme natt er én
  dårlig natt, og det er nettene man leser mønsteret i.
-->
<script lang="ts">
	import SectionLabel from '../../ui/SectionLabel.svelte';
	import { extractApiErrorMessage } from '$lib/client/api-error';
	import { disturbanceMeta, type DisturbanceNight } from '$lib/domain/sleep/disturbance';

	interface Props {
		nights: DisturbanceNight[];
		onChanged?: () => void;
	}

	let { nights, onChanged }: Props = $props();

	let deleting = $state<string | null>(null);
	let error = $state('');

	const nightFormatter = new Intl.DateTimeFormat('nb-NO', {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		timeZone: 'Europe/Oslo'
	});

	/** Natta vises som morgenen den ender — samme nøkkel serien bruker. */
	function nightLabel(nightKey: string): string {
		const date = new Date(`${nightKey}T12:00:00.000Z`);
		return Number.isNaN(date.getTime()) ? nightKey : nightFormatter.format(date);
	}

	function timeLabel(iso: string): string {
		const date = new Date(iso);
		if (Number.isNaN(date.getTime())) return '';
		return new Intl.DateTimeFormat('nb-NO', {
			hour: '2-digit',
			minute: '2-digit',
			timeZone: 'Europe/Oslo'
		}).format(date);
	}

	async function remove(id: string) {
		if (deleting) return;
		deleting = id;
		error = '';
		try {
			const res = await fetch(`/api/soevn/forstyrrelse?id=${encodeURIComponent(id)}`, {
				method: 'DELETE'
			});
			if (!res.ok) throw new Error(extractApiErrorMessage(res.status, await res.text()));
			onChanged?.();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			deleting = null;
		}
	}
</script>

{#if nights.length > 0}
	<section class="disturbances">
		<SectionLabel tag="h2">Urolige netter</SectionLabel>

		{#each nights as night (night.nightKey)}
			<div class="night">
				<div class="night-head">
					<span class="night-date">Natt til {nightLabel(night.nightKey)}</span>
					{#if night.awakeMinutes !== null && night.awakeMinutes > 0}
						<span class="night-awake">{night.awakeMinutes} min våken</span>
					{/if}
				</div>
				<ul class="night-entries">
					{#each night.entries as entry (entry.id)}
						<li>
							<span class="entry-body">
								<span class="entry-main">
									<span aria-hidden="true">{disturbanceMeta(entry.kind).emoji}</span>
									{disturbanceMeta(entry.kind).description}
									<span class="entry-time">{timeLabel(entry.timestamp)}</span>
								</span>
								{#if entry.note}
									<span class="entry-note">{entry.note}</span>
								{/if}
							</span>
							<button
								type="button"
								class="entry-remove"
								aria-label={`Slett ${disturbanceMeta(entry.kind).description}`}
								onclick={() => void remove(entry.id)}
								disabled={deleting === entry.id}
								data-track="sovn:slett-forstyrrelse"
							>
								{deleting === entry.id ? '…' : '✕'}
							</button>
						</li>
					{/each}
				</ul>
			</div>
		{/each}

		{#if error}
			<p class="error">{error}</p>
		{/if}
	</section>
{/if}

<style>
	.disturbances {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.night {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 12px;
		border-radius: 14px;
		background: #141414;
		border-left: 3px solid #f0b429;
	}

	.night-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
	}

	.night-date {
		font-size: 0.82rem;
		font-weight: 600;
		color: #eee;
	}

	.night-awake {
		font-size: 0.72rem;
		color: #f0b429;
		white-space: nowrap;
	}

	.night-entries {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.night-entries li {
		display: flex;
		align-items: flex-start;
		gap: 6px;
	}

	/* Innhold og slett-knapp er søsken; notatet ligger INNE i innholdet, ellers
	   wrapper knappen ned på en egen linje under notatet. */
	.entry-body {
		display: flex;
		flex-direction: column;
		gap: 1px;
		flex: 1;
		min-width: 0;
	}

	.entry-main {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 5px;
		min-width: 0;
		font-size: 0.78rem;
		color: #aaa;
	}

	.entry-time {
		color: #777;
		white-space: nowrap;
	}

	.entry-note {
		font-size: 0.72rem;
		color: #777;
		overflow-wrap: anywhere;
	}

	.entry-remove {
		background: none;
		border: none;
		color: #666;
		font: inherit;
		font-size: 0.8rem;
		padding: 0 4px;
		cursor: pointer;
	}

	.error {
		margin: 0;
		font-size: 0.78rem;
		color: #e0776b;
		overflow-wrap: anywhere;
	}
</style>
