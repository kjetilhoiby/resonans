<!--
  PrioritySection — rekkefølgen på Retning-fanen.

  Hvorfor den står her, og over nedprioriteringene: rekkefølgen sier hva som
  kommer FØRST, nedprioriteringen hva som er lagt bort. Samme rekkefølge som i
  chat-konteksten, og de er ikke hverandres motsatser — det som ikke står på
  lista er ikke valgt bort. Teksten sier det, fordi det er slutningen alle tar.

  Intervjuet er ikke eneste vei inn. Det er estimert til en halvtime, og en
  rekkefølge man ikke kan rette før neste år er ikke en rekkefølge man eier.

  Se docs/changelog/2026-09-19-retningen-som-baerer-prioriteringer.md
-->
<script lang="ts">
	import {
		MAX_PRIORITIES,
		isRankingStale,
		type Priority,
		type Ranking
	} from '$lib/domains/livskompass/ranking';

	interface Props {
		ranking: Ranking | null;
		onchanged: () => Promise<void> | void;
	}

	let { ranking, onchanged }: Props = $props();

	let editing = $state(false);
	let busy = $state(false);
	let error = $state<string | null>(null);
	// Arbeidskopien: rekkefølgen redigeres som en helhet, siden «flytt denne opp»
	// er en endring av alle posisjonene under den.
	let utkast = $state<Array<{ label: string; why: string }>>([]);
	let nyLabel = $state('');
	let nyWhy = $state('');

	const todayKey = new Date().toISOString().slice(0, 10);
	const gammel = $derived(ranking ? isRankingStale(ranking, todayKey) : false);

	function start() {
		utkast = (ranking?.priorities ?? []).map((p: Priority) => ({
			label: p.label,
			why: p.why ?? ''
		}));
		nyLabel = '';
		nyWhy = '';
		error = null;
		editing = true;
	}

	function flytt(index: number, retning: -1 | 1) {
		const mål = index + retning;
		if (mål < 0 || mål >= utkast.length) return;
		const kopi = [...utkast];
		[kopi[index], kopi[mål]] = [kopi[mål], kopi[index]];
		utkast = kopi;
	}

	function fjern(index: number) {
		utkast = utkast.filter((_, i) => i !== index);
	}

	function leggTil() {
		if (!nyLabel.trim() || utkast.length >= MAX_PRIORITIES) return;
		utkast = [...utkast, { label: nyLabel.trim(), why: nyWhy.trim() }];
		nyLabel = '';
		nyWhy = '';
	}

	async function lagre() {
		busy = true;
		error = null;
		try {
			const res = await fetch('/api/livskompass/prioritering', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ priorities: utkast })
			});
			const result = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(result.error || 'Lagring feilet');
			editing = false;
			await onchanged();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Ukjent feil';
		} finally {
			busy = false;
		}
	}
</script>

