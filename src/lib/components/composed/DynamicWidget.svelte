<!--
  DynamicWidget — container: henter widget-data (cache + fetch) og rendrer
  DynamicWidgetView. All presentasjon (ring, tween, long-press-meny) bor i View,
  som også kan brukes direkte med mock-data (se /design).
-->
<script lang="ts">
	import DynamicWidgetView from './DynamicWidgetView.svelte';
	import { getCachedWidgetData, fetchWidgetData } from '$lib/client/widget-data-cache';
	import type { WidgetData } from '$lib/client/widget-data-cache';

	interface Props {
		widgetId: string;
		title: string;
		unit: string;
		color: string;
		pinned: boolean;
		/**
		 * Valgfri overstyring av periodevinduet (f.eks. 'last7', 'last30', 'current_year').
		 * Når den endres henter widgeten nye data og animerer overgangen før→nå.
		 */
		range?: string | null;
		onpress?: () => void;
		onchat?: (summary: string) => void;
		onunpin?: () => void;
		onconfig?: () => void;
	}

	let { widgetId, title, unit, color, pinned, range = null, onpress, onchat, onunpin, onconfig }: Props = $props();

	let data = $state<WidgetData | null>(null);
	let loading = $state(true);
	let error = $state(false);
	let refreshing = $state(false);
	let pendingFetchId = 0;

	$effect(() => {
		// Avhengig av (widgetId, range) — refetch når noen av disse endres.
		const currentWidgetId = widgetId;
		const currentRange = range;
		const fetchId = ++pendingFetchId;
		let alive = true;

		const cached = getCachedWidgetData(currentWidgetId, currentRange);
		if (cached) {
			data = cached;
			loading = false;
			refreshing = true;
			error = false;
		} else {
			// Ingen cache for denne perioden: behold gammel verdi synlig under fetch
			// (View tweener når data faktisk kommer), men marker som refreshing.
			refreshing = true;
			if (!data) loading = true;
		}

		(async () => {
			try {
				const fresh = await fetchWidgetData(currentWidgetId, currentRange);
				if (!alive || fetchId !== pendingFetchId) return;
				if (fresh) {
					const hasMeaningfulData = fresh.current !== null || fresh.sparkline.length > 0;
					if (hasMeaningfulData || !cached) {
						data = fresh;
					}
				} else {
					error = !cached && !data;
				}
			} catch {
				if (alive && fetchId === pendingFetchId) error = !cached && !data;
			} finally {
				if (alive && fetchId === pendingFetchId) {
					loading = false;
					refreshing = false;
				}
			}
		})();

		return () => {
			alive = false;
		};
	});
</script>

<DynamicWidgetView
	{title}
	{unit}
	{color}
	{data}
	{loading}
	{error}
	{refreshing}
	{onpress}
	{onchat}
	{onunpin}
	{onconfig}
/>
