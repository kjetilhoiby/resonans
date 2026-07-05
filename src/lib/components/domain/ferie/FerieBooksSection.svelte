<!--
  FerieBooksSection — «Lesing»-seksjonen på feriesida.

  Presentasjonskomponent: FerieExecutionView laster loggpunktene og bygger
  seriene (buildFerieReadingSeries), slik at seksjonen kan skjules helt når
  ingenting er lest i ferien.

  Diagrammet viser andel av boka (y) over ferievinduet (x). Punktene er de
  faktiske slider-snapshotene; linja mellom dem er interpolasjon. Maks fire
  bøker får egen linje (fast fargerekkefølge, validert for CVD mot mørk
  flate); alle bøker listes under med lest-mengde og utledet leseperiode.
-->
<script lang="ts">
	import type { FerieReadingSeries } from '$lib/ferie/ferie-reading';

	interface Props {
		series: FerieReadingSeries[];
		startDate: string;
		endDate: string;
	}

	let { series, startDate, endDate }: Props = $props();

	const SERIES_COLORS = ['#5b93e8', '#ce7f26', '#2aa88a', '#d162a8'];
	const MAX_LINES = SERIES_COLORS.length;

	/* Diagram-geometri (viewBox-koordinater). */
	const VW = 340, VH = 130;
	const PL = 40, PR = 10, PT = 8, PB = 20;
	const CW = VW - PL - PR;
	const CH = VH - PT - PB;

	const f1 = (n: number) => parseFloat(n.toFixed(1));
	const cx = (x: number) => f1(PL + x * CW);
	const cy = (y: number) => f1(PT + (1 - y) * CH);

	const lines = $derived(
		series.slice(0, MAX_LINES).map((s, i) => ({
			s,
			color: SERIES_COLORS[i],
			path: s.points.map((p, j) => `${j === 0 ? 'M' : 'L'}${cx(p.x)},${cy(p.y)}`).join(' ')
		}))
	);

	// 100 %-linja er bare meningsfull når minst én linje er normalisert mot
	// bokas faktiske lengde.
	const showPct = $derived(lines.some((l) => l.s.fromPct !== null));

	function fmtDay(iso: string): string {
		const [, m, d] = iso.split('-');
		return `${d}.${m}`;
	}

	// «I dag»-markør når ferien fortsatt pågår.
	const todayX = $derived.by(() => {
		const now = new Date();
		const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
		if (iso <= startDate || iso >= endDate) return null;
		const range = Date.parse(endDate) - Date.parse(startDate);
		return (Date.parse(iso) - Date.parse(startDate)) / range;
	});

	function pointTitle(s: FerieReadingSeries, value: number, date: string): string {
		const unit = s.metric === 'sider' ? `s. ${value}` : `${Math.floor(value / 60)}t ${value % 60}m`;
		return `${s.title} — ${fmtDay(date)}: ${unit}`;
	}
</script>

{#if series.length > 0}
	<svg class="fb-chart" viewBox="0 0 {VW} {VH}" role="img" aria-label="Lesefremdrift gjennom ferien">
		<!-- Gridlinjer: 0 og 100 % -->
		<line class="fb-grid" x1={PL} y1={cy(0)} x2={VW - PR} y2={cy(0)} />
		<line class="fb-grid" x1={PL} y1={cy(1)} x2={VW - PR} y2={cy(1)} />
		{#if showPct}
			<text class="fb-axis" x={PL - 6} y={cy(1) + 3} text-anchor="end">100 %</text>
			<text class="fb-axis" x={PL - 6} y={cy(0) + 3} text-anchor="end">0</text>
		{/if}

		{#if todayX !== null}
			<line class="fb-today" x1={cx(todayX)} y1={PT} x2={cx(todayX)} y2={VH - PB} />
		{/if}

		{#each lines as l (l.s.bookId)}
			<path class="fb-line" d={l.path} stroke={l.color} />
			{#each l.s.points as p (p.date)}
				<g>
					<title>{pointTitle(l.s, p.value, p.date)}</title>
					<circle class="fb-hit" cx={cx(p.x)} cy={cy(p.y)} r="9" />
					<circle cx={cx(p.x)} cy={cy(p.y)} r="3" fill={l.color} />
				</g>
			{/each}
		{/each}

		<text class="fb-axis" x={PL} y={VH - 6} text-anchor="start">{fmtDay(startDate)}</text>
		{#if todayX !== null}
			<text class="fb-axis" x={cx(todayX)} y={VH - 6} text-anchor="middle">i dag</text>
		{/if}
		<text class="fb-axis" x={VW - PR} y={VH - 6} text-anchor="end">{fmtDay(endDate)}</text>
	</svg>

	<ul class="fb-list">
		{#each series as s, i (s.bookId)}
			<li>
				<span class="fb-dot" style:background={i < MAX_LINES ? SERIES_COLORS[i] : 'transparent'}></span>
				{#if s.coverUrl}
					<img class="fb-cover" src={s.coverUrl} alt="" loading="lazy" />
				{/if}
				<div class="fb-meta">
					{#if s.themeId}
						<a class="fb-title" href={`/tema/${s.themeId}`} data-track="ferie-lesing:apne-bok">{s.title}</a>
					{:else}
						<span class="fb-title">{s.title}</span>
					{/if}
					<span class="fb-sub">
						{#if s.author}{s.author} · {/if}{s.metric === 'sider' ? '📖' : '🎧'}
						{s.deltaLabel} · {s.periodLabel}
					</span>
					{#if s.fromPct !== null && s.toPct !== null}
						<span class="fb-pct">{s.fromPct} % → {s.toPct} % av boka</span>
					{/if}
				</div>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.fb-chart {
		width: 100%;
		height: auto;
		display: block;
	}
	.fb-grid {
		stroke: var(--tp-border);
		stroke-width: 1;
	}
	.fb-today {
		stroke: var(--tp-text-muted, #888);
		stroke-width: 1;
		stroke-dasharray: 3 3;
	}
	.fb-axis {
		fill: var(--tp-text-muted, #999);
		font-size: 9px;
	}
	.fb-line {
		fill: none;
		stroke-width: 2;
		stroke-linejoin: round;
		stroke-linecap: round;
	}
	.fb-hit {
		fill: transparent;
	}

	.fb-list {
		list-style: none;
		margin: 0.6rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}
	.fb-list li {
		display: flex;
		align-items: center;
		gap: 0.55rem;
	}
	.fb-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.fb-cover {
		width: 26px;
		height: 38px;
		object-fit: cover;
		border-radius: 3px;
		flex-shrink: 0;
	}
	.fb-meta {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
	}
	.fb-title {
		color: var(--tp-text);
		font-size: 0.9rem;
		font-weight: 600;
		text-decoration: none;
	}
	a.fb-title:hover {
		text-decoration: underline;
	}
	.fb-sub,
	.fb-pct {
		color: var(--tp-text-soft, #aaa);
		font-size: 0.8rem;
	}
</style>
