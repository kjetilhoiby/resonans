<script lang="ts">
	import { onMount } from 'svelte';
	import PeriodPills from '../ui/PeriodPills.svelte';
	import DynamicWidget from '../composed/DynamicWidget.svelte';
	import HealthMetricGrid from './health/HealthMetricGrid.svelte';
	import HealthProgramCard from './health/HealthProgramCard.svelte';
	import HealthSubthemeStrip from './health/HealthSubthemeStrip.svelte';
	import HealthSignalSection from './health/HealthSignalSection.svelte';
	import SickStatusCard from './health/SickStatusCard.svelte';
	import type { SubthemeTile } from '$lib/domain/health/subtheme-tiles';
	import type { PresentedSignal } from '$lib/domain/health/signal-presentation';
	import {
		type WindowMode,
		type AggregatePeriod,
		type ThemeWidget,
		type ProgramSummary,
		type TodaySession,
		type SourceItem,
		buildQuarterData,
		formatDate
	} from './health/health-data';

	interface Props {
		weekly: AggregatePeriod[];
		monthly: AggregatePeriod[];
		yearly: AggregatePeriod[];
		sources?: SourceItem[];
		themeId?: string;
		/** Undertema-stripen. Kan mangle i en cachet payload fra før splitten. */
		subthemes?: SubthemeTile[];
		signals?: PresentedSignal[];
	}

	let {
		weekly,
		monthly,
		yearly,
		sources = [],
		themeId,
		subthemes = [],
		signals = []
	}: Props = $props();

	// Kryss-lenkene i signalkortene trenger id-ene undertema-stripen allerede har.
	const themeIdsByName = $derived(
		Object.fromEntries(
			subthemes.filter((t) => t.themeId).map((t) => [t.name, t.themeId as string])
		)
	);

	let activatingSubtheme = $state<string | null>(null);

	async function activateSubtheme(name: string) {
		activatingSubtheme = name;
		try {
			const res = await fetch('/api/helse/undertema/ensure', { method: 'POST' });
			if (res.ok) {
				const { invalidateHealthFamily } = await import('$lib/client/dashboard-cache');
				invalidateHealthFamily();
				const { invalidateAll } = await import('$app/navigation');
				await invalidateAll();
			}
		} catch {
			/* stille feil — flisen blir stående som «Aktiver» */
		} finally {
			activatingSubtheme = null;
		}
	}

	// ── Theme widgets ──────────────────────────────────────
	let themeWidgets = $state<ThemeWidget[]>([]);
	let themeWidgetsLoading = $state(true);

	// ── Program widget ─────────────────────────────────────
	let activeProgram = $state<ProgramSummary | null>(null);
	let todaySession = $state<TodaySession>(null);
	let programWidgetLoading = $state(true);

	onMount(async () => {
		try {
			const res = await fetch('/api/apps/programs');
			if (!res.ok) { programWidgetLoading = false; return; }
			const body = (await res.json()) as { programs?: ProgramSummary[] };
			const active = body.programs?.find((p) => p.status === 'active') ?? null;
			activeProgram = active;
			if (active) {
				const todayRes = await fetch(`/api/apps/programs/${active.id}/today`);
				if (todayRes.ok) {
					const todayBody = await todayRes.json();
					todaySession = todayBody.session ?? null;
				}
			}
		} catch {
			// Stille feil — widget skjules
		} finally {
			programWidgetLoading = false;
		}
	});

	// ── Period selection ───────────────────────────────────
	let selectedWindow = $state<WindowMode>('30d');

	const aggregatePeriod = $derived<'week' | 'month' | 'year'>(
		selectedWindow === '30d' || selectedWindow === 'month' || selectedWindow === 'quarter' ? 'month' :
		selectedWindow === '365d' || selectedWindow === 'year' ? 'year' :
		'week'
	);

	const widgetRange = $derived<string>(
		selectedWindow === '7d' ? 'last7'
		: selectedWindow === '30d' ? 'last30'
		: selectedWindow === '365d' ? 'last365'
		: selectedWindow === 'week' ? 'current_week'
		: selectedWindow === 'month' ? 'current_month'
		: selectedWindow === 'quarter' ? 'last90'
		: 'current_year'
	);

	const quarterData = $derived(buildQuarterData(monthly));

	const periodData = $derived(
		selectedWindow === 'quarter' ? quarterData :
		aggregatePeriod === 'week' ? weekly : aggregatePeriod === 'month' ? monthly : yearly
	);
	// Kildehelse hører på mor (den gjelder alle undertemaene), men en full liste
	// er ikke oversikt — én linje, med lenke videre til Kilder.
	const sourceSummary = $derived.by(() => {
		if (sources.length === 0) return 'Ingen helsekilder koblet.';
		const active = sources.filter((s) => s.isActive).length;
		const latest = sources
			.map((s) => s.lastSync)
			.filter((v): v is string => Boolean(v))
			.sort()
			.at(-1);
		const count = `${active} av ${sources.length} ${sources.length === 1 ? 'kilde' : 'kilder'} aktiv`;
		return latest ? `${count} · sist synket ${formatDate(latest)}` : count;
	});

	// ── Data loading ──────────────────────────────────────
	onMount(() => {
		void loadThemeWidgets();
	});

	async function loadThemeWidgets() {
		if (!themeId) { themeWidgetsLoading = false; return; }
		try {
			const res = await fetch(`/api/tema/${themeId}/widgets`);
			if (res.ok) themeWidgets = await res.json();
		} catch { /* stille feil */ } finally { themeWidgetsLoading = false; }
	}

	async function removeThemeWidget(id: string) {
		const previous = themeWidgets;
		themeWidgets = themeWidgets.filter((w) => w.id !== id);
		try {
			const res = await fetch(`/api/user-widgets/${id}`, { method: 'DELETE' });
			if (!res.ok && res.status !== 204) themeWidgets = previous;
		} catch { themeWidgets = previous; }
	}

