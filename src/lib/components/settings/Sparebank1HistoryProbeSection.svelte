<!--
  Sparebank1HistoryProbeSection — hvor langt tilbake gir banken oss data?

  Spørsmålet er ikke akademisk. Svaret avgjør om `canonical_bank_transactions`
  er data som kan hentes inn igjen, eller data som er borte for alltid hvis vi
  mister den. Se `docs/changelog/2026-08-21-datakartlegging-for-flytting.md`.

  Knappen fantes bare som et URL-kall (`/api/sensors/sparebank1/probe`) fram til
  august 2026. Et diagnoseverktøy man må lime inn en URL for å bruke, er et
  verktøy man bruker én gang og glemmer.

  To valg verdt å kjenne:

  - **Kontoene spørres etter tur, ikke parallelt.** `sparebank1-sync.ts` gjør
    det samme, med kommentaren «to avoid hitting rate limits». En probe som
    fyrer fire samtidige kall for å måle grensene ville vært en fin måte å
    treffe dem.
  - **Feil vises.** Kortet ved siden av gjør `if (res.ok)` uten else, og et
    401 fra utløpt tilsagn blir da en knapp som ikke gjør noe. Vi bruker
    `extractApiErrorMessage` og skriver hva som skjedde.
-->
<script lang="ts">
	import { Button } from '$lib/components/ui';
	import { extractApiErrorMessage } from '$lib/client/api-error';
	import {
		konkluder,
		vurderKonto,
		type Konklusjon,
		type KontoVurdering
	} from '$lib/domain/economics/history-probe';

	type Konto = { key: string; name?: string | null; type?: string | null };

	let laster = $state(false);
	let framdrift = $state<string | null>(null);
	let feil = $state<string | null>(null);
	let vurderinger = $state<KontoVurdering[]>([]);
	let konklusjon = $state<Konklusjon | null>(null);
	let rateLimit = $state<Record<string, string>>({});

	async function hent<T>(url: string): Promise<T> {
		const res = await fetch(url);
		if (!res.ok) throw new Error(extractApiErrorMessage(res.status, await res.text()));
		return (await res.json()) as T;
	}

	async function kjørProbe() {
		laster = true;
		feil = null;
		vurderinger = [];
		konklusjon = null;
		rateLimit = {};
		framdrift = 'Henter kontoliste …';

		try {
			const liste = await hent<{ accounts: Konto[]; rateLimitHeaders?: Record<string, string> }>(
				'/api/sensors/sparebank1/probe'
			);
			rateLimit = { ...rateLimit, ...(liste.rateLimitHeaders ?? {}) };

			const kontoer = (liste.accounts ?? []).filter((k) => k.key);
			if (kontoer.length === 0) {
				feil = 'Banken returnerte ingen kontoer. Er tilsagnet fortsatt gyldig?';
				return;
			}

			const samlet: KontoVurdering[] = [];
			for (const [i, konto] of kontoer.entries()) {
				framdrift = `Sjekker konto ${i + 1} av ${kontoer.length} …`;
				const svar = await hent<{
					count: number;
					oldestDate: string | null;
					newestDate: string | null;
					likelyCapped?: boolean;
					rateLimitHeaders?: Record<string, string>;
				}>(`/api/sensors/sparebank1/probe?accountKey=${encodeURIComponent(konto.key)}`);
				rateLimit = { ...rateLimit, ...(svar.rateLimitHeaders ?? {}) };
				samlet.push(
					vurderKonto({
						accountKey: konto.key,
						name: konto.name ?? konto.type ?? null,
						count: svar.count,
						oldestDate: svar.oldestDate,
						newestDate: svar.newestDate,
						likelyCapped: svar.likelyCapped
					})
				);
				// Vis resultatet fortløpende: fire kontoer tar noen sekunder, og en
				// tabell som fylles er bedre enn en spinner som ikke sier noe.
				vurderinger = [...samlet];
			}

			konklusjon = konkluder(samlet);
		} catch (error) {
			feil = error instanceof Error ? error.message : 'Ukjent feil';
		} finally {
			laster = false;
			framdrift = null;
		}
	}

	const ORD: Record<KontoVurdering['verdikt'], string> = {
		'ingen-data': 'ingen data',
		kappet: 'kappet – gulv, ikke sannhet',
		'kort-historikk': 'kort historikk',
		'lang-historikk': 'lang historikk'
	};

	/**
	 * En konto som starter på det delte gulvet er ikke «kort historikk» — den er
	 * kuttet av bankens vindu. Ordet må si hvilken av de to det er, ellers leser
	 * man 24 måneder som om kontoen var ny.
	 */
	function ord(v: KontoVurdering): string {
		if (konklusjon?.fellesGulv && v.oldestDate === konklusjon.fellesGulv) {
			return 'ved vindusgrensa';
		}
		return ORD[v.verdikt];
	}

	function måneder(dager: number | null): string {
		if (dager === null) return '–';
		if (dager < 60) return `${dager} d`;
		return `${Math.round(dager / 30)} mnd`;
	}
