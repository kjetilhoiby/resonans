<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import FlowSheet from '$lib/components/flows/FlowSheet.svelte';
	import { FLOWS } from '$lib/flows/registry';
	import type { FlowContext } from '$lib/flows/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let busy = $state<string | null>(null);

	const KIND_LABELS: Record<string, string> = {
		daily_dream: 'I går',
		weekly_dream: 'Uka som var',
		monthly_dream: 'Måneden som var',
		yearly_dream: 'Året som var',
		vision_10year: 'Om ti år',
		vision_5year: 'Om fem år',
		vision_yearly: 'Om ett år',
		vision_quarterly: 'Kommende kvartal',
		vision_themed: 'Tema-visjon'
	};

	const KIND_EMOJI: Record<string, string> = {
		daily_dream: '🌅',
		weekly_dream: '📅',
		monthly_dream: '🗓️',
		yearly_dream: '🎯',
		vision_10year: '🔭',
		vision_5year: '🌟',
		vision_yearly: '🧭',
		vision_quarterly: '🎢',
		vision_themed: '🪶'
	};

	const MODE_LABELS: Record<string, string> = {
		least_effort: 'Minimer',
		steady: 'Hold tempo',
		push: 'Trykk på'
	};

	// Retningen vises alltid med de tre horisontene — tomme kort inviterer til intervjuet.
	const HERO_HORIZONS = ['vision_10year', 'vision_5year', 'vision_yearly'] as const;
	const heroVisions = $derived(
		HERO_HORIZONS.map((kind) => ({
			kind,
			vision: data.authored.find((v) => v.kind === kind) ?? null
		}))
	);
	const hasRetning = $derived(data.authored.length > 0);
	const maalPerHorisont = $derived.by(() => {
		const map = new Map<string, typeof data.langtidsmaal>();
		for (const maal of data.langtidsmaal) {
			const list = map.get(maal.horizon) ?? [];
			list.push(maal);
			map.set(maal.horizon, list);
		}
		return map;
	});

	// ── Manuelt målbart langtidsmål ───────────────────────────────────────
	const MAAL_PRESETS = [
		{ id: 'vekt', label: 'Vekt (kg)', title: 'Vekt', unit: 'kg' },
		{ id: '10k', label: '10 km-tid (min)', title: '10 km', unit: 'min' },
		{ id: '5k', label: '5 km-tid (min)', title: '5 km', unit: 'min' },
		{ id: 'hvilepuls', label: 'Hvilepuls (slag/min)', title: 'Hvilepuls', unit: 'slag/min' },
		{ id: 'belastning', label: 'Treningsbelastning (poeng/uke)', title: 'Treningsbelastning', unit: 'poeng' },
		{ id: 'muskelmasse', label: 'Muskelmasse (kg)', title: 'Muskelmasse', unit: 'kg' },
		{ id: 'sparing', label: 'Sparing (kr/mnd)', title: 'Sparing', unit: 'kr/mnd' },
		{ id: 'annet', label: 'Annet', title: '', unit: '' }
	];
	let nyttMaalOpen = $state(false);
	let maalPreset = $state('vekt');
	let maalTittel = $state('Vekt');
	let maalVerdi = $state('');
	let maalAar = $state(String(new Date().getFullYear() + 5));

	function velgPreset(id: string) {
		maalPreset = id;
		const preset = MAAL_PRESETS.find((p) => p.id === id);
		if (preset && preset.title) maalTittel = preset.title;
		if (id === 'annet') maalTittel = '';
	}

	async function lagreNyttMaal() {
		const verdi = parseFloat(maalVerdi.replace(',', '.'));
		const aar = parseInt(maalAar, 10);
		if (!maalTittel.trim() || !Number.isFinite(verdi)) return;
		busy = 'nytt-maal';
		try {
			const preset = MAAL_PRESETS.find((p) => p.id === maalPreset);
			const res = await fetch('/api/retning/goal', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					title: maalTittel.trim(),
					value: verdi,
					unit: preset?.unit || null,
					year: Number.isFinite(aar) ? aar : null
				})
			});
			if (!res.ok) throw new Error(`Lagring feilet: ${res.status}`);
			nyttMaalOpen = false;
			maalVerdi = '';
			await invalidateAll();
		} catch (err) {
			console.error(err);
			alert('Kunne ikke lagre målet. Sjekk konsollen.');
		} finally {
			busy = null;
		}
	}
	// Rå-samtalen bak retningen — første visjon med kildekobling peker på intervjusamtalen
	const intervjuSamtaleId = $derived(
		data.authored.flatMap((v) => v.conversationIds ?? [])[0] ?? null
	);

	// ── Livsintervjuet ────────────────────────────────────────────────────
	let livsintervjuOpen = $state(false);
	let livsintervjuContext = $state<FlowContext>({});

	async function openLivsintervju() {
		try {
			const res = await fetch('/api/retning/interview-context');
			if (res.ok) {
				const ctx = (await res.json()) as {
					eksisterendeRetning: string;
					verdierNaa: string;
					forrigeIntervju: string;
					kildemateriale: string;
				};
				livsintervjuContext = {
					initialData: {
						_eksisterendeRetning: ctx.eksisterendeRetning,
						_verdierNaa: ctx.verdierNaa,
						_forrigeIntervju: ctx.forrigeIntervju,
						_kildemateriale: ctx.kildemateriale
					}
				};
			}
		} catch {
			livsintervjuContext = {};
		}
		livsintervjuOpen = true;
	}

	// ── Inline-redigering av én visjon ────────────────────────────────────
	let editingHorizon = $state<string | null>(null);
	let editDraft = $state('');

	function startEdit(kind: string, summary: string) {
		editingHorizon = kind;
		editDraft = summary;
	}

	async function saveEdit() {
		if (!editingHorizon || !editDraft.trim()) return;
		busy = editingHorizon;
		try {
			const res = await fetch('/api/retning/vision', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ horizon: editingHorizon, summary: editDraft.trim() })
			});
			if (!res.ok) throw new Error(`Lagring feilet: ${res.status}`);
			editingHorizon = null;
			editDraft = '';
			await invalidateAll();
		} catch (err) {
			console.error(err);
			alert('Kunne ikke lagre visjonen. Sjekk konsollen.');
		} finally {
			busy = null;
		}
	}

	async function generate(kind: string) {
		busy = kind;
		try {
			const res = await fetch('/api/dreams/generate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ kind })
			});
			if (!res.ok) throw new Error(`Generation failed: ${res.status}`);
			await invalidateAll();
		} catch (err) {
			console.error(err);
			alert('Kunne ikke generere drøm. Sjekk konsollen.');
		} finally {
			busy = null;
		}
	}

	async function envision(horizon: string) {
		busy = horizon;
		try {
			const res = await fetch('/api/dreams/envision', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ horizon })
			});
			if (!res.ok) throw new Error(`Envision failed: ${res.status}`);
			await invalidateAll();
		} catch (err) {
			console.error(err);
			alert('Kunne ikke skape visjon. Sjekk konsollen.');
		} finally {
			busy = null;
		}
	}

	async function acceptCandidates(dreamId: string) {
		busy = dreamId;
		try {
			const res = await fetch(`/api/dreams/${dreamId}/accept`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: '{}'
			});
			if (!res.ok) throw new Error(`Accept failed: ${res.status}`);
			const json = await res.json();
			alert(`Lagret ${json.accepted?.length ?? 0} memories.`);
			await invalidateAll();
		} catch (err) {
			console.error(err);
			alert('Kunne ikke lagre memories. Sjekk konsollen.');
		} finally {
			busy = null;
		}
	}
