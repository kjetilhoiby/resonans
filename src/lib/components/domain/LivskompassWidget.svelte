<script lang="ts">
	import LivskompassWheel from './LivskompassWheel.svelte';
	import { computeOutOfSync, type LivskompassScores } from '$lib/domains/livskompass/dimensions';

	interface Props {
		/** Siste registrerte kompass, eller null om uka ikke er scoret ennå. */
		scores: LivskompassScores | null;
		onOpen: () => void;
	}

	let { scores, onOpen }: Props = $props();

	const outOfSync = $derived(scores ? computeOutOfSync(scores) : []);
</script>

<button class="lk-card" onclick={onOpen} data-track="livskompass:apne-widget">
	{#if scores}
		<div class="lk-ring">
			<LivskompassWheel
				{scores}
				size={76}
				showLabels={false}
				innerRadiusFraction={0.32}
				gapDeg={2}
				animateOnMount={false}
				centerLabel={String(outOfSync.length)}
				centerSublabel=""
			/>
		</div>
		<div class="lk-meta">
			<span class="lk-title">Ukens kompass</span>
			<span class="lk-head">{outOfSync.length ? `${outOfSync.length} ute av synk` : 'På linje 🎯'}</span>
			{#if outOfSync.length}
				<span class="lk-sub">Mest: {outOfSync[0].label}</span>
			{/if}
		</div>
	{:else}
		<div class="lk-ring lk-ring-empty">🧭</div>
		<div class="lk-meta">
			<span class="lk-title">Ukens kompass</span>
			<span class="lk-head">Ta ukens innsjekk</span>
			<span class="lk-sub">Hvor levde uka opp til det viktige?</span>
		</div>
	{/if}
</button>

<style>
	.lk-card {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		width: 100%;
		box-sizing: border-box;
		padding: 0.85rem 1.1rem 0.85rem 0.85rem;
		border-radius: 18px;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.08);
		cursor: pointer;
		text-align: left;
	}
	.lk-ring {
		flex: none;
		width: 76px;
	}
	.lk-ring-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 76px;
		font-size: 2rem;
	}
	.lk-meta {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.lk-title {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: rgba(255, 255, 255, 0.45);
	}
	.lk-head {
		font-size: 1rem;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.92);
	}
	.lk-sub {
		font-size: 0.78rem;
		color: rgba(255, 255, 255, 0.55);
	}
</style>
