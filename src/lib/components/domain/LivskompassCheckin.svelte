<script lang="ts">
	import { fade } from 'svelte/transition';
	import LivskompassWheel from './LivskompassWheel.svelte';
	import {
		LIVSKOMPASS_AREAS,
		LIVSKOMPASS_DIMENSIONS,
		IMPORTANCE_MAX,
		MATCH_MAX,
		matchLabel,
		importanceLabel,
		computeOutOfSync,
		averageMatch,
		defaultScores,
		buildCoachingSeed,
		buildCoachingSystemPrompt,
		type LivskompassScores
	} from '$lib/domains/livskompass/dimensions';

	type Stage = 'onboarding' | 'scoring' | 'result';

	interface Props {
		/** Forhåndsutfylt viktighet fra onboarding/forrige uke (dim-id → 1–10). */
		prefillImportance?: Record<string, number> | null;
		/** Eksisterende scorer (om uka allerede er påbegynt) — overstyrer prefill. */
		initialScores?: LivskompassScores | null;
		/** Vis viktighets-onboarding først (bruker har aldri rangert viktighet). */
		needsOnboarding?: boolean;
		/** Start direkte på et bestemt steg (f.eks. resultat når man åpner et registrert kompass). */
		startStage?: 'scoring' | 'result';
		/** Lagrer viktighets-profilen når onboarding fullføres. */
		onSaveImportance?: (importance: Record<string, number>) => void;
		onComplete: (data: { scores: LivskompassScores; note: string }) => void;
		onContinueChat: (data: { scores: LivskompassScores; note: string; seed: string; systemPrompt: string }) => void;
		onClose: () => void;
	}

	let {
		prefillImportance = null,
		initialScores = null,
		needsOnboarding = false,
		startStage = 'scoring',
		onSaveImportance,
		onComplete,
		onContinueChat,
		onClose
	}: Props = $props();

	// Slå sammen over defaults så alle 12 dimensjoner alltid finnes (også om et
	// lagret kompass er fra en eldre dimensjonsliste).
	let scores = $state<LivskompassScores>({
		...defaultScores(prefillImportance),
		...(initialScores ?? {})
	});
	let note = $state('');
	let stage = $state<Stage>(needsOnboarding ? 'onboarding' : startStage);
	let showImportance = $state(false);

	// Begge akser er 1–10, så viktighets-markøren og samsvar-thumben deler samme spor-posisjon.
	const tickPct = (v: number) => ((v - 1) / (MATCH_MAX - 1)) * 100;

	function finishOnboarding() {
		const importance: Record<string, number> = {};
		for (const d of LIVSKOMPASS_DIMENSIONS) importance[d.id] = scores[d.id].importance;
		onSaveImportance?.(importance);
		stage = startStage; // videre til ukas samsvar-scoring
	}

	const outOfSync = $derived(computeOutOfSync(scores));
	const avg = $derived(averageMatch(scores).toFixed(1));

	function grouped(areaId: string) {
		return LIVSKOMPASS_DIMENSIONS.filter((d) => d.area === areaId);
	}

	function complete() {
		onComplete({ scores: $state.snapshot(scores), note: note.trim() });
	}

	function continueChat() {
		const snapshot = $state.snapshot(scores);
		onContinueChat({
			scores: snapshot,
			note: note.trim(),
			seed: buildCoachingSeed(snapshot, note),
			systemPrompt: buildCoachingSystemPrompt(snapshot)
		});
	}
</script>

