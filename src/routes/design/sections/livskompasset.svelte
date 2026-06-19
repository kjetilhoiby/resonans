<script lang="ts">
	import LivskompassCheckin from '$lib/components/domain/LivskompassCheckin.svelte';
	import LivskompassWidget from '$lib/components/domain/LivskompassWidget.svelte';
	import { defaultScores, type LivskompassScores } from '$lib/domains/livskompass/dimensions';

	// Demo-scorer med litt variasjon (begge akser 1–10), så hjul og widget viser noe levende.
	const demoScores: LivskompassScores = {
		...defaultScores(),
		partner: { importance: 10, match: 5 },
		barn: { importance: 9, match: 7 },
		venner: { importance: 6, match: 4 },
		sovn: { importance: 8, match: 4 },
		trening: { importance: 7, match: 7 },
		mat: { importance: 6, match: 6 },
		jobb: { importance: 7, match: 9 },
		laering: { importance: 6, match: 4 },
		hobbyer: { importance: 5, match: 4 },
		egentid: { importance: 8, match: 3 },
		natur: { importance: 8, match: 2 },
		kultur: { importance: 5, match: 5 }
	};

	let open = $state(false);
	let onboarding = $state(false);
</script>

<!-- ══ LIVSKOMPASSET ═══════════════════════════════════════════════════════ -->
<section id="livskompasset" class="section">
	<h2 class="section-heading">Livskompasset — helgekompass</h2>
	<p class="section-desc">
		ACT-basert verdikompass som ukentlig helgeøvelse. Hver dimensjon scores på to akser:
		<strong>viktighet</strong> (forhåndsutfylt, justeres ved behov) og ukens <strong>samsvar</strong>.
		Gapet mellom dem — viktig, men lite rom i uka — er det som er «ute av synk» og det chatten tar
		tak i. Vises som fullskjerm helgegate på hjemskjermen + en widget. Demoene under rendrer de
		faktiske komponentene (<code>LivskompassCheckin</code>, <code>LivskompassWidget</code>).
	</p>

	<h3 class="subsection">Onboarding (engangs)</h3>
	<p class="section-desc">
		Første gang: «Ranger viktigheten av disse fra 1–10». Settes én gang, justeres siden ved behov.
	</p>
	<button class="lk-demo-btn" onclick={() => (onboarding = true)}>🧭 Start onboarding</button>

	{#if onboarding}
		<LivskompassCheckin
			needsOnboarding
			startStage="scoring"
			onSaveImportance={() => {}}
			onComplete={() => (onboarding = false)}
			onContinueChat={() => (onboarding = false)}
			onClose={() => (onboarding = false)}
		/>
	{/if}

	<h3 class="subsection">Innsjekk-flyten</h3>
	<p class="section-desc">Scoring → kompass → «snakk om det som er ute av synk». Åpnes som fullskjerm.</p>
	<button class="lk-demo-btn" onclick={() => (open = true)}>🧭 Åpne kompasset</button>

	{#if open}
		<LivskompassCheckin
			initialScores={demoScores}
			startStage="scoring"
			onComplete={() => (open = false)}
			onContinueChat={() => (open = false)}
			onClose={() => (open = false)}
		/>
	{/if}

	<h3 class="subsection">Hjem-widget</h3>
	<p class="section-desc">
		Samme hjul uten etiketter — fargene og gapene er lesbare i miniatyr. Tall i senter = antall
		dimensjoner ute av synk. Tappes for å åpne kompasset.
	</p>
	<div class="lk-widget-demo">
		<LivskompassWidget scores={demoScores} onOpen={() => (open = true)} />
		<LivskompassWidget scores={null} onOpen={() => (open = true)} />
	</div>
</section>

<style>
	.lk-demo-btn {
		padding: 0.65rem 1.4rem;
		border-radius: 999px;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		border: 1px solid transparent;
		background: #4b6ef5;
		color: white;
	}
	.lk-widget-demo {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		max-width: 320px;
	}
</style>
