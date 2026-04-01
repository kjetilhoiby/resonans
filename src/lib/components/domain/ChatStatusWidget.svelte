<script lang="ts">
	import type { WeatherStatusWidget } from '$lib/ai/tools/weather-forecast';

	interface Props {
		widget: WeatherStatusWidget;
	}

	let { widget }: Props = $props();

	const roundedTemp = $derived(Math.round(widget.temperatureC));
	const windText = $derived(widget.windMps.toFixed(1));
	const rainText = $derived(widget.precipitationNextHourMm.toFixed(1));
	const updatedLabel = $derived(
		new Intl.DateTimeFormat('nb-NO', {
			hour: '2-digit',
			minute: '2-digit'
		}).format(new Date(widget.updatedAt))
	);
</script>

<div class="status-card" role="status" aria-label="Status-widget for vær">
	<div class="status-head">
		<p class="status-title">{widget.title}</p>
		<p class="status-loc">{widget.locationLabel}</p>
	</div>
	<div class="status-main">
		<p class="status-temp">{roundedTemp}°</p>
		<p class="status-cond">{widget.conditionLabel}</p>
	</div>
	<div class="status-grid">
		<div>
			<span>Vind</span>
			<strong>{windText} m/s</strong>
		</div>
		<div>
			<span>Nedbør neste time</span>
			<strong>{rainText} mm</strong>
		</div>
	</div>
	<p class="status-meta">
		Oppdatert {updatedLabel}. Kilde: <a href={widget.sourceUrl} target="_blank" rel="noreferrer">MET.no</a>
	</p>
</div>

<style>
	.status-card {
		margin-top: 10px;
		max-width: 430px;
		border-radius: 14px;
		padding: 14px;
		background: linear-gradient(135deg, #13253f 0%, #1d3b63 55%, #2f5e91 100%);
		border: 1px solid rgba(255, 255, 255, 0.12);
		color: #f4f8ff;
	}

	.status-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 12px;
	}

	.status-title {
		margin: 0;
		font-weight: 700;
		font-size: 0.95rem;
	}

	.status-loc {
		margin: 0;
		font-size: 0.8rem;
		opacity: 0.85;
	}

	.status-main {
		display: flex;
		align-items: baseline;
		gap: 10px;
		margin: 8px 0 12px;
	}

	.status-temp {
		margin: 0;
		font-size: 2rem;
		font-weight: 800;
		letter-spacing: -0.04em;
	}

	.status-cond {
		margin: 0;
		font-size: 0.95rem;
		opacity: 0.95;
	}

	.status-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
	}

	.status-grid div {
		background: rgba(255, 255, 255, 0.08);
		border-radius: 10px;
		padding: 8px 10px;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.status-grid span {
		font-size: 0.72rem;
		opacity: 0.8;
	}

	.status-grid strong {
		font-size: 0.88rem;
	}

	.status-meta {
		margin: 10px 0 0;
		font-size: 0.72rem;
		opacity: 0.8;
	}

	.status-meta a {
		color: #d5e4ff;
	}
</style>
