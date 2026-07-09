<!--
  KappeplanDiagram — visuell kappeplan for ett materiale (lengdevare eller plate).
  Delt mellom Kapplister-fanen (mørk app) og utskriftssiden (lyst papir, `paper`).
  Rendrer selve planen + snitt-notat; toggle/overskrift eier kalleren.
-->
<script lang="ts">
	import { guillotineCutLines, type MaterialResult } from '$lib/kappliste/calc';

	interface Props {
		res: MaterialResult;
		guillotine: boolean;
		kerfMm: number;
		paper?: boolean; // lyst papir-tema for utskrift
	}

	let { res, guillotine, kerfMm, paper = false }: Props = $props();
</script>

<div class="kappeplan" class:paper>
	{#if res.layout.kind === 'linear'}
		{@const lay = res.layout}
		<div class="plan linear">
			{#each lay.boards as board, i (i)}
				<div class="plan-row">
					<span class="plan-idx">{i + 1}</span>
					<div class="bar" title={`${board.pieces.join(' + ')} mm`}>
						{#each board.pieces as p, j (j)}
							<span class="seg" style:flex={p}>{p}</span>
						{/each}
						{#if board.wasteMm > 1}
							<span class="seg waste" style:flex={board.wasteMm}>{Math.round(board.wasteMm)}</span>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{:else}
		{@const lay = res.layout}
		<div class="plan sheets">
			{#each lay.sheets as sheet, i (i)}
				<div class="sheet-wrap">
					<span class="sheet-cap">Plate {i + 1} · {lay.stockWidthMm}×{lay.stockHeightMm} mm</span>
					<div class="sheet-box" style:aspect-ratio={`${lay.stockWidthMm} / ${lay.stockHeightMm}`}>
						{#each sheet.placements as pl, j (j)}
							<div
								class="rect"
								style:left={`${(pl.x / lay.stockWidthMm) * 100}%`}
								style:top={`${(pl.y / lay.stockHeightMm) * 100}%`}
								style:width={`${(pl.w / lay.stockWidthMm) * 100}%`}
								style:height={`${(pl.h / lay.stockHeightMm) * 100}%`}
							>
								<span>{pl.w}×{pl.h}</span>
							</div>
						{/each}
						{#if guillotine}
							{#each guillotineCutLines(sheet.placements, lay.stockWidthMm, lay.stockHeightMm, kerfMm) as cut, k (k)}
								<div
									class="cut-line {cut.orientation === 'v' ? 'vert' : 'horiz'}"
									style:left={`${(cut.x1 / lay.stockWidthMm) * 100}%`}
									style:top={`${(cut.y1 / lay.stockHeightMm) * 100}%`}
									style:width={cut.orientation === 'h' ? `${((cut.x2 - cut.x1) / lay.stockWidthMm) * 100}%` : undefined}
									style:height={cut.orientation === 'v' ? `${((cut.y2 - cut.y1) / lay.stockHeightMm) * 100}%` : undefined}
								></div>
							{/each}
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
	<p class="plan-note">
		{#if res.cutCount != null}≈ {res.cutCount} sagsnitt · {/if}{res.kind === 'sheet' ? 'Forenklet kappeplan (estimat) — ' : ''}grå felt er kapp til overs.
	</p>
</div>

<style>
	/* Fargevariabler — app-tema (mørk) som default, overstyres av .paper for utskrift. */
	.kappeplan {
		--kp-line: var(--card-border);
		--kp-fill: var(--tp-accent-bg-strong);
		--kp-fill-border: var(--tp-border-strong);
		--kp-text: var(--tp-text);
		--kp-muted: var(--tp-text-muted);
		--kp-waste-a: var(--tp-bg-2);
		--kp-waste-b: var(--tp-bg-1);
		--kp-cut: rgba(255, 240, 220, 0.9);
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.kappeplan.paper {
		--kp-line: #b9a894;
		--kp-fill: #d8c4a8;
		--kp-fill-border: #a88f6e;
		--kp-text: #2a2016;
		--kp-muted: #6b5d4a;
		--kp-waste-a: #efe7db;
		--kp-waste-b: #f7f2e9;
		--kp-cut: #7a2e12;
	}

	.plan {
		display: flex;
		flex-direction: column;
		gap: 7px;
	}
	.plan.sheets {
		flex-flow: row wrap;
		gap: 14px;
	}
	.plan-idx {
		font-size: 0.66rem;
		color: var(--kp-muted);
		font-variant-numeric: tabular-nums;
	}

	/* Linear: horisontal stolpe med segmenter */
	.plan-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.plan-row .plan-idx {
		width: 14px;
		flex-shrink: 0;
		text-align: right;
	}
	.bar {
		flex: 1;
		display: flex;
		height: 26px;
		border-radius: 6px;
		overflow: hidden;
		border: 1px solid var(--kp-line);
		gap: 1px;
		background: var(--kp-line);
	}
	.seg {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 0;
		overflow: hidden;
		background: var(--kp-fill);
		color: var(--kp-text);
		font-size: 0.64rem;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.seg.waste {
		background: repeating-linear-gradient(
			45deg,
			var(--kp-waste-a),
			var(--kp-waste-a) 4px,
			var(--kp-waste-b) 4px,
			var(--kp-waste-b) 8px
		);
		color: var(--kp-muted);
	}

	/* Sheet: plate med absolutt-plasserte kapp */
	.sheet-wrap {
		display: flex;
		flex-direction: column;
		gap: 4px;
		width: 260px;
		max-width: 100%;
	}
	.paper .sheet-wrap {
		width: 340px;
	}
	.sheet-cap {
		font-size: 0.66rem;
		color: var(--kp-muted);
		font-variant-numeric: tabular-nums;
	}
	.sheet-box {
		position: relative;
		width: 100%;
		background: repeating-linear-gradient(
			45deg,
			var(--kp-waste-a),
			var(--kp-waste-a) 4px,
			var(--kp-waste-b) 4px,
			var(--kp-waste-b) 8px
		);
		border: 1px solid var(--kp-line);
		border-radius: 6px;
		overflow: hidden;
	}
	.rect {
		position: absolute;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--kp-fill);
		border: 1px solid var(--kp-fill-border);
		box-sizing: border-box;
		overflow: hidden;
	}
	.rect span {
		font-size: 0.6rem;
		color: var(--kp-text);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		padding: 0 2px;
	}

	/* Guillotine-kuttlinjer: rette gjennomgående snitt oppå planen. */
	.cut-line {
		position: absolute;
		pointer-events: none;
		z-index: 2;
	}
	.cut-line.vert {
		border-left: 1px dashed var(--kp-cut);
		transform: translateX(-0.5px);
	}
	.cut-line.horiz {
		border-top: 1px dashed var(--kp-cut);
		transform: translateY(-0.5px);
	}

	.plan-note {
		margin: 0;
		font-size: 0.68rem;
		color: var(--kp-muted);
	}
	.paper .plan-note {
		font-size: 0.7rem;
	}
</style>
