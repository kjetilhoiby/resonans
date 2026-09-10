<script lang="ts">
	/**
	 * Sykdomsforløpet som ÉN flate.
	 *
	 * Alle radene deler x-akse — samme begrunnelse som at livvidde tegnes inni
	 * `WeightTrendChart`: «vekta stupte samtidig som sovepulsen steg» kan bare
	 * leses når samme dato ligger på samme piksel. Derfor kommer `days` fra
	 * vinduet og sendes ned i hver rad, framfor at hver rad regner sin egen.
	 *
	 * Y-aksene er derimot SEPARATE, og det er ikke en forglemmelse: kg, slag/min
	 * og timer har ingen felles skala. Samme lærdom som vekt mot energi.
	 */
	import SectionLabel from '$lib/components/ui/SectionLabel.svelte';
	import SickEpisodeTrack from './SickEpisodeTrack.svelte';
	import { BASELINE_DAYS, type SickEpisode } from '$lib/domain/health/sick-episode';

	interface Props {
		episode: SickEpisode;
	}

	let { episode }: Props = $props();

	const days = $derived(episode.window.days);
	const weightTrack = $derived(episode.tracks.find((t) => t.id === 'weight') ?? null);

	const pct = (index: number) =>
		days.length <= 1 ? 0 : (index / (days.length - 1)) * 100;

	const SEVERITY_OPACITY = { litt: 0.35, merkbart: 0.62, mye: 0.9 } as const;

	const MONTHS = [
		'jan',
		'feb',
		'mar',
		'apr',
		'mai',
		'jun',
		'jul',
		'aug',
		'sep',
		'okt',
		'nov',
		'des'
	];
	function shortDay(dayKey: string): string {
		const [, m, d] = dayKey.split('-');
		return `${Number(d)}. ${MONTHS[Number(m) - 1] ?? ''}`;
	}
</script>

