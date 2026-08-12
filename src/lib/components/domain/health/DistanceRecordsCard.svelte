<script lang="ts">
	/**
	 * Distanserekorder — beste tid per distanse, med hvilken økt som holder den.
	 *
	 * Tallene kommer fra `bestEfforts` på `canonical_workouts`: raskeste
	 * sammenhengende strekk innad i en økt. De har vært lagret hele tiden, men
	 * bare brukt til VDOT-estimering.
	 *
	 * Se `$lib/domain/health/distance-records.ts`.
	 */
	import { formatRecordTime } from '$lib/domain/health/distance-records';

	type Record = { key: string; label: string; seconds: number; date: string };

	let { records }: { records: Record[] } = $props();

	const dateFmt = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' });

	/** Tempo per km — det som gjør en tid sammenlignbar på tvers av distanser. */
	function pace(record: Record): string {
		const meters = record.key.endsWith('m')
			? Number(record.key.replace('m', ''))
			: Number(record.key.replace('k', '')) * 1000;
		if (!Number.isFinite(meters) || meters <= 0) return '';
		return `${formatRecordTime(record.seconds / (meters / 1000))} /km`;
	}
</script>

{#if records.length > 0}
	<div class="dr-card">
		<span class="dr-label">Distanserekorder</span>

		<ul class="dr-list">
			{#each records as record (record.key)}
				<li class="dr-row">
					<span class="dr-distance">{record.label}</span>
					<span class="dr-time">{formatRecordTime(record.seconds)}</span>
					<span class="dr-pace">{pace(record)}</span>
					<span class="dr-date">{dateFmt.format(new Date(record.date))}</span>
				</li>
			{/each}
		</ul>

		<!-- Forbeholdet hører i kortet: dette er raskeste strekk INNI en økt, ikke
		     et løp. Under 400 m regnes ingenting — GPS-støyen er da større enn
		     forskjellen mellom to forsøk. -->
		<p class="dr-caveat">
			Raskeste sammenhengende strekk inni en løpeøkt, målt fra GPS-sporet. Ikke løpstider.
		</p>
	</div>
{/if}

<style>
	.dr-card {
		background: var(--surface, #141414);
		border-radius: 14px;
		padding: 1rem 1.1rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.dr-label {
		font-size: 0.8rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted, #8b8b8b);
	}
	.dr-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.dr-row {
		display: grid;
		grid-template-columns: 3.5rem auto 1fr auto;
		align-items: baseline;
		gap: 0.6rem;
		font-size: 0.9rem;
	}
	.dr-distance {
		color: var(--text-muted, #8b8b8b);
	}
	.dr-time {
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--text, #f2f2f2);
	}
	.dr-pace,
	.dr-date {
		font-size: 0.8rem;
		color: var(--text-muted, #8b8b8b);
		font-variant-numeric: tabular-nums;
	}
	.dr-date {
		text-align: right;
	}
	.dr-caveat {
		margin: 0;
		font-size: 0.78rem;
		color: var(--text-muted, #8b8b8b);
		opacity: 0.75;
		line-height: 1.4;
	}
</style>
