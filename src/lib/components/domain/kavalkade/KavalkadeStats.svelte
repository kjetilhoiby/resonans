<!--
  KavalkadeStats — «året i tall»-grid med i-år-vs-i-fjor per metrikk.
  Props-drevet: tar to ferdigberegnede årssummarier (fra kavalkade-data).
-->
<script lang="ts">
	import type { LabeledSport, YearData } from './types';

	interface Props {
		current: YearData;
		previous: YearData;
	}

	let { current, previous }: Props = $props();

	const nf = new Intl.NumberFormat('nb-NO');
	const nfCompact = new Intl.NumberFormat('nb-NO', { notation: 'compact', maximumFractionDigits: 1 });

	// Samme fargehjul som showet — hver statboks får sin kulør
	const HUES = [258, 12, 152, 38, 205, 320, 88, 230];

	const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

	function sportValue(s: LabeledSport): string {
		return s.distanceKm >= 1 ? `${nf.format(s.distanceKm)} km` : `${s.count} økter`;
	}

	function weightValue(y: YearData): string {
		if (y.weightStartKg === null || y.weightEndKg === null) return '–';
		const change = y.weightChangeKg;
		const arrow = `${nf.format(y.weightStartKg)} → ${nf.format(y.weightEndKg)} kg`;
		return change !== null ? `${arrow} (${change > 0 ? '+' : ''}${nf.format(change)})` : arrow;
	}

	const stats = $derived.by(() => {
		const rows: Array<{ label: string; value: string; prev: string }> = [];
		const prevByFamily = new Map(previous.sports.map((s) => [s.family, s]));

		for (const sport of current.sports) {
			const prev = prevByFamily.get(sport.family);
			rows.push({
				label: cap(sport.label),
				value: sportValue(sport),
				prev: prev ? sportValue(prev) : '–'
			});
		}
		rows.push({
			label: 'Treningsøkter',
			value: nf.format(current.workoutCount),
			prev: nf.format(previous.workoutCount)
		});
		if (current.stepsTotal !== null || previous.stepsTotal !== null) {
			rows.push({
				label: 'Skritt',
				value: current.stepsTotal !== null ? nfCompact.format(current.stepsTotal) : '–',
				prev: previous.stepsTotal !== null ? nfCompact.format(previous.stepsTotal) : '–'
			});
		}
		rows.push({
			label: 'Bøker lest',
			value: nf.format(current.books.length),
			prev: nf.format(previous.books.length)
		});
		if (current.sleepAvgHours !== null || previous.sleepAvgHours !== null) {
			rows.push({
				label: 'Søvn per natt',
				value: current.sleepAvgHours !== null ? `${nf.format(current.sleepAvgHours)} t` : '–',
				prev: previous.sleepAvgHours !== null ? `${nf.format(previous.sleepAvgHours)} t` : '–'
			});
		}
		if (current.weightStartKg !== null || previous.weightStartKg !== null) {
			rows.push({ label: 'Vekt', value: weightValue(current), prev: weightValue(previous) });
		}
		if (current.screenTimeAvgMinPerDay !== null || previous.screenTimeAvgMinPerDay !== null) {
			rows.push({
				label: 'Skjermtid per dag',
				value:
					current.screenTimeAvgMinPerDay !== null
						? `${nf.format(current.screenTimeAvgMinPerDay)} min`
						: '–',
				prev:
					previous.screenTimeAvgMinPerDay !== null
						? `${nf.format(previous.screenTimeAvgMinPerDay)} min`
						: '–'
			});
		}
		return rows;
	});
</script>

{#if stats.length > 0}
	<div class="kv-stats">
		{#each stats as stat, i (stat.label)}
			<div class="kv-stat" style={`--hue: ${HUES[i % HUES.length]};`}>
				<span class="kv-stat-label">{stat.label}</span>
				<span class="kv-stat-value">{stat.value}</span>
				<span class="kv-stat-prev">i fjor: {stat.prev}</span>
			</div>
		{/each}
	</div>
{:else}
	<p class="kv-empty">Ingen data registrert for året ennå.</p>
{/if}

<style>
	.kv-stats {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px;
	}

	/* --kv-stat-* kan overstyres av kontekst-skins (f.eks. festskinnet) */
	.kv-stat {
		display: flex;
		flex-direction: column;
		gap: 2px;
		background: var(
			--kv-stat-bg,
			linear-gradient(135deg, hsl(var(--hue) 60% 18% / 0.45), transparent 65%),
			var(--card-bg-inset)
		);
		border-left: 2px solid var(--kv-stat-edge, hsl(var(--hue) 80% 55% / 0.7));
		border-radius: var(--radius-md, 10px);
		padding: 10px 12px;
		min-width: 0;
	}

	.kv-stat-label {
		font-size: var(--font-size-caption);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-secondary);
	}

	.kv-stat-value {
		font-size: var(--font-size-title);
		font-weight: 700;
		color: var(--kv-stat-value-color, hsl(var(--hue) 85% 78%));
		overflow-wrap: anywhere;
	}

	.kv-stat-prev {
		font-size: var(--font-size-caption);
		color: var(--text-tertiary, var(--text-secondary));
	}

	.kv-empty {
		margin: 0;
		color: var(--text-secondary);
		font-size: var(--font-size-body);
	}
</style>
