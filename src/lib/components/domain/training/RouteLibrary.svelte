<script lang="ts">
	import { enhance } from '$app/forms';

	interface VariantEffort {
		label: string;
		effort: number;
		durationMin: number;
		detail: string;
	}
	interface RouteWithEffort {
		id: string;
		name: string;
		kind: string;
		distanceMeters: number | null;
		elevationMeters: number | null;
		terrain: string | null;
		notes: string | null;
		variants: VariantEffort[];
		minEffort: number;
		maxEffort: number;
	}

	interface Props {
		routes: RouteWithEffort[];
	}

	let { routes }: Props = $props();
	let showForm = $state(false);
	let kind = $state<'run' | 'bike' | 'hill' | 'trail' | 'mixed'>('run');

	const kindLabels: Record<string, string> = {
		run: 'Løp',
		bike: 'Sykkel',
		hill: 'Bakke',
		trail: 'Sti',
		mixed: 'Variert'
	};
	const kindIcons: Record<string, string> = {
		run: '🏃',
		bike: '🚴',
		hill: '⛰️',
		trail: '🌲',
		mixed: '🔀'
	};
</script>

<section class="routes">
	<div class="head">
		<h2>Ruter</h2>
		<button
			type="button"
			class="add"
			data-track="trening:ny-rute-toggle"
			aria-label={showForm ? 'Lukk skjema' : 'Legg til rute'}
			onclick={() => (showForm = !showForm)}
		>
			{showForm ? '✕' : '+ Ny rute'}
		</button>
	</div>

	{#if routes.length === 0 && !showForm}
		<p class="empty">Ingen ruter ennå. Legg til en pendlerunde, en bakke eller en stitur — så får du effort-forslag per fartsvariant.</p>
	{/if}

	<ul class="route-list">
		{#each routes as route (route.id)}
			<li class="route">
				<div class="route-head">
					<span class="icon" aria-hidden="true">{kindIcons[route.kind] ?? '🏃'}</span>
					<span class="name">{route.name}</span>
					<span class="meta">
						{#if route.distanceMeters}{(route.distanceMeters / 1000).toFixed(1).replace('.', ',')} km{/if}
						{#if route.elevationMeters}· {route.elevationMeters} hm{/if}
						{#if route.terrain}· {route.terrain}{/if}
					</span>
				</div>
				<div class="variants">
					{#each route.variants as v (v.label)}
						<span class="variant" title="{v.detail} · ~{v.durationMin} min">
							{v.label} <strong>≈{v.effort}</strong>
						</span>
					{/each}
				</div>
			</li>
		{/each}
	</ul>

	{#if showForm}
		<form method="POST" action="?/nyrute" class="route-form" use:enhance={() => async ({ update }) => { await update(); showForm = false; }}>
			<label>
				Navn
				<input name="name" required placeholder="F.eks. Vannrunden" data-track="trening:rute-navn" />
			</label>
			<label>
				Type
				<select name="kind" bind:value={kind} data-track="trening:rute-type">
					<option value="run">Løp</option>
					<option value="trail">Sti</option>
					<option value="bike">Sykkel</option>
					<option value="hill">Bakke</option>
					<option value="mixed">Variert</option>
				</select>
			</label>

			{#if kind === 'hill'}
				<div class="row">
					<label>Antall drag<input name="reps" type="number" value="10" min="1" data-track="trening:rute-reps" /></label>
					<label>Lengde per drag (m)<input name="repDistanceMeters" type="number" value="200" min="20" data-track="trening:rute-dragmeter" /></label>
				</div>
			{:else}
				<div class="row">
					<label>Distanse (km)<input name="distanceKm" type="number" step="0.1" placeholder="8" data-track="trening:rute-distanse" /></label>
					<label>Høydemeter<input name="elevationMeters" type="number" placeholder="80" data-track="trening:rute-hoyde" /></label>
				</div>
				{#if kind !== 'bike'}
					<div class="row three">
						<label>Rolig (mm:ss)<input name="pace_Rolig" placeholder="6:40" data-track="trening:rute-pace-rolig" /></label>
						<label>Moderat<input name="pace_Moderat" placeholder="6:00" data-track="trening:rute-pace-moderat" /></label>
						<label>Terskel<input name="pace_Terskel" placeholder="5:30" data-track="trening:rute-pace-terskel" /></label>
					</div>
				{/if}
			{/if}

			<label>
				Terreng (valgfritt)
				<input name="terrain" placeholder="vei / sti / variert" data-track="trening:rute-terreng" />
			</label>
			<button type="submit" class="primary">Lagre rute</button>
		</form>
	{/if}
</section>

<style>
	.routes {
		background: var(--card-bg-subtle, #141414);
		border: 1px solid var(--card-border, #242424);
		border-radius: var(--card-radius, 16px);
		padding: var(--card-padding, 16px);
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	h2 {
		font-size: 1.05rem;
		font-weight: 700;
		color: var(--text-primary, #eee);
		margin: 0;
	}

	.add {
		background: none;
		border: 1px solid var(--card-border, #242424);
		border-radius: 999px;
		color: var(--accent-light, #7c8ef5);
		font-size: 0.8rem;
		padding: 0.25rem 0.7rem;
		cursor: pointer;
	}

	.empty {
		font-size: 0.85rem;
		color: var(--text-tertiary, #777);
		margin: 0;
		line-height: 1.45;
	}

	.route-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.route {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.route-head {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.icon {
		font-size: 0.95rem;
	}

	.name {
		font-weight: 650;
		color: var(--text-primary, #eee);
		font-size: 0.92rem;
	}

	.meta {
		font-size: 0.75rem;
		color: var(--text-tertiary, #777);
	}

	.variants {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		padding-left: 1.4rem;
	}

	.variant {
		font-size: 0.78rem;
		color: var(--text-secondary, #aaa);
		background: var(--card-bg-inset, #0d0d0d);
		border-radius: 999px;
		padding: 0.15rem 0.6rem;
	}

	.variant strong {
		color: var(--accent-light, #7c8ef5);
		font-weight: 650;
	}

	.route-form {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		border-top: 1px solid var(--card-border, #242424);
		padding-top: 0.75rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.75rem;
		color: var(--text-secondary, #aaa);
	}

	.row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.6rem;
	}

	.row.three {
		grid-template-columns: 1fr 1fr 1fr;
	}

	input,
	select {
		background: var(--card-bg-inset, #0d0d0d);
		border: 1px solid var(--card-border, #242424);
		border-radius: 10px;
		color: var(--text-primary, #eee);
		padding: 0.45rem 0.6rem;
		font-size: 0.9rem;
	}

	button.primary {
		align-self: flex-start;
		background: var(--accent-primary, #4a5af0);
		color: #fff;
		border: none;
		border-radius: 12px;
		padding: 0.5rem 1.1rem;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
	}
</style>
