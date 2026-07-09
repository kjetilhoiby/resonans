<!--
  Utskriftsvennlig kappliste — lyst papir-tema. Åpnes fra Kapplister-fanen; kaller
  window.print() automatisk slik at brukeren kan «Lagre som PDF» eller printe.
  Gjenbruker KappeplanDiagram (paper-variant) for kappeplanen.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { computeMaterial, formatNok, type Material } from '$lib/kappliste/calc';
	import KappeplanDiagram from '$lib/components/domain/theme/KappeplanDiagram.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let printedAt = $state('');

	onMount(() => {
		printedAt = new Date().toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' });
		// La layout og fonter falle på plass før print-dialogen åpnes.
		const t = setTimeout(() => window.print(), 500);
		return () => clearTimeout(t);
	});

	function cutRows(mat: Material): string[][] {
		if (mat.kind === 'linear') {
			return mat.cuts
				.filter((c) => (c.lengthMm ?? 0) > 0 && c.quantity > 0)
				.map((c) => [`${c.lengthMm} mm`, `${c.quantity}`]);
		}
		return mat.cuts
			.filter((c) => (c.widthMm ?? 0) > 0 && (c.heightMm ?? 0) > 0 && c.quantity > 0)
			.map((c) => [`${c.widthMm} mm`, `${c.heightMm} mm`, `${c.quantity}`]);
	}
</script>

<svelte:head>
	<title>Kappliste — {data.themeName}</title>
</svelte:head>

<div class="doc">
	<div class="toolbar">
		<button onclick={() => window.print()}>Skriv ut / Lagre som PDF</button>
		<span class="hint">Velg «Lagre som PDF» som skriver i dialogen.</span>
	</div>

	<header class="doc-head">
		<h1>Kappliste — {data.themeName}</h1>
		{#if printedAt}<span class="date">{printedAt}</span>{/if}
	</header>

	{#if data.cutLists.length === 0}
		<p class="empty">Ingen kapplister med materialer å skrive ut.</p>
	{/if}

	{#each data.cutLists as list (list.id)}
		<section class="list">
			<h2>{list.title}</h2>
			<p class="meta">
				Sagsnitt {list.kerfMm} mm{#if list.guillotine} · sagbare kutt (guillotine){/if}
			</p>

			{#each list.materials as mat (mat.id)}
				{@const res = computeMaterial(mat, list.kerfMm, list.guillotine)}
				{#if res.totalPieces > 0 || res.tooBig.length > 0}
					<div class="material">
						<div class="mat-head">
							<h3>{mat.name.trim() || (mat.kind === 'linear' ? 'Lengdevare' : 'Plate')}</h3>
							<span class="tag">{mat.kind === 'linear' ? 'Lengdevare' : 'Plate'}</span>
						</div>

						{#if res.tooBig.length > 0}
							<p class="err">Kapp {res.tooBig.join(', ')} er for store for {res.stockLabel}</p>
						{:else}
							<p class="result">
								<strong>
									{res.stockNeeded}
									{res.kind === 'linear'
										? res.stockNeeded === 1
											? 'lekt/bjelke'
											: 'lekter/bjelker'
										: res.stockNeeded === 1
											? 'plate'
											: 'plater'}
								</strong>
								à {res.stockLabel} — {formatNok(res.costNok)}{#if res.wasteText} · {res.wasteText}{/if}
							</p>
						{/if}

						<table class="cuts">
							<thead>
								{#if mat.kind === 'linear'}
									<tr><th>Lengde</th><th>Antall</th></tr>
								{:else}
									<tr><th>Bredde</th><th>Høyde</th><th>Antall</th></tr>
								{/if}
							</thead>
							<tbody>
								{#each cutRows(mat) as row, i (i)}
									<tr>{#each row as cell, j (j)}<td>{cell}</td>{/each}</tr>
								{/each}
							</tbody>
						</table>

						{#if res.tooBig.length === 0 && res.totalPieces > 0}
							<KappeplanDiagram {res} guillotine={list.guillotine} kerfMm={list.kerfMm} paper />
						{/if}
					</div>
				{/if}
			{/each}
		</section>
	{/each}
</div>

<style>
	:global(body) {
		background: #fff;
	}
	.doc {
		max-width: 820px;
		margin: 0 auto;
		padding: 24px 28px 48px;
		color: #2a2016;
		font-family:
			system-ui,
			-apple-system,
			'Segoe UI',
			Roboto,
			sans-serif;
		background: #fff;
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 20px;
	}
	.toolbar button {
		background: #2a2016;
		color: #fff;
		border: 0;
		border-radius: 8px;
		padding: 9px 16px;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
	}
	.toolbar .hint {
		font-size: 0.8rem;
		color: #6b5d4a;
	}

	.doc-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		border-bottom: 2px solid #2a2016;
		padding-bottom: 8px;
		margin-bottom: 20px;
	}
	.doc-head h1 {
		margin: 0;
		font-size: 1.5rem;
	}
	.date {
		font-size: 0.85rem;
		color: #6b5d4a;
	}
	.empty {
		color: #6b5d4a;
	}

	.list {
		margin-bottom: 28px;
	}
	.list h2 {
		margin: 0 0 2px;
		font-size: 1.15rem;
	}
	.meta {
		margin: 0 0 12px;
		font-size: 0.82rem;
		color: #6b5d4a;
	}

	.material {
		margin-bottom: 18px;
		padding-bottom: 16px;
		border-bottom: 1px solid #e3d9c9;
		break-inside: avoid;
	}
	.material:last-child {
		border-bottom: 0;
	}
	.mat-head {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 4px;
	}
	.mat-head h3 {
		margin: 0;
		font-size: 1rem;
	}
	.tag {
		font-size: 0.62rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #6b5d4a;
		border: 1px solid #b9a894;
		border-radius: 5px;
		padding: 2px 6px;
	}
	.result {
		margin: 0 0 10px;
		font-size: 0.95rem;
	}
	.err {
		margin: 0 0 10px;
		font-size: 0.9rem;
		color: #a03020;
		font-weight: 600;
	}

	.cuts {
		border-collapse: collapse;
		margin: 0 0 12px;
		font-size: 0.82rem;
		font-variant-numeric: tabular-nums;
	}
	.cuts th,
	.cuts td {
		border: 1px solid #d8ccb8;
		padding: 3px 12px;
		text-align: right;
	}
	.cuts th {
		background: #f2ebdd;
		font-weight: 600;
		text-align: right;
	}

	@media print {
		.toolbar {
			display: none;
		}
		.doc {
			max-width: none;
			padding: 0;
		}
		.list {
			break-inside: auto;
		}
	}

	@page {
		margin: 14mm;
	}
</style>
