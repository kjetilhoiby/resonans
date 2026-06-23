<!--
  TripDiary — reisedagbok per dag for et reise-tema.

  Hver dag i turvinduet får et notat. Stedet auto-seedes fra geo-konteksten turen
  har akkumulert (tripProfile.geoByDay): en observert kjøretur gir presist sted,
  en deklarert dagsoppgave grovere. Brukeren skriver inn HVA som skjedde; HVOR er
  allerede fylt. Gjenbruker det tema-agnostiske dagbok-endepunktet via tripApi.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import SectionLabel from '../ui/SectionLabel.svelte';
	import DiaryImages from './DiaryImages.svelte';
	import { tripApi, type TripApi, type DiaryEntry, type DayGeo } from './trip-api';

	interface Props {
		themeId: string;
		startDate: string;
		endDate: string;
		geoByDay?: Record<string, DayGeo>;
		api?: TripApi;
	}

	let { themeId, startDate, endDate, geoByDay = {}, api = tripApi }: Props = $props();

	let entries = $state<DiaryEntry[]>([]);
	let loading = $state(true);
	let drafts = $state<Record<string, { place: string; content: string; images: string[] }>>({});
	let savingDay = $state<string | null>(null);

	function enumerateDays(from: string, to: string): string[] {
		const out: string[] = [];
		const d = new Date(`${from}T00:00:00Z`);
		const end = new Date(`${to}T00:00:00Z`);
		if (Number.isNaN(d.getTime()) || Number.isNaN(end.getTime())) return out;
		// Sikkerhetsnett mot urimelige vinduer.
		let guard = 0;
		while (d <= end && guard++ < 400) {
			out.push(d.toISOString().slice(0, 10));
			d.setUTCDate(d.getUTCDate() + 1);
		}
		return out;
	}

	const days = $derived(enumerateDays(startDate, endDate));

	function entryFor(date: string): DiaryEntry | undefined {
		return entries.find((e) => e.date === date);
	}

	// Bygg utkast for hver dag: bruk lagret notat hvis det finnes, ellers seed
	// stedet fra geo-konteksten. Beholder eksisterende utkast (uskrevne endringer).
	function buildDrafts() {
		const next = { ...drafts };
		for (const date of days) {
			if (next[date]) continue;
			const e = entryFor(date);
			next[date] = {
				place: e?.place ?? geoByDay[date]?.place ?? '',
				content: e?.content ?? '',
				images: e?.images ?? []
			};
		}
		drafts = next;
	}

	// Kilde-merke når stedet kommer fra sporing og ikke et manuelt dagboknotat.
	function geoBadge(date: string): { label: string; title: string } | null {
		if (entryFor(date)?.place) return null; // bruker har skrevet sitt eget sted
		const g = geoByDay[date];
		if (!g?.place) return null;
		if (g.source === 'observed') return { label: '📍 spored', title: 'Fra registrert kjøretur' };
		if (g.source === 'declared') return { label: '🗓 planlagt', title: 'Fra dagsoppgave' };
		return { label: '🏨 overnatting', title: 'Fra overnatting' };
	}

	onMount(async () => {
		const loaded = await api.getDiary(themeId);
		if (loaded) entries = loaded;
		loading = false;
		buildDrafts();
	});

	async function saveDay(date: string) {
		const d = drafts[date];
		if (!d) return;
		const content = d.content.trim();
		const place = d.place.trim();
		const images = d.images ?? [];
		const existing = entryFor(date);
		// Ingen endring verdt å lagre, og ingenting fra før → hopp over.
		if (!content && !place && images.length === 0 && !existing) return;

		savingDay = date;
		const ok = await api.putDiaryEntry(themeId, {
			date,
			content,
			place: place || undefined,
			weather: existing?.weather,
			images
		});
		if (ok) {
			const others = entries.filter((e) => e.date !== date);
			entries =
				content || place || images.length > 0
					? [
							...others,
							{
								date,
								content,
								place: place || undefined,
								weather: existing?.weather,
								images: images.length > 0 ? images : undefined
							}
						]
					: others;
		}
		savingDay = null;
	}

	function fmtDay(iso: string): string {
		const d = new Date(`${iso}T00:00:00`);
		return d.toLocaleDateString('nb', { weekday: 'short', day: 'numeric', month: 'short' });
	}
