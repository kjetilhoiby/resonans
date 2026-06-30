<script lang="ts">
	import SectionLabel from '../../ui/SectionLabel.svelte';
	import ExpandableCard from '../../ui/ExpandableCard.svelte';
	import GpxMap from '../../charts/GpxMap.svelte';
	import TrackProfileChart from '../../charts/TrackProfileChart.svelte';
	import KmSplitsTable from '../../charts/KmSplitsTable.svelte';
	import HrDistributionBar from '../../charts/HrDistributionBar.svelte';
	import { hasElevation, hasHeartRate } from '$lib/utils/track-stats';
	import { normalizeSportType } from '$lib/utils/sport';
	import {
		isWheeledSport,
		speedKmh,
		formatPace,
		formatSpeed,
		formatSpeedDelta,
		paceOrSpeedLabel
	} from '$lib/utils/activity-metrics';
	import {
		buildPaceBaseline,
		compareActivityToBaseline,
		formatPaceDelta
	} from '$lib/utils/activity-history';

	interface WorkoutEvidence {
		eventId: string;
		hasTrackPoints: boolean;
		provider: string;
		sensorType: string;
		distanceMeters: number | null;
		durationSeconds: number | null;
		avgHeartRate: number | null;
	}

	interface WorkoutActivity {
		activityId: string;
		startTime: string;
		sportType: string;
		distanceMeters: number | null;
		durationSeconds: number | null;
		paceSecondsPerKm: number | null;
		elevationMeters: number | null;
		avgHeartRate: number | null;
		maxHeartRate: number | null;
		sources: string[];
		evidence: WorkoutEvidence[];
	}

	interface Props {
		activities: WorkoutActivity[];
	}

	let { activities }: Props = $props();

	// Activity map state
	interface TrackPoint { lat: number; lon: number; ele?: number | null; hr?: number | null; time?: string | null; }
	let mapEventId = $state<string | null>(null);
	let mapPoints = $state<TrackPoint[]>([]);
	let mapLoading = $state(false);

	// Activity card expand state
	let expandedActivityIds = $state<Set<string>>(new Set());
	let activitySportFilter = $state<string | null>(null);
	let activityVisibleCount = $state(10);

	async function toggleActivity(activityId: string, trackEventId: string | null = null) {
		const next = new Set(expandedActivityIds);
		if (next.has(activityId)) {
			next.delete(activityId);
			expandedActivityIds = next;
			return;
		}
		next.add(activityId);
		expandedActivityIds = next;
		if (trackEventId && mapEventId !== trackEventId) {
			await openMap(trackEventId);
		}
	}

	async function openMap(eventId: string) {
		mapEventId = eventId;
		mapPoints = [];
		mapLoading = true;
		try {
			const res = await fetch(`/api/activities/${eventId}/track`);
			if (res.ok) {
				const json = await res.json() as { trackPoints?: TrackPoint[] };
				mapPoints = json.trackPoints ?? [];
			}
		} catch { /* stille feil */ }
		mapLoading = false;
	}

	const availableSportTypes = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const act of activities) {
			const t = normalizeSportType(act.sportType);
			counts.set(t, (counts.get(t) ?? 0) + 1);
		}
		return [...counts.entries()]
			.sort((a, b) => b[1] - a[1])
			.map(([type]) => type);
	});

	const filteredActivities = $derived(
		activitySportFilter
			? activities.filter(a => normalizeSportType(a.sportType) === activitySportFilter)
			: activities
	);

	// Treningstyper der distanse ikke er meningsfull
	const DISTANCE_LESS_SPORTS = new Set(['yoga', 'strength_training', 'pilates']);

	const SPORT_ICONS: Record<string, string> = {
		running: '\u{1F3C3}',
		cycling: '\u{1F6B4}',
		e_bike: '\u{1F6B4}',
		walking: '\u{1F6B6}',
		hiking: '\u{1F97E}',
		swimming: '\u{1F3CA}',
		trail: '\u{1F3D4}️',
		trail_running: '\u{1F3D4}️',
		yoga: '\u{1F9D8}‍♂️',
		tennis: '\u{1F3BE}',
		volleyball: '\u{1F3D0}',
		badminton: '\u{1F3F8}',
		basketball: '\u{1F3C0}',
		rowing: '\u{1F6A3}',
		soccer: '⚽',
		football: '⚽',
		lift_weights: '\u{1F3CB}️',
		calisthenics: '\u{1F3CB}️',
		strength: '\u{1F3CB}️',
		pilates: '\u{1F9D8}‍♂️',
		hiit: '\u{1F525}',
		skiing: '⛷️'
	};

	function sportIcon(sportType: string): string {
		return SPORT_ICONS[normalizeSportType(sportType)] ?? '\u{1F4AA}';
	}

	function sportLabel(sportType: string): string {
		const labels: Record<string, string> = {
			running: 'Løping',
			cycling: 'Sykling',
			e_bike: 'Elsykkel',
			walking: 'Gåtur',
			hiking: 'Turgåing',
			swimming: 'Svømming',
			trail: 'Terrengløp',
			trail_running: 'Terrengløp',
			yoga: 'Yoga',
			rowing: 'Roing',
			soccer: 'Fotball',
			football: 'Fotball',
			lift_weights: 'Styrke',
			calisthenics: 'Styrke',
			strength: 'Styrke',
			pilates: 'Pilates',
			hiit: 'HIIT',
			skiing: 'Ski'
		};
		const t = normalizeSportType(sportType);
		return labels[t] ?? t.charAt(0).toUpperCase() + t.slice(1);
	}

	function formatActivityDate(value: string): string {
		const date = new Date(value);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffH = Math.floor(diffMs / 3600000);
		const diffD = Math.floor(diffMs / 86400000);
		if (diffH < 1) return 'akkurat nå';
		if (diffH < 24) return `${diffH} t siden`;
		if (diffD === 1) return 'i går';
		return new Intl.DateTimeFormat('nb-NO', { weekday: 'short', day: 'numeric', month: 'short' }).format(date);
	}

	function formatDuration(seconds: number | null): string {
		if (!seconds) return '–';
		const m = Math.round(seconds / 60);
		if (m < 60) return `${m} min`;
		const h = Math.floor(m / 60);
		const rem = m % 60;
		return rem === 0 ? `${h} t` : `${h} t ${rem} min`;
	}

	function providerLabel(provider: string, sensorType: string): string {
		if (provider === 'dropbox' || sensorType === 'workout_files') return 'Dropbox (GPX/TCX)';
		if (provider === 'withings') return 'Withings';
		if (provider === 'ai_assistant' || sensorType === 'manual_log') return 'Manuell';
		if (provider === 'strava') return 'Strava';
		return provider.charAt(0).toUpperCase() + provider.slice(1);
	}

	function sourceDiscrepancies(evidence: WorkoutEvidence[]): string[] {
		const withDist = evidence.filter(e => e.distanceMeters !== null);
		const withHr = evidence.filter(e => e.avgHeartRate !== null);
		const lines: string[] = [];
		if (withDist.length > 1) {
			lines.push(withDist.map(e => `${providerLabel(e.provider, e.sensorType)}: ${((e.distanceMeters ?? 0) / 1000).toFixed(1)} km`).join(' · '));
		}
		if (withHr.length > 1) {
			lines.push(withHr.map(e => `${providerLabel(e.provider, e.sensorType)}: ♥ ${e.avgHeartRate} bpm`).join(' · '));
		}
		return lines;
	}