</script>

<div class="health-dashboard hd-embedded">
	{#if subthemes.length > 0}
		<HealthSubthemeStrip
			tiles={subthemes}
			activating={activatingSubtheme}
			onActivate={(name) => void activateSubtheme(name)}
		/>
	{/if}

	<HealthSignalSection {signals} {themeIdsByName} parentThemeId={themeId ?? null} />

	<!-- Sykestatus står over programkortet, ikke under: er du syk, er det den
	     opplysningen som forklarer alt annet på flaten. Kortet henter sitt eget
	     data — én ekstra spørring bare når mortemaet er åpent, framfor å legge
	     den i sidelasteren for alle helseflatene. -->
	<SickStatusCard />

	<HealthProgramCard {activeProgram} {todaySession} loading={programWidgetLoading} />


	<div class="hd-pills" role="tablist" aria-label="Helseperioder">
		<PeriodPills
			options={['7d', '30d', '365d', 'Uke', 'Måned', 'Kvartal', 'År']}
			value={selectedWindow === '7d' ? '7d' : selectedWindow === '30d' ? '30d' : selectedWindow === '365d' ? '365d' : selectedWindow === 'week' ? 'Uke' : selectedWindow === 'month' ? 'Måned' : selectedWindow === 'quarter' ? 'Kvartal' : 'År'}
			onchange={(value) => {
				selectedWindow =
					value === '7d' ? '7d' :
					value === '30d' ? '30d' :
					value === '365d' ? '365d' :
					value === 'Uke' ? 'week' :
					value === 'Måned' ? 'month' :
					value === 'Kvartal' ? 'quarter' :
					'year';
			}}
		/>
	</div>

	<!-- Perioder er mortemaets hovedinnhold: det er her vekt, løp, effort, søvn
	     og puls står side om side i samme periode, og sammenhengene blir lesbare.
	     Lå kollapset i en <details> fram til august 2026 — form- og
	     belastningskortene tok plassen, og de bor nå på Trening. -->
	<!-- HealthMetricGrid setter sin egen SectionLabel, så ingen her. -->
	{#if periodData.length > 0}
		<HealthMetricGrid {periodData} {weekly} />
	{/if}

	{#if themeId}
		<div class="hd-widget-card">
			<div class="hd-widget-grid">
				{#if themeWidgetsLoading && themeWidgets.length === 0}
					{#each Array.from({ length: 4 }) as _}
						<div class="hd-widget-skeleton" aria-hidden="true"></div>
					{/each}
				{:else}
					{#each themeWidgets as widget (widget.id)}
						<DynamicWidget
							widgetId={widget.id}
							title={widget.title}
							unit={widget.unit}
							color={widget.color}
							pinned={widget.pinned}
							range={widgetRange}
							onunpin={() => removeThemeWidget(widget.id)}
						/>
					{/each}
				{/if}
			</div>
		</div>
	{/if}

	{#if periodData.length === 0}
		<div class="hd-empty">
			<p>Ingen data tilgjengelig ennå.</p>
			<p class="hd-empty-sub">Koble til eller synkroniser Withings for å fylle Helse-dashbordet.</p>
		</div>
	{:else}
		<p class="hd-sources-line">
			{sourceSummary}
			<a href="/settings/sources" data-track="helse:apne-kilder">Kilder →</a>
		</p>

	{/if}
</div>

<style>
	.health-dashboard {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}

	.hd-embedded {
		padding-top: 4px;
	}

	.hd-empty-sub {
		margin: 0;
		font-size: 0.82rem;
		line-height: 1.5;
		color: #777;
	}

	.hd-pills {
		display: inline-flex;
	}

	.hd-empty,
	.hd-widget-card {
		background: var(--card-bg-subtle, #141414);
		border-radius: var(--card-radius, 16px);
	}

	.hd-widget-card {
		padding: 16px 12px;
	}

	.hd-empty {
		padding: 28px 20px;
		text-align: center;
		color: #aaa;
	}

	.hd-widget-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
		gap: 12px;
		justify-items: center;
		padding: 4px 0 8px;
	}

	.hd-widget-skeleton {
		width: 90px;
		height: 106px;
		border-radius: 14px;
		background: linear-gradient(120deg, #1c1c1c 0%, #232323 50%, #1c1c1c 100%);
		background-size: 200% 100%;
		animation: hd-skeleton-shimmer 1.4s ease-in-out infinite;
	}

	@keyframes hd-skeleton-shimmer {
		0% { background-position: 200% 0; }
		100% { background-position: -200% 0; }
	}

	@media (max-width: 640px) {
		.hd-empty-sub {
			font-size: 0.84rem;
		}
	}

	.hd-sources-section {
		margin-top: 12px;
	}

	.hd-sources-line {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin: 12px 0 0;
		font-size: 0.78rem;
		color: #777;
	}

	.hd-sources-line a {
		color: #9aa7f0;
		text-decoration: none;
	}
</style>
