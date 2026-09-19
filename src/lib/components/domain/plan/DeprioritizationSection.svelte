<!--
  DeprioritizationSection — bevisste nedprioriteringer på Retning-fanen.

  Hvorfor den står her og ikke på livskompasset: hjulet er UKENTLIG og måler
  samsvaret i uka som gikk. En nedprioritering er en beslutning som spenner over
  måneder, og den hører derfor i Retningen — sammen med prosaen, målene og
  milepælene. Hjulet LESER den (et valgt gap flagges ikke som avvik), men den
  settes her.

  Se docs/changelog/2026-09-19-retningen-som-baerer-prioriteringer.md
-->
<script lang="ts">
	import { LIVSKOMPASS_DIMENSIONS } from '$lib/domains/livskompass/dimensions';
	import type { ResolvedDeprioritization } from '$lib/domains/livskompass/deprioritization';

	interface Props {
		periods: ResolvedDeprioritization[];
		onchanged: () => Promise<void> | void;
	}

	let { periods, onchanged }: Props = $props();

	let formOpen = $state(false);
	let busy = $state<string | null>(null);
	let error = $state<string | null>(null);

	let dimensionId = $state(LIVSKOMPASS_DIMENSIONS[0]?.id ?? '');
	let weeks = $state(12);
	let reason = $state('');
	let repair = $state('');

	const active = $derived(periods.filter((p) => p.activeToday));
	const unsettled = $derived(periods.filter((p) => p.needsSettlement));
	const settled = $derived(periods.filter((p) => p.settled));

	const today = new Date();
	function isoDay(d: Date): string {
		return d.toISOString().slice(0, 10);
	}
	// Terminen vises som en DATO, ikke bare som «12 uker»: det er datoen som
	// møter deg i oppgjøret, og den skal være synlig når du velger den.
	const endDate = $derived(isoDay(new Date(today.getTime() + weeks * 7 * 86_400_000)));

	async function send(body: unknown, method: 'POST' | 'PATCH', key: string) {
		busy = key;
		error = null;
		try {
			const res = await fetch('/api/livskompass/nedprioritering', {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			const result = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(result.error || 'Lagring feilet');
			await onchanged();
			return true;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Ukjent feil';
			return false;
		} finally {
			busy = null;
		}
	}

	async function create() {
		const ok = await send(
			{ dimensionId, startDate: isoDay(today), endDate, reason, repair },
			'POST',
			'ny'
		);
		if (ok) {
			formOpen = false;
			reason = '';
			repair = '';
		}
	}

	const settle = (id: string, outcome: 'repaired' | 'drifted') =>
		send({ id, action: 'settle', outcome }, 'PATCH', id);
	const confirm = (id: string) => send({ id, action: 'confirm' }, 'PATCH', id);
	const extend = (p: ResolvedDeprioritization) =>
		send(
			{ id: p.id, action: 'extend', endDate: isoDay(new Date(today.getTime() + 84 * 86_400_000)) },
			'PATCH',
			p.id
		);
</script>

<section class="prioriteringer">
	<h2>⚖️ Prioriteringer</h2>
	<p class="hint">
		Det du har valgt å nedprioritere en periode — med en grunn og en sluttdato. Livskompasset
		flagger det ikke som avvik så lenge terminen løper.
	</p>

	{#if unsettled.length > 0}
		<ul class="liste">
			{#each unsettled as p (p.id)}
				<li class="rad utlopt">
					<span class="tittel">{p.label}</span>
					<span class="setning">Terminen gikk ut {p.endDate}. Hva ble det?</span>
					<span class="grunn">Grunn: {p.reason}</span>
					{#if p.repair}<span class="grunn">Plan: {p.repair}</span>{/if}
					<div class="handlinger">
						<button
							class="btn-complete"
							data-track="retning:nedprioritering-hentet-opp"
							disabled={busy === p.id}
							onclick={() => settle(p.id, 'repaired')}>Hentet opp igjen</button
						>
						<button
							class="btn-secondary"
							data-track="retning:nedprioritering-forleng"
							disabled={busy === p.id}
							onclick={() => extend(p)}>Forleng 12 uker</button
						>
						<!--
						  «Det var drift» er utfallet som gjør de to andre troverdige: uten det
						  kan en forlengelse gjentas i det uendelige og fortsatt kalles et valg.
						-->
						<button
							class="btn-secondary"
							data-track="retning:nedprioritering-drift"
							disabled={busy === p.id}
							onclick={() => settle(p.id, 'drifted')}>Det var drift</button
						>
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	{#if active.length > 0}
		<ul class="liste">
			{#each active as p (p.id)}
				<li class="rad">
					<span class="tittel">{p.label}</span>
					<span class="setning">Uke {p.weekOfTerm} av {p.weeksInTerm} — ut {p.endDate}</span>
					<span class="grunn">Grunn: {p.reason}</span>
					{#if p.repair}<span class="grunn">Plan: {p.repair}</span>{/if}
					<!--
					  «Hent den opp igjen» står ALLTID, ikke bare når vi spør. En beslutning
					  man ikke kan omgjøre før terminen er ute, er ikke et valg man eier —
					  og et kort uten utgang er nøyaktig feilen sykeperiodene gikk i, der
					  den ene handlingen som ble tilbudt var den man ikke skulle bruke.
					-->
					<div class="handlinger">
						{#if p.needsCheckIn}
							<span class="varsel">Står den fortsatt?</span>
							<button
								class="btn-secondary"
								data-track="retning:nedprioritering-bekreft"
								disabled={busy === p.id}
								onclick={() => confirm(p.id)}>Ja, den gjelder</button
							>
						{/if}
						<button
							class="btn-secondary"
							data-track="retning:nedprioritering-avslutt"
							disabled={busy === p.id}
							onclick={() => settle(p.id, 'repaired')}>Hent den opp igjen</button
						>
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	{#if active.length === 0 && unsettled.length === 0}
		<p class="tom">Ingenting er bevisst nedprioritert nå.</p>
	{/if}

	{#if error}<p class="feil">{error}</p>{/if}

	{#if formOpen}
		<div class="skjema">
			<label>
				<span>Hva nedprioriteres?</span>
				<select data-track="retning:nedprioritering-dimensjon" bind:value={dimensionId}>
					{#each LIVSKOMPASS_DIMENSIONS as dim (dim.id)}
						<option value={dim.id}>{dim.label}</option>
					{/each}
				</select>
			</label>

			<label>
				<span>Hvor lenge? Til {endDate}</span>
				<select data-track="retning:nedprioritering-lengde" bind:value={weeks}>
					<option value={6}>6 uker</option>
					<option value={12}>12 uker</option>
					<option value={26}>26 uker</option>
					<option value={52}>52 uker</option>
				</select>
			</label>

			<label>
				<span>Hvorfor?</span>
				<textarea
					data-track="retning:nedprioritering-grunn"
					bind:value={reason}
					rows="2"
					placeholder="F.eks. «gir plass til de første månedene i ny jobb»"
				></textarea>
			</label>

			<label>
				<span>Hvordan repareres det etterpå?</span>
				<textarea
					data-track="retning:nedprioritering-reparasjon"
					bind:value={repair}
					rows="2"
					placeholder="F.eks. «to konserter i november, avtalt hjemme»"
				></textarea>
			</label>

			<p class="hint">
				Sluttdatoen er ikke valgfri. Uten en termin er det drift med en forklaring foran — og da
				kan ingen si i ettertid om det var et valg.
			</p>

			<div class="handlinger">
				<button
					class="btn-complete"
					data-track="retning:nedprioritering-lagre"
					disabled={busy === 'ny'}
					onclick={() => void create()}>{busy === 'ny' ? 'Lagrer …' : 'Lagre'}</button
				>
				<button class="btn-secondary" onclick={() => (formOpen = false)}>Avbryt</button>
			</div>
		</div>
	{:else}
		<button
			class="btn-secondary"
			data-track="retning:ny-nedprioritering"
			onclick={() => {
				formOpen = true;
				error = null;
			}}>➕ Nedprioriter noe bevisst</button
		>
	{/if}

	{#if settled.length > 0}
		<details class="tidligere">
			<summary>Tidligere ({settled.length})</summary>
			<ul class="liste">
				{#each settled as p (p.id)}
					<li class="rad ferdig">
						<span class="tittel">{p.label}</span>
						<span class="setning">
							{p.startDate}–{p.endDate} ·
							{p.outcome === 'repaired' ? 'hentet opp igjen' : 'endte som drift'}
						</span>
					</li>
				{/each}
			</ul>
		</details>
	{/if}
</section>

<style>
	.prioriteringer {
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

	.tom {
		margin: 0;
		color: var(--text-tertiary);
		font-size: 0.875rem;
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
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.65rem 0.8rem;
		background: var(--card-bg-subtle);
		border: 1px solid var(--card-border);
		border-radius: var(--radius-lg);
	}

	/* En utløpt termin er det eneste her som ber om noe. */
	.rad.utlopt {
		border-color: var(--warning-border, var(--card-border));
		background: var(--warning-bg, var(--card-bg-subtle));
	}

	.rad.ferdig {
		opacity: 0.7;
	}

	.tittel {
		font-size: 0.92rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	.setning {
		font-size: 0.84rem;
		color: var(--text-secondary);
	}

	.grunn {
		font-size: 0.82rem;
		line-height: 1.5;
		color: var(--text-tertiary);
	}

	.varsel {
		font-size: 0.82rem;
		color: var(--text-secondary);
		align-self: center;
	}

	.handlinger {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: 0.4rem;
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

	.skjema select,
	.skjema textarea {
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

	.skjema textarea {
		resize: vertical;
	}

	.tidligere summary {
		font-size: 0.85rem;
		color: var(--text-secondary);
		cursor: pointer;
	}
</style>