</script>

<!-- Rendres inne i /plan-layoutens faner — layouten eier header og ramme -->

<!-- SEKSJON 1: Retningen (brukerforfattet) -->
	<section class="retning">
		<div class="retning-intro">
			<p class="hint">
				{hasRetning
					? 'Dine egne ord om hvem du vil være. Resten av Resonans holder hverdagen opp mot dette.'
					: 'Ingen retning ennå. Livsintervjuet er en dyp samtale om hvem du vil være om ett, fem og ti år.'}
			</p>
			<div class="retning-cta">
				<button class="btn-primary" data-track="retning:start-livsintervju" onclick={() => void openLivsintervju()}>
					{hasRetning ? '🧭 Oppdater retningen' : '🧭 Start livsintervjuet'}
				</button>
				<button class="btn-secondary" data-track="retning:nytt-maalbart-maal" onclick={() => { nyttMaalOpen = !nyttMaalOpen; }}>
					➕ Målbart mål
				</button>
			</div>

			{#if nyttMaalOpen}
				<div class="nytt-maal">
					<select data-track="retning:maal-type" value={maalPreset} onchange={(e) => velgPreset(e.currentTarget.value)}>
						{#each MAAL_PRESETS as preset (preset.id)}
							<option value={preset.id}>{preset.label}</option>
						{/each}
					</select>
					{#if maalPreset === 'annet'}
						<input type="text" placeholder="Tittel" data-track="retning:maal-tittel" bind:value={maalTittel} />
					{/if}
					<input type="number" placeholder="Målverdi" data-track="retning:maal-verdi" bind:value={maalVerdi} />
					<input type="number" placeholder="Målår" data-track="retning:maal-aar" bind:value={maalAar} />
					<button class="btn-secondary" data-track="retning:lagre-maal" onclick={() => void lagreNyttMaal()} disabled={busy === 'nytt-maal'}>
						{busy === 'nytt-maal' ? 'Lagrer …' : 'Lagre'}
					</button>
				</div>
			{/if}
		</div>

		<div class="hero-grid">
			{#each heroVisions as { kind, vision } (kind)}
				<article class="dream vision hero" class:empty-card={!vision}>
					<header>
						<span class="emoji">{KIND_EMOJI[kind]}</span>
						<h3>{KIND_LABELS[kind]}</h3>
						{#if vision && editingHorizon !== kind}
							<button
								class="btn-ghost"
								data-track="retning:rediger-visjon"
								aria-label={`Rediger visjonen ${KIND_LABELS[kind]}`}
								onclick={() => startEdit(kind, vision.summary)}
							>✏️</button>
						{/if}
					</header>
					{#if editingHorizon === kind}
						<textarea
							class="edit-area"
							data-track="retning:visjon-tekst"
							bind:value={editDraft}
							rows="5"
						></textarea>
						<div class="edit-actions">
							<button class="btn-secondary" data-track="retning:lagre-visjon" onclick={() => void saveEdit()} disabled={busy === kind}>
								{busy === kind ? 'Lagrer …' : 'Lagre revisjon'}
							</button>
							<button class="btn-ghost" onclick={() => { editingHorizon = null; }}>Avbryt</button>
						</div>
					{:else if vision}
						<p class="summary">{vision.summary}</p>
						<p class="meta">Sist revidert {new Date(vision.createdAt).toLocaleDateString('nb-NO')}</p>
					{:else}
						<p class="empty">Ikke formulert ennå — kommer fra livsintervjuet.</p>
					{/if}

					{#if (maalPerHorisont.get(kind) ?? []).length > 0}
						<ul class="maal-liste">
							{#each maalPerHorisont.get(kind) ?? [] as maal (maal.id)}
								<li class="maal-rad">
									<span class="maal-tittel">{maal.title}</span>
									<span class="maal-verdi">
										{#if maal.currentLabel}{maal.currentLabel} → {/if}{maal.targetLabel ?? ''}
										{#if maal.targetYear}<span class="maal-aar">innen {maal.targetYear}</span>{/if}
									</span>
									{#if maal.pct !== null}
										<span class="maal-pct">{maal.pct}%</span>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</article>
			{/each}
		</div>
	</section>

	<!-- SEKSJON 2: Verdier -->
	{#if data.values.length > 0}
		<section class="verdier">
			<h2>⚓ Verdier</h2>
			<p class="hint">Dine egne, bekreftede formuleringer — fra livsintervjuet.</p>
			<ul class="value-list">
				{#each data.values as value (value.id)}
					<li>{value.content}</li>
				{/each}
			</ul>
		</section>
	{/if}

	<!-- SEKSJON 2b: Rå-samtalen — hele intervjuet, ikke bare destillatet -->
	{#if data.intervjuTranskript}
		<details class="transkript" data-track="retning:vis-intervju">
			<summary>📜 Hele intervjuet ({data.intervjuTranskript.periodKey ?? new Date(data.intervjuTranskript.createdAt).getFullYear()})</summary>
			{#if intervjuSamtaleId}
				<a class="samtale-lenke" href={`/samtaler?conversation=${intervjuSamtaleId}`} data-track="retning:aapne-intervjusamtale">
					Åpne intervjusamtalen →
				</a>
			{/if}
			<pre class="transkript-tekst">{data.intervjuTranskript.content}</pre>
		</details>
	{/if}

	<div class="grid">
		<section class="column">
			<h2>🌙 Tilbakeblikk (natt-drøm)</h2>
			<p class="hint">Hva ble det? Synteser som komprimerer det som faktisk skjedde.</p>

			{#if data.synthesis.length === 0}
				<p class="empty">Ingen synteser enda.</p>
			{:else}
				{#each data.synthesis as dream (dream.id)}
					<article class="dream synthesis">
						<header>
							<span class="emoji">{KIND_EMOJI[dream.kind] ?? '🌙'}</span>
							<h3>{KIND_LABELS[dream.kind] ?? dream.kind}</h3>
							{#if dream.highlights?.mode}
								<span class="tag mode mode-{dream.highlights.mode}">
									{MODE_LABELS[dream.highlights.mode] ?? dream.highlights.mode}
								</span>
							{/if}
						</header>
						<p class="summary">{dream.summary}</p>
						{#if dream.highlights?.rationale}
							<p class="rationale"><em>Modus-begrunnelse:</em> {dream.highlights.rationale}</p>
						{/if}
						{#if dream.highlights?.wins?.length || dream.highlights?.frictions?.length}
							<div class="winfric">
								{#if dream.highlights?.wins?.length}
									<div>
										<strong>Wins</strong>
										<ul class="bullets">
											{#each dream.highlights.wins as win}
												<li>{win}</li>
											{/each}
										</ul>
									</div>
								{/if}
								{#if dream.highlights?.frictions?.length}
									<div>
										<strong>Friksjon</strong>
										<ul class="bullets">
											{#each dream.highlights.frictions as f}
												<li>{f}</li>
											{/each}
										</ul>
									</div>
								{/if}
							</div>
						{/if}
					</article>
				{/each}
			{/if}

			<div class="actions">
				<button onclick={() => generate('daily_dream')} disabled={busy !== null}>
					{busy === 'daily_dream' ? 'Drømmer …' : '🌅 Skap dagens drøm'}
				</button>
				<button onclick={() => generate('weekly_dream')} disabled={busy !== null}>
					{busy === 'weekly_dream' ? 'Drømmer …' : '📅 Oppsummer uka'}
				</button>
				<button onclick={() => generate('monthly_dream')} disabled={busy !== null}>
					{busy === 'monthly_dream' ? 'Drømmer …' : '🗓️ Oppsummer måneden'}
				</button>
				<button onclick={() => generate('yearly_dream')} disabled={busy !== null}>
					{busy === 'yearly_dream' ? 'Drømmer …' : '🎯 Oppsummer året'}
				</button>
			</div>
		</section>

		<section class="column">
			<h2>🪄 AI-utkast</h2>
			<p class="hint">LLM-foreslåtte visjoner — utkast, ikke retning, før du har gjort dem til dine.</p>

			{#if data.proposed.length === 0}
				<p class="empty">Ingen AI-utkast.</p>
			{:else}
				{#each data.proposed as dream (dream.id)}
					<article class="dream vision">
						<header>
							<span class="emoji">{KIND_EMOJI[dream.kind] ?? '✨'}</span>
							<h3>{KIND_LABELS[dream.kind] ?? dream.kind}</h3>
							<span class="tag llm">AI-utkast</span>
						</header>
						<p class="summary">{dream.summary}</p>
						{#if dream.highlights?.wins?.length}
							<ul class="bullets">
								{#each dream.highlights.wins as win}
									<li>{win}</li>
								{/each}
							</ul>
						{/if}
						{#if dream.confidence === 'llm_inferred'}
							<button class="btn-secondary" onclick={() => acceptCandidates(dream.id)} disabled={busy === dream.id}>
								{busy === dream.id ? 'Lagrer …' : 'Bekreft som memory'}
							</button>
						{/if}
					</article>
				{/each}
			{/if}

			<div class="actions">
				<button onclick={() => envision('vision_5year')} disabled={busy !== null}>
					{busy === 'vision_5year' ? 'Drømmer …' : '🌟 Utkast: 5-års visjon'}
				</button>
				<button onclick={() => envision('vision_yearly')} disabled={busy !== null}>
					{busy === 'vision_yearly' ? 'Drømmer …' : '🧭 Utkast: års-visjon'}
				</button>
				<button onclick={() => envision('vision_quarterly')} disabled={busy !== null}>
					{busy === 'vision_quarterly' ? 'Drømmer …' : '🎢 Utkast: kvartal-visjon'}
				</button>
			</div>
		</section>
	</div>

	{#if data.visionHistory.length > 0}
		<details class="historical">
			<summary>Retningens revisjoner ({data.visionHistory.length})</summary>
			<ul>
				{#each data.visionHistory as dream (dream.id)}
					<li>
						<strong>{KIND_LABELS[dream.kind] ?? dream.kind}</strong> ·
						{new Date(dream.createdAt).toLocaleDateString('nb-NO')} —
						{dream.summary.slice(0, 120)}{dream.summary.length > 120 ? '…' : ''}
					</li>
				{/each}
			</ul>
		</details>
	{/if}

	{#if data.historical.length > 0}
		<details class="historical">
			<summary>Historikk ({data.historical.length})</summary>
			<ul>
				{#each data.historical as dream (dream.id)}
					<li>
						<strong>{KIND_LABELS[dream.kind] ?? dream.kind}</strong> ·
						{new Date(dream.createdAt).toLocaleDateString('nb-NO')} —
						{dream.summary.slice(0, 120)}{dream.summary.length > 120 ? '…' : ''}
					</li>
				{/each}
			</ul>
		</details>
	{/if}

{#if livsintervjuOpen}
	<FlowSheet
		flow={FLOWS['livsintervju']}
		context={livsintervjuContext}
		onclose={() => { livsintervjuOpen = false; }}
		oncomplete={() => { livsintervjuOpen = false; void invalidateAll(); }}
	/>
{/if}

<style>
	.retning {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		/* plan-layouten eier horisontal padding */
		padding: 0;
	}

	.retning-intro {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		align-items: flex-start;
	}

	.retning-cta {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.nytt-maal {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		align-items: center;
	}

	.nytt-maal select,
	.nytt-maal input {
		background: var(--bg-input);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		padding: 0.45rem 0.6rem;
		font: inherit;
		font-size: 0.875rem;
	}

	.nytt-maal input[type='number'] {
		width: 7rem;
	}

	.maal-liste {
		list-style: none;
		margin: 0.25rem 0 0;
		padding: 0.5rem 0 0;
		border-top: 1px solid var(--border-subtle);
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.maal-rad {
		display: flex;
		gap: 0.5rem;
		align-items: baseline;
		font-size: 0.83rem;
	}

	.maal-tittel {
		color: var(--text-secondary);
		flex: 1;
	}

	.maal-verdi {
		color: var(--text-primary);
		white-space: nowrap;
	}

	.maal-aar {
		color: var(--text-tertiary);
		margin-left: 0.3rem;
	}

	.maal-pct {
		color: var(--accent-light);
		font-weight: 600;
	}

	.hero-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1rem;
	}

	@media (min-width: 720px) {
		.hero-grid {
			grid-template-columns: 1fr 1fr 1fr;
		}
	}

	.dream.hero {
		border-left: 4px solid var(--accent-primary);
	}

	.dream.hero.empty-card {
		border-left-color: var(--border-color);
		opacity: 0.75;
	}

	.meta {
		margin: 0;
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	/* .btn-primary / .btn-secondary / .btn-ghost kommer fra app.css — ingen lokale skygger */

	.edit-area {
		width: 100%;
		box-sizing: border-box;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-input);
		color: var(--text-primary);
		padding: 0.5rem;
		font: inherit;
		line-height: 1.5;
		resize: vertical;
	}

	.edit-actions {
		display: flex;
		gap: 0.5rem;
	}

	.verdier {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 1.5rem 0 0;
	}

	.transkript {
		margin: 1rem 0 0;
	}

	.transkript summary {
		cursor: pointer;
		padding: 0.5rem 0;
	}

	.samtale-lenke {
		display: inline-block;
		margin: 0.25rem 0 0.5rem;
		font-size: 0.875rem;
		color: var(--accent-light);
	}

	.transkript-tekst {
		white-space: pre-wrap;
		font: inherit;
		font-size: 0.875rem;
		line-height: 1.6;
		color: var(--text-secondary);
		border-left: 3px solid var(--border-color);
		padding-left: 0.75rem;
		margin: 0;
		max-height: 60vh;
		overflow-y: auto;
	}

	.verdier h2 {
		margin: 0;
		font-size: 1.1rem;
	}

	.value-list {
		margin: 0;
		padding-left: 1.25rem;
		line-height: 1.7;
	}

	.grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1.5rem;
		padding: 1rem 0;
	}

	@media (min-width: 720px) {
		.grid {
			grid-template-columns: 1fr 1fr;
		}
	}

	.column {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.column h2 {
		margin: 0;
		font-size: 1.1rem;
	}

	.hint {
		margin: 0;
		color: var(--text-secondary);
		font-size: 0.875rem;
	}

	.empty {
		font-style: italic;
		color: var(--text-tertiary);
	}

	.dream {
		border: 1px solid var(--card-border);
		border-radius: var(--radius-lg);
		padding: var(--card-padding);
		background: var(--card-bg);
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.dream.vision {
		border-left: 4px solid var(--accent-light);
	}

	.dream.synthesis {
		border-left: 4px solid var(--warning-text);
	}

	.dream header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.dream header h3 {
		margin: 0;
		font-size: 1rem;
		flex: 1;
	}

	.emoji {
		font-size: 1.25rem;
	}

	.tag {
		font-size: 0.75rem;
		padding: 0.125rem 0.5rem;
		border-radius: 1rem;
		background: var(--card-bg-subtle);
		color: var(--text-secondary);
	}

	.tag.llm {
		background: var(--warning-bg);
		color: var(--warning-text);
	}

	.tag.mode-least_effort {
		background: var(--info-bg);
		color: var(--accent-light);
	}

	.tag.mode-steady {
		background: var(--success-bg);
		color: var(--success-text);
	}

	.tag.mode-push {
		background: var(--error-bg);
		color: var(--error-text);
	}

	.summary {
		margin: 0;
		line-height: 1.5;
	}

	.rationale {
		margin: 0;
		font-size: 0.875rem;
		color: var(--text-secondary);
	}

	.bullets {
		margin: 0;
		padding-left: 1.25rem;
		font-size: 0.875rem;
	}

	.winfric {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
		font-size: 0.875rem;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.actions button {
		padding: 0.5rem 0.875rem;
		border: 1px solid var(--card-border);
		border-radius: var(--radius-sm);
		background: var(--card-bg);
		color: var(--text-secondary);
		cursor: pointer;
		font-size: 0.875rem;
	}

	.actions button:hover {
		background: var(--bg-hover);
	}

	.actions button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.historical {
		margin: 1rem 0;
	}

	.historical summary {
		cursor: pointer;
		padding: 0.5rem;
	}

	.historical ul {
		font-size: 0.875rem;
		color: var(--text-tertiary);
	}
</style>