</script>

<div class="hd-activities-section">
	<div class="hd-activities-header">
		<SectionLabel tag="h2">Treningsøkter</SectionLabel>
		{#if availableSportTypes.length > 1}
			<div class="hd-sport-filters">
				<button
					class="hd-sport-chip"
					class:hd-sport-chip--active={activitySportFilter === null}
					onclick={() => { activitySportFilter = null; activityVisibleCount = 10; }}
				>Alle</button>
				{#each availableSportTypes as type}
					<button
						class="hd-sport-chip"
						class:hd-sport-chip--active={activitySportFilter === type}
						onclick={() => { activitySportFilter = type; activityVisibleCount = 10; }}
					>{sportIcon(type)} {sportLabel(type)}</button>
				{/each}
			</div>
		{/if}
	</div>
	<div class="hd-activity-list">
		{#each filteredActivities.slice(0, activityVisibleCount) as act}
			{@const trackEventId = act.evidence.find(e => e.hasTrackPoints)?.eventId ?? null}
			{@const discrepancies = sourceDiscrepancies(act.evidence)}
			{@const isExpanded = expandedActivityIds.has(act.activityId)}
			{@const noDistance = DISTANCE_LESS_SPORTS.has(act.sportType.toLowerCase())}
			{@const compactSuffix = (() => {
				const parts: string[] = [];
				if (act.distanceMeters && !noDistance) parts.push(`${(act.distanceMeters / 1000).toFixed(1)} km`);
				if (act.durationSeconds) parts.push(formatDuration(act.durationSeconds));
				return parts.join(' · ');
			})()}
			<ExpandableCard
				expanded={isExpanded}
				onToggle={() => toggleActivity(act.activityId, trackEventId)}
				ariaLabel={`Vis detaljer for ${sportLabel(act.sportType)}`}
				--ec-bg="transparent"
				--ec-border-expanded="#252525"
				--ec-header-pad="10px 8px"
				--ec-hover="#1a1a1a"
				--ec-chevron="#444"
				--ec-chevron-open="#7c8ef5"
			>
				{#snippet header()}
					<div class="hd-activity-icon">{sportIcon(act.sportType)}</div>
					<div class="hd-activity-info">
						<span class="hd-activity-label">
							{sportLabel(act.sportType)}
							<span class="hd-activity-time">· {formatActivityDate(act.startTime)}</span>
							{#if compactSuffix}<span class="hd-activity-compact-suffix">· {compactSuffix}</span>{/if}
						</span>
					</div>
				{/snippet}

				{#if isExpanded}
					{@const baseline = act.paceSecondsPerKm
						? buildPaceBaseline(activities, act.sportType, act.activityId)
						: null}
					{@const comparison = baseline
						? compareActivityToBaseline(act.paceSecondsPerKm, baseline)
						: null}
					{@const showMapData = mapEventId === trackEventId && mapPoints.length > 0}
					<div class="hd-activity-details">
						<div class="hd-stats">
							{#if act.distanceMeters && !noDistance}
								<div class="hd-stat">
									<span class="hd-stat-label">Distanse</span>
									<span class="hd-stat-value">{(act.distanceMeters / 1000).toFixed(2)} km</span>
								</div>
							{/if}
							{#if act.durationSeconds}
								<div class="hd-stat">
									<span class="hd-stat-label">Varighet</span>
									<span class="hd-stat-value">{formatDuration(act.durationSeconds)}</span>
								</div>
							{/if}
							{#if act.paceSecondsPerKm && !noDistance}
								<div class="hd-stat">
									<span class="hd-stat-label">{paceOrSpeedLabel(act.sportType)}</span>
									<span class="hd-stat-value">
										{isWheeledSport(act.sportType)
											? formatSpeed(act.paceSecondsPerKm)
											: formatPace(act.paceSecondsPerKm)}
									</span>
								</div>
							{/if}
							{#if act.avgHeartRate}
								<div class="hd-stat">
									<span class="hd-stat-label">♥ snitt</span>
									<span class="hd-stat-value">{Math.round(act.avgHeartRate)}<span class="hd-stat-unit"> bpm</span></span>
								</div>
							{/if}
							{#if act.elevationMeters && act.elevationMeters > 0}
								<div class="hd-stat">
									<span class="hd-stat-label">Stigning</span>
									<span class="hd-stat-value">{Math.round(act.elevationMeters)}<span class="hd-stat-unit"> m</span></span>
								</div>
							{/if}
						</div>

						{#if comparison && baseline}
							{@const wheeled = isWheeledSport(act.sportType)}
							{@const speedDelta =
								(speedKmh(act.paceSecondsPerKm) ?? 0) -
								(speedKmh(baseline.avgPaceSecondsPerKm) ?? 0)}
							<div class="hd-comparison" class:hd-comparison-faster={comparison.isFaster}>
								<span class="hd-comparison-icon">
									{#if wheeled}{comparison.isFaster ? '▲' : '▼'}{:else}{comparison.isFaster ? '▼' : '▲'}{/if}
								</span>
								<span class="hd-comparison-text">
									{#if wheeled}
										{formatSpeedDelta(speedDelta)} km/t vs snitt siste {baseline.weeksBack} uker
									{:else}
										{formatPaceDelta(comparison.deltaSecondsPerKm)}/km vs snitt siste {baseline.weeksBack} uker
									{/if}
								</span>
								<span class="hd-comparison-meta">n={baseline.sampleCount}</span>
							</div>
						{/if}

						{#if trackEventId}
							<div class="hd-map-panel">
								{#if mapLoading && mapEventId === trackEventId}
									<div class="hd-map-loading">Laster kart…</div>
								{:else if showMapData}
									<GpxMap points={mapPoints} height={280} />
								{/if}
							</div>

							{#if showMapData}
								<TrackProfileChart points={mapPoints} kind="speed" height={90} />
								{#if hasElevation(mapPoints)}
									<TrackProfileChart points={mapPoints} kind="elevation" height={70} />
								{/if}
								<KmSplitsTable points={mapPoints} sportType={act.sportType} />
								{#if hasHeartRate(mapPoints)}
									<HrDistributionBar points={mapPoints} />
								{/if}
							{/if}
						{/if}

						<a class="hd-detail-link" href="/aktivitet/{act.activityId}">Åpne fullstendig →</a>

						{#if act.evidence.length > 0 || discrepancies.length > 0}
							<details class="hd-sources-detail">
								<summary>Kilder og avvik</summary>
								<div class="hd-sources-content">
									{#if act.evidence.length > 0}
										<div class="hd-activity-sources">
											{#each act.evidence as ev}
												<span class="hd-source-chip" class:hd-source-chip-track={ev.hasTrackPoints}>
													{providerLabel(ev.provider, ev.sensorType)}
													{#if ev.distanceMeters !== null && !noDistance}{(ev.distanceMeters / 1000).toFixed(1)} km{/if}
													{#if ev.durationSeconds !== null}· {formatDuration(ev.durationSeconds)}{/if}
													{#if ev.avgHeartRate !== null}· ♥ {ev.avgHeartRate}{/if}
												</span>
											{/each}
										</div>
									{/if}
									{#if discrepancies.length > 0}
										<span class="hd-activity-discrepancy">⚠ {discrepancies.join(' | ')}</span>
									{/if}
								</div>
							</details>
						{/if}
					</div>
				{/if}
			</ExpandableCard>
		{/each}
	</div>
	{#if filteredActivities.length > activityVisibleCount}
		<button
			class="hd-show-more-btn"
			onclick={() => { activityVisibleCount += 25; }}
		>Vis flere ({filteredActivities.length - activityVisibleCount} gjenstår)</button>
	{/if}
	{#if activityVisibleCount > 10}
		<div class="hd-show-less-sticky">
			<button
				class="hd-show-less-btn"
				onclick={() => { activityVisibleCount = 10; }}
			>Vis færre ↑</button>
		</div>
	{/if}
</div>

<style>
	.hd-activities-section {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: var(--card-padding, 16px);
		background: var(--card-bg-subtle, #141414);
		border-radius: var(--card-radius, 16px);
	}

	.hd-activities-header {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.hd-sport-filters {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.hd-sport-chip {
		padding: 4px 10px;
		font-size: 0.76rem;
		font-weight: 500;
		border-radius: 8px;
		border: 1px solid #2a2a2a;
		background: #1a1a1a;
		color: #888;
		cursor: pointer;
		transition: all 0.12s;
	}

	.hd-sport-chip:hover {
		background: #222;
		color: #ccc;
	}

	.hd-sport-chip--active {
		background: #1e2040;
		border-color: #3a4080;
		color: #aab4f5;
	}

	.hd-show-more-btn {
		align-self: center;
		padding: 7px 20px;
		font-size: 0.8rem;
		font-weight: 500;
		border-radius: 10px;
		border: 1px solid #2a2a2a;
		background: #1a1a1a;
		color: #888;
		cursor: pointer;
		transition: all 0.12s;
	}

	.hd-show-more-btn:hover {
		background: #222;
		color: #ccc;
		border-color: #3a3a3a;
	}

	.hd-show-less-sticky {
		position: sticky;
		bottom: 1rem;
		align-self: center;
		pointer-events: none;
	}

	.hd-show-less-btn {
		pointer-events: auto;
		padding: 7px 20px;
		font-size: 0.8rem;
		font-weight: 500;
		border-radius: 10px;
		border: 1px solid #3a3a3a;
		background: #111;
		color: #999;
		cursor: pointer;
		transition: all 0.12s;
		box-shadow: 0 2px 12px #000a;
	}

	.hd-show-less-btn:hover {
		background: #1a1a1a;
		color: #ccc;
		border-color: #505050;
	}

	.hd-activity-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.hd-activity-icon {
		font-size: 1.3rem;
		flex-shrink: 0;
		width: 32px;
		text-align: center;
	}

	.hd-activity-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.hd-activity-label {
		font-size: 0.88rem;
		font-weight: 500;
		color: #ddd;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.hd-activity-time {
		font-weight: 400;
		color: #666;
	}

	.hd-activity-compact-suffix {
		font-weight: 400;
		color: #555;
	}

	.hd-activity-details {
		/* Minimalt innrykk slik at kart, grafer og tall fyller nesten hele bredden */
		padding: 6px 2px 14px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.hd-stats {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(85px, 1fr));
		gap: 8px;
	}

	.hd-stat {
		background: #161922;
		border-radius: 8px;
		padding: 8px 10px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.hd-stat-label {
		font-size: 0.62rem;
		color: #777;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.hd-stat-value {
		font-size: 0.95rem;
		font-weight: 600;
		color: #e8e8e8;
		font-variant-numeric: tabular-nums;
	}

	.hd-stat-unit {
		font-size: 0.7rem;
		font-weight: 400;
		color: #888;
	}

	.hd-comparison {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		align-self: flex-start;
		font-size: 0.75rem;
		padding: 4px 10px;
		border-radius: 999px;
		background: rgba(251, 146, 60, 0.1);
		color: #fb923c;
		border: 1px solid rgba(251, 146, 60, 0.25);
	}

	.hd-comparison-faster {
		background: rgba(52, 211, 153, 0.1);
		color: #34d399;
		border-color: rgba(52, 211, 153, 0.25);
	}

	.hd-comparison-icon {
		font-size: 0.65rem;
		line-height: 1;
	}

	.hd-comparison-text {
		font-variant-numeric: tabular-nums;
		font-weight: 500;
	}

	.hd-comparison-meta {
		font-size: 0.65rem;
		opacity: 0.7;
		font-variant-numeric: tabular-nums;
	}

	.hd-activity-sources {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.hd-source-chip {
		font-size: 0.7rem;
		color: #777;
		background: #1a1a1a;
		border: 1px solid #252525;
		border-radius: 6px;
		padding: 2px 7px;
		white-space: nowrap;
	}

	.hd-source-chip-track {
		border-color: #2a3a55;
		color: #6a9edd;
	}

	.hd-activity-discrepancy {
		font-size: 0.7rem;
		color: #c8a84b;
		display: block;
	}

	.hd-detail-link {
		font-size: 0.78rem;
		color: #6a8eed;
		text-decoration: none;
		transition: color 0.12s;
		align-self: flex-start;
	}

	.hd-detail-link:hover {
		color: #8aa8ff;
	}

	.hd-map-panel {
		border-radius: 12px;
		overflow: hidden;
	}

	.hd-map-loading {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 280px;
		color: #555;
		font-size: 0.85rem;
		background: #0d1117;
		border-radius: 12px;
	}

	.hd-sources-detail {
		font-size: 0.75rem;
		color: #666;
		border-top: 1px solid #1a1f2a;
		padding-top: 8px;
	}

	.hd-sources-detail summary {
		cursor: pointer;
		color: #555;
		user-select: none;
		padding: 2px 0;
	}

	.hd-sources-detail summary:hover {
		color: #888;
	}

	.hd-sources-detail[open] summary {
		color: #888;
		margin-bottom: 6px;
	}

	.hd-sources-content {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
</style>