<div class="forlop">
	<header class="topp">
		<p class="overskrift">{episode.headline}</p>
		{#if episode.levelText}
			<p class="niva">{episode.levelText}</p>
		{/if}
	</header>

	{#if episode.relapse}
		<!--
			Tilbakefallet står for seg fordi det er formen på forløpet, ikke en
			måling: nivået steg og falt igjen. Ingen dom, ingen forklaring — bare
			at det skjedde, og når.
		-->
		<p class="tilbakefall">
			Du meldte deg bedre {shortDay(episode.relapse.peakDay)} ({episode.relapse.peakLevel} av 5)
			og dårligere igjen {shortDay(episode.relapse.troughDay)} ({episode.relapse.troughLevel}).
		</p>
	{/if}

	<section class="blokk">
		<SectionLabel>Signaler gjennom forløpet</SectionLabel>

		{#if episode.tracks.length === 0}
			<p class="tomt">
				Ingen målinger i dette vinduet. Vekt, puls, søvn og temperatur hentes fra kildene du
				har koblet — er ingen av dem koblet, har forløpet bare symptomene dine.
			</p>
		{:else}
			<!-- Datoaksen står ÉN gang, øverst: den gjelder alle radene under. -->
			<div class="akse">
				<span>{shortDay(days[0].day)}</span>
				<span class="onset" style="left: {pct(episode.window.onsetIndex)}%">
					dag 1
				</span>
				<span>{shortDay(days[days.length - 1].day)}</span>
			</div>

			<!--
				Tegnforklaringen står ÉN gang, som datoaksen: linjene betyr det
				samme i hver rad. Per rad ville den samme setningen stått åtte
				ganger og druknet setningene som faktisk sier noe.
			-->
			<p class="tegnforklaring">
				<span class="prove prove-for"></span> median de {BASELINE_DAYS} dagene før
				<span class="prove prove-under"></span> median under forløpet
			</p>

			<div class="rader">
				{#each episode.tracks as track (track.id)}
					<SickEpisodeTrack
						{track}
						{days}
						onsetIndex={episode.window.onsetIndex}
						endIndex={episode.window.endIndex}
					/>
				{/each}
			</div>

			{#if weightTrack}
				<p class="forbehold">{episode.weightCaveat}</p>
			{/if}
		{/if}
	</section>

	<section class="blokk">
		<SectionLabel>Symptomer</SectionLabel>

		{#if episode.symptoms.length === 0}
			<p class="tomt">Ingen symptomer registrert i dette vinduet.</p>
		{:else}
			<ul class="symptomer">
				{#each episode.symptoms as bar (bar.id)}
					<li>
						<div class="symptom-topp">
							<span class="symptom-navn">
								{bar.label}
								{#if bar.limiting}<span class="merke" title="Grunnen til at du sto over"
										>holdt deg ute</span
									>{/if}
							</span>
							<span class="symptom-tekst">{bar.text}</span>
						</div>
						<div class="spor">
							<!--
								Avkortingen merkes i begge ender framfor å flyttes: et ømt kne som
								startet i juli skal ikke se ut som om det begynte med infeksjonen.
							-->
							<div
								class="bjelke"
								class:apen-start={bar.startsBefore}
								class:apen-slutt={bar.endsAfter}
								style="left: {pct(bar.fromIndex)}%; width: {Math.max(
									1.5,
									pct(bar.toIndex) - pct(bar.fromIndex)
								)}%; opacity: {SEVERITY_OPACITY[bar.severity]}"
							></div>
						</div>
					</li>
				{/each}
			</ul>
			<p class="fot">
				Bredden er dagene symptomet varte, styrken er hvor mye. Symptomer som startet før
				vinduet eller varer ut over det, er merket med en åpen kant.
			</p>
		{/if}
	</section>

	<p class="ansvar">
		Loggen beskriver, den vurderer ikke. Ingen av tallene her er en diagnose eller et
		grunnlag for en.
	</p>
</div>

<style>
	.forlop {
		display: flex;
		flex-direction: column;
		gap: 22px;
	}

	.topp {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.overskrift {
		margin: 0;
		font-size: 16px;
		font-weight: 600;
		color: var(--text-primary);
	}

	.niva {
		margin: 0;
		font-size: 14px;
		line-height: 1.5;
		color: var(--text-secondary);
	}

	.tilbakefall {
		margin: 0;
		padding: 12px 14px;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		background: var(--bg-card);
		font-size: 14px;
		line-height: 1.5;
		color: var(--text-primary);
	}

	.blokk {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.akse {
		position: relative;
		display: flex;
		justify-content: space-between;
		font-size: 11px;
		color: var(--text-muted);
	}

	.onset {
		position: absolute;
		transform: translateX(-50%);
		color: var(--text-tertiary);
	}

	.tegnforklaring {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 14px;
		margin: 2px 0 0;
		font-size: 11px;
		color: var(--text-muted);
	}

	.prove {
		display: inline-block;
		width: 18px;
		height: 0;
		margin-right: 2px;
		vertical-align: middle;
	}

	.prove-for {
		border-top: 1px dashed var(--text-muted);
	}

	.prove-under {
		border-top: 2px solid var(--text-secondary);
	}

	.rader {
		display: flex;
		flex-direction: column;
	}

	.forbehold {
		margin: 10px 0 0;
		font-size: 12px;
		line-height: 1.5;
		color: var(--text-tertiary);
	}

	.symptomer {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.symptom-topp {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px 10px;
	}

	.symptom-navn {
		font-size: 14px;
		font-weight: 600;
		color: var(--text-primary);
	}

	.merke {
		margin-left: 6px;
		padding: 1px 6px;
		border-radius: 999px;
		background: var(--info-bg);
		border: 1px solid var(--info-border);
		font-size: 10px;
		font-weight: 500;
		color: var(--accent-light);
	}

	.symptom-tekst {
		font-size: 12px;
		color: var(--text-tertiary);
	}

	.spor {
		position: relative;
		height: 10px;
		margin-top: 6px;
		border-radius: 5px;
		background: var(--bg-elevated);
	}

	.bjelke {
		position: absolute;
		top: 0;
		height: 10px;
		border-radius: 5px;
		background: var(--accent-muted);
	}

	/* Åpen kant = symptomet fortsetter utenfor vinduet. */
	.bjelke.apen-start {
		border-top-left-radius: 0;
		border-bottom-left-radius: 0;
		border-left: 2px dashed var(--accent-light);
	}

	.bjelke.apen-slutt {
		border-top-right-radius: 0;
		border-bottom-right-radius: 0;
		border-right: 2px dashed var(--accent-light);
	}

	.tomt,
	.fot {
		margin: 0;
		font-size: 12px;
		line-height: 1.5;
		color: var(--text-tertiary);
	}

	.ansvar {
		margin: 0;
		padding-top: 14px;
		border-top: 1px solid var(--border-subtle);
		font-size: 11px;
		line-height: 1.5;
		color: var(--text-muted);
	}
</style>
