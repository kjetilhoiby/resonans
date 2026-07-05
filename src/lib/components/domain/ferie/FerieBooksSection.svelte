<!--
  FerieBooksSection — «Lesing»-seksjonen på feriesida.

  Presentasjonskomponent: FerieExecutionView laster loggpunktene og bygger
  seriene (buildFerieReadingSeries), slik at seksjonen kan skjules helt når
  ingenting er lest i ferien.

  Ett mål-kort per bok: kompakt rad med fremdriftslinje (ferie-lesingen
  markert som lysere segment), prosent og ferdig/forventet ferdig-dato.
  Kortet ekspanderer til en akkumulert-mot-total-graf der punktene er de
  faktiske slider-snapshotene og en stiplet linje viser prediksjonen mot
  100 % (regresjon over ferie-tempoet).
-->
<script lang="ts">
	import { formatDateLabel, type FerieReadingSeries } from '$lib/ferie/ferie-reading';

	interface Props {
		series: FerieReadingSeries[];
		startDate: string;
		endDate: string;
		/** Åpne alle kortene fra start (for /design-katalogen). */
		defaultExpanded?: boolean;
	}

	let { series, startDate, endDate, defaultExpanded = false }: Props = $props();

	let expanded = $state<Set<string>>(
		new Set(defaultExpanded ? series.map((s) => s.bookId) : [])
	);

	function toggle(bookId: string) {
		const next = new Set(expanded);
		if (next.has(bookId)) next.delete(bookId);
		else next.add(bookId);
		expanded = next;
	}

	/* Graf-geometri (viewBox-koordinater). */
	const VW = 340, VH = 120;
	const PL = 40, PR = 10, PT = 8, PB = 20;
	const CW = VW - PL - PR;
	const CH = VH - PT - PB;

	const f1 = (n: number) => parseFloat(n.toFixed(1));
	const cx = (x: number) => f1(PL + x * CW);
	const cy = (y: number) => f1(PT + (1 - y) * CH);

	function linePath(s: FerieReadingSeries): string {
		return s.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${cx(p.x)},${cy(p.y)}`).join(' ');
	}

	function fmtDay(iso: string): string {
		const [, m, d] = iso.split('-');
		return `${d}.${m}`;
	}

	function statusLabel(s: FerieReadingSeries): string {
		if (s.finished && s.finishedDate) return `Ferdig ${formatDateLabel(s.finishedDate)} 🎉`;
		if (s.etaDate) return `ferdig ~${formatDateLabel(s.etaDate)}`;
		return '';
	}

	// «I dag»-markør når ferien fortsatt pågår (i grafens domene).
	function todayX(s: FerieReadingSeries): number | null {
		const now = new Date();
		const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
		if (iso <= startDate || iso >= s.domainEnd) return null;
		const range = Date.parse(s.domainEnd) - Date.parse(startDate);
		return (Date.parse(iso) - Date.parse(startDate)) / range;
	}

	function pointTitle(s: FerieReadingSeries, value: number, date: string): string {
		const unit = s.metric === 'sider' ? `s. ${value}` : `${Math.floor(value / 60)}t ${value % 60}m`;
		return `${fmtDay(date)}: ${unit}`;
	}
</script>

{#if series.length > 0}
	<ul class="fb-cards">
		{#each series as s (s.bookId)}
			{@const open = expanded.has(s.bookId)}
			<li class="fb-card">
				<button
					type="button"
					class="fb-head"
					aria-expanded={open}
					data-track="ferie-lesing:utvid-bok"
					onclick={() => toggle(s.bookId)}
				>
					{#if s.coverUrl}
						<img class="fb-cover" src={s.coverUrl} alt="" loading="lazy" />
					{/if}
					<div class="fb-meta">
						<div class="fb-toprow">
							<span class="fb-title">{s.title}</span>
							<span class="fb-status" class:fb-status-done={s.finished}>{statusLabel(s)}</span>
						</div>
						<!-- Fremdriftslinja: mørkt segment = før ferien, lyst = lest i ferien -->
						{#if s.fromPct !== null && s.toPct !== null}
							<div class="fb-barrow">
								<div class="fb-bar" role="img" aria-label={`${s.toPct} % av boka`}>
									<span class="fb-bar-before" style:width={`${s.fromPct}%`}></span>
									<span class="fb-bar-ferie" style:width={`${s.toPct - s.fromPct}%`}></span>
								</div>
								<span class="fb-pct">{s.toPct} %</span>
							</div>
						{/if}
						<span class="fb-sub">
							{#if s.author}{s.author} · {/if}{s.metric === 'sider' ? '📖' : '🎧'}
							{s.deltaLabel} i ferien · {s.periodLabel}
						</span>
					</div>
					<span class="fb-chevron" class:fb-chevron-open={open} aria-hidden="true">▾</span>
				</button>

				{#if open}
					<div class="fb-detail">
						<svg
							class="fb-chart"
							viewBox="0 0 {VW} {VH}"
							role="img"
							aria-label={`Akkumulert lesing av ${s.title} mot totalen`}
						>
							<line class="fb-grid" x1={PL} y1={cy(0)} x2={VW - PR} y2={cy(0)} />
							<line class="fb-grid" x1={PL} y1={cy(1)} x2={VW - PR} y2={cy(1)} />
							{#if s.toPct !== null}
								<text class="fb-axis" x={PL - 6} y={cy(1) + 3} text-anchor="end">100 %</text>
								<text class="fb-axis" x={PL - 6} y={cy(0) + 3} text-anchor="end">0</text>
							{/if}

							<!-- Ferieslutt-markør når domenet strekker seg til ETA -->
							{#if s.ferieEndX < 1}
								<line class="fb-marker" x1={cx(s.ferieEndX)} y1={PT} x2={cx(s.ferieEndX)} y2={VH - PB} />
							{/if}
							{#if todayX(s) !== null}
								<line class="fb-marker" x1={cx(todayX(s) ?? 0)} y1={PT} x2={cx(todayX(s) ?? 0)} y2={VH - PB} />
							{/if}

							{#if s.pred}
								<path
									class="fb-pred"
									d={`M${cx(s.pred.x1)},${cy(s.pred.y1)} L${cx(s.pred.x2)},${cy(s.pred.y2)}`}
								/>
							{/if}
							<path class="fb-line" d={linePath(s)} />
							{#each s.points as p (p.date)}
								<g>
									<title>{pointTitle(s, p.value, p.date)}</title>
									<circle class="fb-hit" cx={cx(p.x)} cy={cy(p.y)} r="9" />
									<circle class="fb-dot" cx={cx(p.x)} cy={cy(p.y)} r="3" />
								</g>
							{/each}

							<text class="fb-axis" x={PL} y={VH - 6} text-anchor="start">{fmtDay(startDate)}</text>
							{#if s.ferieEndX < 1}
								<text class="fb-axis" x={cx(s.ferieEndX)} y={VH - 6} text-anchor="middle">{fmtDay(endDate)}</text>
							{/if}
							<text class="fb-axis" x={VW - PR} y={VH - 6} text-anchor="end">
								{s.etaDate && s.domainEnd === s.etaDate ? `~${fmtDay(s.etaDate)}` : fmtDay(s.domainEnd)}
							</text>
						</svg>
						<div class="fb-detail-foot">
							{#if s.paceLabel}<span class="fb-pace">{s.paceLabel} i ferien</span>{/if}
							{#if s.themeId}
								<a class="fb-link" href={`/tema/${s.themeId}`} data-track="ferie-lesing:apne-bok">Åpne boka &rarr;</a>
							{/if}
						</div>
					</div>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<style>
	.fb-cards {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.fb-card {
		background: var(--tp-bg-1, rgba(255, 255, 255, 0.04));
		border: 1px solid var(--tp-border, rgba(255, 255, 255, 0.12));
		border-radius: 10px;
		overflow: hidden;
	}
	.fb-head {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		padding: 0.6rem 0.7rem;
		background: none;
		border: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.fb-cover {
		width: 30px;
		height: 44px;
		object-fit: cover;
		border-radius: 3px;
		flex-shrink: 0;
	}
	.fb-meta {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.fb-toprow {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.fb-title {
		color: var(--tp-text, #ece9e2);
		font-size: 0.9rem;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.fb-status {
		color: var(--tp-text-soft, #aaa);
		font-size: 0.75rem;
		white-space: nowrap;
		flex-shrink: 0;
	}
	.fb-status-done {
		color: var(--tp-accent, #5b93e8);
	}
	.fb-barrow {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.fb-bar {
		flex: 1;
		height: 6px;
		border-radius: 3px;
		background: var(--tp-bg-2, rgba(255, 255, 255, 0.07));
		border: 1px solid var(--tp-border, rgba(255, 255, 255, 0.12));
		display: flex;
		overflow: hidden;
	}
	.fb-bar-before {
		background: var(--tp-accent, #5b93e8);
		opacity: 0.35;
	}
	.fb-bar-ferie {
		background: var(--tp-accent, #5b93e8);
	}
	.fb-pct {
		color: var(--tp-text-soft, #aaa);
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		flex-shrink: 0;
	}
	.fb-sub {
		color: var(--tp-text-soft, #aaa);
		font-size: 0.78rem;
	}
	.fb-chevron {
		color: var(--tp-text-muted, #888);
		font-size: 0.8rem;
		flex-shrink: 0;
		transition: transform 0.15s ease;
	}
	.fb-chevron-open {
		transform: rotate(180deg);
	}

	.fb-detail {
		padding: 0.2rem 0.7rem 0.6rem;
		border-top: 1px solid var(--tp-border, rgba(255, 255, 255, 0.12));
	}
	.fb-chart {
		width: 100%;
		height: auto;
		display: block;
	}
	.fb-grid {
		stroke: var(--tp-border, rgba(255, 255, 255, 0.12));
		stroke-width: 1;
	}
	.fb-marker {
		stroke: var(--tp-text-muted, #888);
		stroke-width: 1;
		stroke-dasharray: 3 3;
		opacity: 0.6;
	}
	.fb-axis {
		fill: var(--tp-text-muted, #999);
		font-size: 9px;
	}
	.fb-line {
		fill: none;
		stroke: var(--tp-accent, #5b93e8);
		stroke-width: 2;
		stroke-linejoin: round;
		stroke-linecap: round;
	}
	.fb-dot {
		fill: var(--tp-accent, #5b93e8);
	}
	.fb-pred {
		fill: none;
		stroke: var(--tp-text-muted, #888);
		stroke-width: 1.5;
		stroke-dasharray: 4 4;
		stroke-linecap: round;
	}
	.fb-hit {
		fill: transparent;
	}
	.fb-detail-foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-top: 0.15rem;
	}
	.fb-pace {
		color: var(--tp-text-soft, #aaa);
		font-size: 0.75rem;
	}
	.fb-link {
		margin-left: auto;
		color: var(--tp-accent, #5b93e8);
		font-size: 0.8rem;
		text-decoration: none;
	}
	.fb-link:hover {
		text-decoration: underline;
	}
</style>