<section class="rekkefolge">
	<h2>🥇 Rekkefølgen</h2>
	<p class="hint">
		Hva som kommer først når to ting ikke får plass i samme uke. Det som ikke står her er ikke
		valgt bort — det er bare ikke først.
	</p>

	{#if !editing}
		{#if ranking && ranking.priorities.length > 0}
			<ol class="liste">
				{#each ranking.priorities as p, i (p.label)}
					<li class="rad">
						<span class="plass">{i + 1}</span>
						<span class="innhold">
							<span class="tittel">{p.label}</span>
							{#if p.why}<span class="grunn">{p.why}</span>{/if}
						</span>
					</li>
				{/each}
			</ol>
			<p class="satt">
				Satt {ranking.setOn}{#if gammel} — over et år siden. Står den fortsatt?{/if}
			</p>
		{:else}
			<p class="tom">
				Ingen rekkefølge satt. Uten den kan ingen samtale si hva som skal vike — bare at begge
				deler er viktige.
			</p>
		{/if}

		<div class="handlinger">
			<button class="btn-secondary" data-track="retning:rediger-rekkefolge" onclick={start}>
				{ranking ? '✏️ Endre rekkefølgen' : '➕ Sett rekkefølgen'}
			</button>
		</div>
	{:else}
		<div class="skjema">
			{#if utkast.length > 0}
				<ol class="liste">
					{#each utkast as rad, i (i)}
						<li class="rad">
							<span class="plass">{i + 1}</span>
							<span class="innhold">
								<span class="tittel">{rad.label}</span>
								{#if rad.why}<span class="grunn">{rad.why}</span>{/if}
							</span>
							<span class="knapper">
								<button
									class="ikon"
									aria-label="Flytt {rad.label} opp"
									disabled={i === 0}
									onclick={() => flytt(i, -1)}>↑</button
								>
								<button
									class="ikon"
									aria-label="Flytt {rad.label} ned"
									disabled={i === utkast.length - 1}
									onclick={() => flytt(i, 1)}>↓</button
								>
								<button class="ikon" aria-label="Fjern {rad.label}" onclick={() => fjern(i)}>✕</button>
							</span>
						</li>
					{/each}
				</ol>
			{/if}

			{#if utkast.length < MAX_PRIORITIES}
				<label>
					<span>Hva kommer (også) først?</span>
					<input
						type="text"
						data-track="retning:rekkefolge-ny"
						bind:value={nyLabel}
						placeholder="F.eks. «Helse» eller «Én ting med hvert barn i måneden»"
					/>
				</label>
				<label>
					<span>Hvorfor der?</span>
					<input
						type="text"
						data-track="retning:rekkefolge-begrunnelse"
						bind:value={nyWhy}
						placeholder="Kort — én setning"
					/>
				</label>
				<div class="handlinger">
					<button class="btn-secondary" disabled={!nyLabel.trim()} onclick={leggTil}>Legg til</button>
				</div>
			{:else}
				<p class="hint">
					Maks {MAX_PRIORITIES}. En lengre liste er ingen rekkefølge — da er vi tilbake til
					livshjulet, bare på én linje.
				</p>
			{/if}

			{#if error}<p class="feil">{error}</p>{/if}

			<div class="handlinger">
				<button
					class="btn-complete"
					data-track="retning:rekkefolge-lagre"
					disabled={busy}
					onclick={() => void lagre()}>{busy ? 'Lagrer …' : 'Lagre rekkefølgen'}</button
				>
				<button class="btn-secondary" onclick={() => (editing = false)}>Avbryt</button>
			</div>
		</div>
	{/if}
</section>

<style>
	.rekkefolge {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 1.5rem 0 0;
	}

	.hint {
		margin: 0;
		color: var(--text-secondary);
		font-size: 0.875rem;
		line-height: 1.5;
	}

	.tom,
	.satt {
		margin: 0;
		color: var(--text-tertiary);
		font-size: 0.85rem;
	}

	.feil {
		margin: 0;
		color: var(--error-text);
		font-size: 0.85rem;
	}

	.liste {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.rad {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
		padding: 0.65rem 0.8rem;
		background: var(--card-bg-subtle);
		border: 1px solid var(--card-border);
		border-radius: var(--radius-lg);
	}

	/* Plassnummeret er posisjonen i lista, ikke et lagret tall. */
	.plass {
		flex: none;
		width: 1.4rem;
		height: 1.4rem;
		display: grid;
		place-items: center;
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--text-secondary);
		background: var(--card-bg);
		border: 1px solid var(--card-border);
		border-radius: 50%;
	}

	.innhold {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		flex: 1;
		min-width: 0;
	}

	.tittel {
		font-size: 0.92rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	.grunn {
		font-size: 0.82rem;
		line-height: 1.5;
		color: var(--text-tertiary);
	}

	.knapper {
		display: flex;
		gap: 0.2rem;
		flex: none;
	}

	.ikon {
		width: 1.9rem;
		height: 1.9rem;
		font-size: 0.9rem;
		color: var(--text-secondary);
		background: var(--card-bg);
		border: 1px solid var(--card-border);
		border-radius: var(--radius-md);
		cursor: pointer;
	}

	.ikon:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.handlinger {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.handlinger button:disabled {
		opacity: 0.55;
		cursor: default;
	}

	.skjema {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		padding: 0.85rem;
		background: var(--card-bg-subtle);
		border: 1px solid var(--card-border);
		border-radius: var(--radius-lg);
	}

	.skjema label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.skjema label span {
		font-size: 0.78rem;
		color: var(--text-secondary);
	}

	.skjema input {
		width: 100%;
		box-sizing: border-box;
		padding: 0.45rem 0.6rem;
		font: inherit;
		font-size: 0.85rem;
		color: var(--text-primary);
		background: var(--card-bg);
		border: 1px solid var(--card-border);
		border-radius: var(--radius-md);
	}
</style>
