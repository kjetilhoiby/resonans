<!--
  WidgetProposalCard — viser et widget-forslag fra boten.
  Brukeren kan bekrefte (opprett), konfigurere eller forkaste.

  Props:
    draft      WidgetDraft fra propose_widget-tool
    oncreate   kalles med widgetId etter vellykket opprettelse
    ondiscard  kalles når bruker forkaster forslaget
-->
<script lang="ts">
	import GoalRing from '$lib/components/ui/GoalRing.svelte';
	import type { WidgetDraft } from '$lib/artifacts/widget-draft';

	interface Props {
		draft: WidgetDraft;
		oncreate?: (widgetId: string) => void;
		ondiscard?: () => void;
	}

	let { draft, oncreate, ondiscard }: Props = $props();

	let creating = $state(false);
	let created = $state(false);
	let error = $state('');

	const RANGE_LABELS: Record<string, string> = {
		last7: 'siste 7 dager',
		last14: 'siste 14 dager',
		last30: 'siste 30 dager',
		current_week: 'denne uken',
		current_month: 'denne måneden',
		current_year: 'i år',
	};

	const AGG_LABELS: Record<string, string> = {
		avg: 'snitt',
		sum: 'sum',
		count: 'antall',
		latest: 'siste verdi',
	};

	const metaLine = $derived(
		[AGG_LABELS[draft.aggregation] ?? draft.aggregation, RANGE_LABELS[draft.range] ?? draft.range, draft.filterCategory]
			.filter(Boolean)
			.join(' · ')
	);

	async function confirm() {
		creating = true;
		error = '';
		try {
			const res = await fetch('/api/user-widgets', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					title: draft.title,
					metricType: draft.metricType,
					aggregation: draft.aggregation,
					period: draft.period,
					range: draft.range,
					filterCategory: draft.filterCategory,
					unit: draft.unit,
					goal: draft.goal,
					color: draft.color,
					pinned: true,
				}),
			});
			if (!res.ok) {
				const body = await res.text();
				throw new Error(body || 'Feil ved opprettelse');
			}
			const widget = await res.json();
			created = true;
			oncreate?.(widget.id);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Noe gikk galt';
		} finally {
			creating = false;
		}
	}
</script>

<div class="proposal-card">
	<div class="proposal-preview">
		<GoalRing pct={draft.goal ? 0 : 50} color={draft.color} size={56} strokeWidth={4}>
			<span class="ring-unit">{draft.unit}</span>
		</GoalRing>
		<div class="proposal-info">
			<span class="proposal-title">{draft.title}</span>
			<span class="proposal-meta">{metaLine}</span>
			{#if draft.goal}
				<span class="proposal-goal">Mål: {draft.goal} {draft.unit}</span>
			{/if}
		</div>
	</div>

	{#if error}
		<p class="proposal-error">{error}</p>
	{/if}

	{#if created}
		<p class="proposal-success">✓ Widget opprettet og festet til hjemskjermen</p>
	{:else}
		<div class="proposal-actions">
			<button class="btn-primary" onclick={confirm} disabled={creating}>
				{creating ? 'Oppretter…' : 'Opprett widget'}
			</button>
			<button class="btn-ghost" onclick={ondiscard} disabled={creating}>Forkast</button>
		</div>
	{/if}
</div>

<style>
	.proposal-card {
		margin-top: 8px;
		border: 1px solid #2a2a2a;
		border-radius: 14px;
		padding: 14px 16px;
		background: #161616;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.proposal-preview {
		display: flex;
		align-items: center;
		gap: 14px;
	}

	.ring-unit {
		font-size: 0.6rem;
		color: #888;
		letter-spacing: 0.02em;
	}

	.proposal-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.proposal-title {
		font-size: 0.9rem;
		font-weight: 600;
		color: #eee;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.proposal-meta {
		font-size: 0.72rem;
		color: #888;
	}

	.proposal-goal {
		font-size: 0.72rem;
		color: #aaa;
		margin-top: 2px;
	}

	.proposal-actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}

	.proposal-error {
		font-size: 0.78rem;
		color: #e07070;
		margin: 0;
	}

	.proposal-success {
		font-size: 0.82rem;
		color: #82c882;
		margin: 0;
	}
</style>