<div class="lk-overlay" transition:fade={{ duration: 200 }}>
	<button class="lk-close" onclick={onClose} aria-label="Lukk">✕</button>

	<div class="lk-inner">
		{#if stage === 'onboarding'}
			<div class="lk-scoring">
				<header class="lk-head">
					<h2>Hva betyr mest for deg?</h2>
					<p>Ranger viktigheten av hvert område fra 1 til 10. Dette setter du bare én gang — etterpå justerer du ved behov.</p>
				</header>

				{#each LIVSKOMPASS_AREAS as area (area.id)}
					<div class="lk-area">
						<div class="lk-area-label" style:color={area.color}>{area.label}</div>
						{#each grouped(area.id) as dim (dim.id)}
							<div class="lk-row">
								<div class="lk-row-head">
									<span class="lk-dim-label">{dim.label}</span>
									<span class="lk-match-val">{importanceLabel(scores[dim.id].importance)} ({scores[dim.id].importance}/{IMPORTANCE_MAX})</span>
								</div>
								<input
									class="lk-slider"
									type="range"
									min="1"
									max={IMPORTANCE_MAX}
									step="1"
									bind:value={scores[dim.id].importance}
									style:--lk-accent={dim.color}
									aria-label="{dim.label} — hvor viktig (1–{IMPORTANCE_MAX})"
									data-track="livskompass:onboarding-{dim.id}"
								/>
							</div>
						{/each}
					</div>
				{/each}

				<button class="lk-primary" onclick={finishOnboarding}>Videre →</button>
			</div>
		{:else if stage === 'scoring'}
			<div class="lk-scoring">
				<header class="lk-head">
					<h2>Ukens kompass</h2>
					<p>Hvor godt levde uka opp til det som betyr noe for deg?</p>
				</header>

				<label class="lk-toggle">
					<input type="checkbox" bind:checked={showImportance} data-track="livskompass:juster-viktighet" />
					Juster viktighet
				</label>

				{#each LIVSKOMPASS_AREAS as area (area.id)}
					<div class="lk-area">
						<div class="lk-area-label" style:color={area.color}>{area.label}</div>
						{#each grouped(area.id) as dim (dim.id)}
							<div class="lk-row">
								<div class="lk-row-head">
									<span class="lk-dim-label">{dim.label}</span>
									<span class="lk-match-val">{matchLabel(scores[dim.id].match)} ({scores[dim.id].match}/{MATCH_MAX})</span>
								</div>
								<div class="lk-slider-wrap">
									<span
										class="lk-imp-tick"
										style:left="{tickPct(scores[dim.id].importance)}%"
										style:background={dim.color}
										title="Viktighet: {scores[dim.id].importance}/{IMPORTANCE_MAX}"
									></span>
									<input
										class="lk-slider"
										type="range"
										min="1"
										max={MATCH_MAX}
										step="1"
										bind:value={scores[dim.id].match}
										style:--lk-accent={dim.color}
										aria-label="{dim.label} — samsvar denne uka"
										data-track="livskompass:samsvar-{dim.id}"
									/>
								</div>
								{#if showImportance}
									<div class="lk-imp-row">
										<span class="lk-imp-label">Viktighet: {importanceLabel(scores[dim.id].importance)} ({scores[dim.id].importance}/{IMPORTANCE_MAX})</span>
										<input
											class="lk-slider lk-slider-imp"
											type="range"
											min="1"
											max={IMPORTANCE_MAX}
											step="1"
											bind:value={scores[dim.id].importance}
											aria-label="{dim.label} — hvor viktig"
											data-track="livskompass:viktighet-{dim.id}"
										/>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/each}

				<button class="lk-primary" onclick={() => (stage = 'result')}>Se kompasset</button>
			</div>
		{:else if stage === 'result'}
			<div class="lk-result">
				<div class="lk-wheel">
					<LivskompassWheel {scores} size={300} centerLabel={avg} centerSublabel="samsvar" />
					<p class="lk-wheel-legend">
						<span class="lk-swatch-solid"></span> uka som gikk &nbsp;·&nbsp;
						<span class="lk-swatch-faint"></span> så viktig det er
					</p>
				</div>

				<div class="lk-sync">
					{#if outOfSync.length}
						<h3>Ute av synk denne uka</h3>
						<ul class="lk-sync-list">
							{#each outOfSync as d (d.id)}
								<li>
									<span class="lk-sync-dot" style:background={d.color}></span>
									<span class="lk-sync-text">
										<strong>{d.label}</strong> — viktig ({d.importance}/10), men uka ga lite rom ({d.match}/10)
									</span>
								</li>
							{/each}
						</ul>
					{:else}
						<h3>Uka var på linje 🎯</h3>
						<p class="lk-sync-text">Ingen store gap mellom det som er viktig og det uka ga rom for.</p>
					{/if}

					<label class="lk-note">
						<span>Vil du si noe kort?</span>
						<textarea
							bind:value={note}
							rows="2"
							placeholder="Valgfritt — én setning om uka."
							data-track="livskompass:notat"
						></textarea>
					</label>

					<div class="lk-actions">
						<button class="lk-secondary" onclick={() => (stage = 'scoring')}>← Juster</button>
						{#if outOfSync.length}
							<button class="lk-primary" onclick={continueChat}>💬 Snakk om det</button>
						{/if}
						<button class="lk-primary" onclick={complete}>Lagre</button>
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.lk-overlay {
		position: fixed;
		inset: 0;
		z-index: 220;
		background: #0d0d12;
		overflow-y: auto;
		padding: 1.5rem 1.25rem 3rem;
	}
	.lk-close {
		position: absolute;
		top: 1rem;
		right: 1rem;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		border: 1px solid rgba(255, 255, 255, 0.12);
		background: rgba(255, 255, 255, 0.04);
		color: rgba(255, 255, 255, 0.7);
		font-size: 1rem;
		cursor: pointer;
	}
	.lk-inner {
		max-width: 440px;
		margin: 2rem auto 0;
	}

	.lk-head h2 {
		margin: 0 0 0.3rem;
		font-size: 1.3rem;
	}
	.lk-head p {
		margin: 0 0 1rem;
		color: rgba(255, 255, 255, 0.6);
		font-size: 0.92rem;
	}
	.lk-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.78rem;
		color: rgba(255, 255, 255, 0.55);
		cursor: pointer;
		margin-bottom: 1rem;
	}

	.lk-area {
		margin-bottom: 1.1rem;
	}
	.lk-area-label {
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		margin-bottom: 0.5rem;
	}
	.lk-row {
		margin-bottom: 0.85rem;
	}
	.lk-row-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.5rem;
		margin-bottom: 0.3rem;
	}
	.lk-dim-label {
		font-size: 0.88rem;
		color: rgba(255, 255, 255, 0.9);
	}
	.lk-match-val {
		font-size: 0.74rem;
		color: rgba(255, 255, 255, 0.5);
		font-style: italic;
	}
	.lk-slider-wrap {
		position: relative;
	}
	.lk-imp-tick {
		position: absolute;
		top: -2px;
		width: 2px;
		height: 16px;
		border-radius: 1px;
		opacity: 0.55;
		transform: translateX(-1px);
		pointer-events: none;
		z-index: 2;
	}
	.lk-imp-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-top: 0.4rem;
	}
	.lk-imp-label {
		font-size: 0.72rem;
		color: rgba(255, 255, 255, 0.45);
		min-width: 9.5rem;
	}
	.lk-slider-imp {
		flex: 1;
	}

	.lk-slider {
		-webkit-appearance: none;
		appearance: none;
		width: 100%;
		height: 6px;
		border-radius: 3px;
		background: #1e1e1e;
		outline: none;
		margin: 5px 0;
	}
	.lk-slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: var(--lk-accent, #4b6ef5);
		cursor: pointer;
		border: 2px solid #0d0d12;
	}
	.lk-slider::-moz-range-thumb {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: var(--lk-accent, #4b6ef5);
		cursor: pointer;
		border: 2px solid #0d0d12;
	}
	.lk-slider-imp::-webkit-slider-thumb {
		background: rgba(255, 255, 255, 0.4);
		width: 14px;
		height: 14px;
	}
	.lk-slider-imp::-moz-range-thumb {
		background: rgba(255, 255, 255, 0.4);
		width: 14px;
		height: 14px;
	}

	.lk-wheel {
		display: flex;
		flex-direction: column;
		align-items: center;
	}
	.lk-wheel-legend {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.74rem;
		color: rgba(255, 255, 255, 0.55);
		margin: 0.4rem 0 0;
	}
	.lk-swatch-solid,
	.lk-swatch-faint {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 2px;
		background: #7c8ef5;
	}
	.lk-swatch-faint {
		background: rgba(124, 142, 245, 0.25);
	}
	.lk-sync {
		margin-top: 1.4rem;
	}
	.lk-sync h3 {
		margin: 0 0 0.6rem;
		font-size: 1rem;
	}
	.lk-sync-list {
		list-style: none;
		padding: 0;
		margin: 0 0 1.1rem;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}
	.lk-sync-list li {
		display: flex;
		gap: 0.55rem;
		align-items: flex-start;
	}
	.lk-sync-dot {
		flex: none;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		margin-top: 0.35rem;
	}
	.lk-sync-text {
		font-size: 0.86rem;
		color: rgba(255, 255, 255, 0.78);
		line-height: 1.4;
	}
	.lk-note {
		display: block;
		margin: 1rem 0;
	}
	.lk-note span {
		display: block;
		font-size: 0.8rem;
		color: rgba(255, 255, 255, 0.55);
		margin-bottom: 0.35rem;
	}
	.lk-note textarea {
		width: 100%;
		box-sizing: border-box;
		padding: 0.6rem 0.8rem;
		border-radius: 12px;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: rgba(255, 255, 255, 0.92);
		font: inherit;
		resize: vertical;
	}
	.lk-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}
	.lk-primary,
	.lk-secondary {
		padding: 0.65rem 1.3rem;
		border-radius: 999px;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		border: 1px solid transparent;
	}
	.lk-primary {
		background: #4b6ef5;
		color: white;
	}
	.lk-secondary {
		background: transparent;
		border-color: rgba(255, 255, 255, 0.18);
		color: rgba(255, 255, 255, 0.7);
	}
</style>