</script>

<div class="trip-diary">
	<SectionLabel>📔 Reisedagbok</SectionLabel>

	{#if loading}
		<p class="diary-empty">Laster dagbok …</p>
	{:else}
		{#each days as date (date)}
			{@const badge = geoBadge(date)}
			{@const weather = entryFor(date)?.weather}
			<div class="diary-day">
				<div class="diary-day-head">
					<span class="diary-date">{fmtDay(date)}</span>
					{#if weather?.emoji}
						<span class="diary-weather">{weather.emoji}{weather.temp != null ? ` ${Math.round(weather.temp)}°` : ''}</span>
					{/if}
					{#if savingDay === date}
						<span class="diary-saving">lagrer …</span>
					{/if}
				</div>
				<div class="diary-place-row">
					<input
						class="diary-place"
						type="text"
						placeholder="Sted"
						bind:value={drafts[date].place}
						onblur={() => saveDay(date)}
						data-track="reise-dagbok:sted"
					/>
					{#if badge}
						<span class="diary-badge" title={badge.title}>{badge.label}</span>
					{/if}
				</div>
				<textarea
					class="diary-text"
					rows="2"
					placeholder="Hva skjedde i dag?"
					bind:value={drafts[date].content}
					onblur={() => saveDay(date)}
					data-track="reise-dagbok:notat"
				></textarea>
				<div class="diary-images-row">
					<DiaryImages
						bind:images={drafts[date].images}
						onChange={() => saveDay(date)}
						track="reise-dagbok"
					/>
				</div>
			</div>
		{/each}
	{/if}
</div>

<style>
	.trip-diary {
		margin-top: 1.5rem;
	}

	.diary-empty {
		color: var(--tp-text-muted);
		font-size: 0.9rem;
		margin: 0.5rem 0;
	}

	.diary-day {
		border: 1px solid var(--tp-border);
		border-radius: 12px;
		background: var(--tp-bg-2);
		padding: 0.75rem 0.85rem;
		margin-bottom: 0.6rem;
	}

	.diary-day-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.45rem;
	}

	.diary-date {
		font-weight: 600;
		color: var(--tp-text);
		text-transform: capitalize;
		font-size: 0.92rem;
	}

	.diary-weather {
		color: var(--tp-text-soft);
		font-size: 0.85rem;
	}

	.diary-saving {
		margin-left: auto;
		color: var(--tp-text-muted);
		font-size: 0.78rem;
		font-style: italic;
	}

	.diary-place-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.4rem;
	}

	.diary-place {
		flex: 1;
		min-width: 0;
		background: transparent;
		border: none;
		border-bottom: 1px dashed var(--tp-border-strong);
		color: var(--tp-text);
		font-size: 0.9rem;
		padding: 0.2rem 0;
	}

	.diary-place:focus {
		outline: none;
		border-bottom-color: var(--tp-accent);
	}

	.diary-badge {
		flex-shrink: 0;
		font-size: 0.72rem;
		color: var(--tp-accent);
		background: var(--tp-accent-bg);
		border-radius: 999px;
		padding: 0.1rem 0.5rem;
		white-space: nowrap;
	}

	.diary-text {
		width: 100%;
		box-sizing: border-box;
		background: transparent;
		border: 1px solid var(--tp-border);
		border-radius: 8px;
		color: var(--tp-text);
		font: inherit;
		font-size: 0.9rem;
		padding: 0.45rem 0.55rem;
		resize: vertical;
	}

	.diary-text:focus {
		outline: none;
		border-color: var(--tp-accent);
	}

	.diary-images-row {
		margin-top: 0.5rem;
	}
</style>