</script>

<div class="probe-section">
	<p class="hvorfor">
		Hvor langt tilbake gir banken oss transaksjoner i ett kall? Svaret avgjør om
		bankhistorikken kan hentes inn igjen, eller om den bare finnes hos oss.
	</p>

	<div class="row">
		<Button variant="ghost" onClick={kjørProbe} disabled={laster}>
			{laster ? (framdrift ?? 'Sjekker …') : 'Sjekk hvor langt tilbake banken gir oss data'}
		</Button>
	</div>

	{#if feil}
		<p class="feil">{feil}</p>
	{/if}

	{#if vurderinger.length > 0}
		<table class="probe-table">
			<thead>
				<tr>
					<th>Konto</th>
					<th>Rader</th>
					<th>Eldste</th>
					<th>Nyeste</th>
					<th>Spenn</th>
					<th>Vurdering</th>
				</tr>
			</thead>
			<tbody>
				{#each vurderinger as v (v.accountKey)}
					<tr>
						<td>{v.name ?? String(v.accountKey).slice(0, 10) + '…'}</td>
						<td>{v.count}</td>
						<td>{v.oldestDate ?? '–'}</td>
						<td>{v.newestDate ?? '–'}</td>
						<td>{måneder(v.spennDager)}</td>
						<td class:advarsel={v.muligKappet || v.oldestDate === konklusjon?.fellesGulv}>{ord(v)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}

	{#if konklusjon}
		<p
			class="konklusjon"
			class:ja={konklusjon.kanHentesIgjen === true}
			class:nei={konklusjon.kanHentesIgjen === false}
		>
			{konklusjon.begrunnelse}
		</p>
	{/if}

	{#if Object.keys(rateLimit).length > 0}
		<details>
			<summary>Rate-limit-headere banken sendte</summary>
			<ul class="headere">
				{#each Object.entries(rateLimit) as [navn, verdi] (navn)}
					<li><span class="mono">{navn}</span>: {verdi}</li>
				{/each}
			</ul>
		</details>
	{:else if vurderinger.length > 0}
		<p class="meta">
			Banken sendte ingen rate-limit-headere. Da vet vi ikke hvor grensa går, bare at vi
			ikke traff den.
		</p>
	{/if}
</div>

<style>
	.probe-section {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 0.75rem;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		background: var(--bg-primary);
	}
	.hvorfor { margin: 0; font-size: 0.84rem; color: var(--text-secondary); }
	.row { display: flex; gap: 0.6rem; flex-wrap: wrap; }
	.meta { color: var(--text-tertiary); font-size: 0.8rem; margin: 0; }
	.feil {
		margin: 0;
		font-size: 0.84rem;
		color: #e0928c;
		border: 1px solid color-mix(in srgb, #e0928c 35%, transparent);
		background: color-mix(in srgb, #e0928c 10%, transparent);
		border-radius: var(--radius-md);
		padding: 0.5rem 0.65rem;
	}
	.probe-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; color: var(--text-secondary); }
	.probe-table th, .probe-table td {
		padding: 0.34rem 0.45rem;
		text-align: left;
		border-bottom: 1px solid var(--border-color);
		white-space: nowrap;
	}
	.probe-table th { color: var(--text-tertiary); font-weight: 500; }
	td.advarsel { color: #d9a95c; }
	.konklusjon {
		margin: 0;
		font-size: 0.86rem;
		line-height: 1.45;
		padding: 0.55rem 0.7rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--border-color);
		color: var(--text-secondary);
	}
	.konklusjon.ja { border-color: color-mix(in srgb, #6ee76e 40%, transparent); }
	.konklusjon.nei { border-color: color-mix(in srgb, #d9a95c 45%, transparent); }
	.headere { margin: 0.4rem 0 0; padding-left: 1.1rem; font-size: 0.8rem; color: var(--text-secondary); }
	.mono { font-family: monospace; }
	summary { font-size: 0.82rem; color: var(--text-tertiary); cursor: pointer; }
</style>
