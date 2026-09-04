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

	/**
	 * `activityId` er nøkkelen til å GRANSKE en rekord. Et raskeste-strekk-tall
	 * kan ikke etterprøves fra lista alene — er 4:00/km over fire kilometer ekte,
	 * eller en sykkeltur registrert som løping? Svaret ligger i kartet på
	 * øktsida, og uten lenka er den to navigasjoner og et gjett unna.
	 *
	 * Den kan være `null`: en klynge uten evidence-event har ingen side å åpne.
	 * Raden vises da uten lenke — en lenke som ikke virker er verre enn ingen.
	 */
	type Record = {
		key: string;
		label: string;
		seconds: number;
		activityId: string | null;
		date: string;
	};

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
				<li>
					{#if record.activityId}
						<a
							class="dr-row dr-link"
							href="/aktivitet/{record.activityId}"
							data-track="distanserekorder:apne-okt"
						>
							<span class="dr-distance">{record.label}</span>
							<span class="dr-time">{formatRecordTime(record.seconds)}</span>
							<span class="dr-pace">{pace(record)}</span>
							<span class="dr-date">{dateFmt.format(new Date(record.date))}</span>
						</a>
					{:else}
						<div class="dr-row">
							<span class="dr-distance">{record.label}</span>
							<span class="dr-time">{formatRecordTime(record.seconds)}</span>
							<span class="dr-pace">{pace(record)}</span>
							<span class="dr-date">{dateFmt.format(new Date(record.date))}</span>
						</div>
					{/if}
				</li>
			{/each}
		</ul>

		<!-- Forbeholdet hører i kortet: dette er raskeste strekk INNI en økt, ikke
		     et løp. Under 400 m regnes ingenting — GPS-støyen er da større enn
		     forskjellen mellom to forsøk. -->
		<p class="dr-caveat">
			Raskeste sammenhengende strekk inni en løpeøkt, målt fra GPS-sporet. Ikke løpstider.
			Trykk på en rad for å se økta og kartet.
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
	.dr-list > li {
		display: block;
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
	.dr-link {
		text-decoration: none;
		color: inherit;
		border-radius: 8px;
		margin: -0.15rem -0.35rem;
		padding: 0.15rem 0.35rem;
	}
	.dr-link:hover,
	.dr-link:focus-visible {
		background: var(--surface-hover, rgba(255, 255, 255, 0.05));
	}
	.dr-caveat {
		margin: 0;
		font-size: 0.78rem;
		color: var(--text-muted, #8b8b8b);
		opacity: 0.75;
		line-height: 1.4;
	}
</style>
