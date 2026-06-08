<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import { groupChecklistItems, activityEmoji } from '$lib/utils/checklist-group';
	import type { WeekInMonth, WeekChecklist, ChecklistItem } from './types';
	import { formatWeekRange } from './types';

	interface Props {
		weeksInMonth: WeekInMonth[];
		weekChecklists: Record<string, WeekChecklist>;
		selectedWeekKey: string | null;
		onselectweek: (dashedKey: string) => void;
	}

	let { weeksInMonth, weekChecklists, selectedWeekKey, onselectweek }: Props = $props();

	let expandedWeekParentIds = $state<Set<string>>(new Set());

	const selectedWeek = $derived(weeksInMonth.find((w) => w.dashedKey === selectedWeekKey) ?? null);
	const selectedWeekChecklist = $derived(
		selectedWeekKey ? (weekChecklists[selectedWeekKey] ?? null) : null
	);

	function toggleWeekParentExpansion(parentId: string) {
		const next = new Set(expandedWeekParentIds);
		if (next.has(parentId)) next.delete(parentId);
		else next.add(parentId);
		expandedWeekParentIds = next;
	}
</script>

<section class="mp-card">
	<div class="mp-card-head">
		<h2>Uker i måneden</h2>
	</div>

	<div class="mp-weeks">
		{#each weeksInMonth as week}
			{@const wCl = weekChecklists[week.dashedKey]}
			{@const done = wCl ? wCl.items.filter((i) => i.checked).length : 0}
			{@const total = wCl ? wCl.items.length : 0}
			{@const isPartial = week.daysInMonth < 7}
			<button
				type="button"
				class="mp-week-btn"
				class:selected={selectedWeekKey === week.dashedKey}
				onclick={() => onselectweek(week.dashedKey)}
			>
				<span class="mp-week-num">Uke {week.week}</span>
				<span class="mp-week-dates">{formatWeekRange(week)}</span>
				{#if total > 0}
					<span class="mp-week-progress" class:all-done={done === total}>{done}/{total}</span>
				{:else if isPartial}
					<span class="mp-week-partial">delvis</span>
				{/if}
			</button>
		{/each}
	</div>

	{#if selectedWeek}
		<div class="mp-week-detail">
			<div class="mp-week-detail-head">
				<span class="mp-week-detail-title">Uke {selectedWeek.week} · {formatWeekRange(selectedWeek)}</span>
				<a class="mp-week-link" href={`/ukeplan?week=${encodeURIComponent(selectedWeek.dashedKey)}`}>
					Åpne i ukeplan <Icon name="forward" size={12} />
				</a>
			</div>

			{#if selectedWeekChecklist && selectedWeekChecklist.items.length > 0}
				<ul class="mp-week-items">
					{#each groupChecklistItems(selectedWeekChecklist.items.filter(i => !i.parentId)) as group}
						{#if group.type === 'group'}
							<li class="mp-week-item mp-week-item--group">
								<span class="mp-week-item-label">
									{activityEmoji(group.label) ? activityEmoji(group.label) + ' ' : ''}{group.label}
								</span>
								<div class="mp-week-slots">
									{#each group.items as slot}
										<span class="mp-week-slot" class:checked={slot.checked}>{slot.checked ? '✓' : ''}</span>
									{/each}
								</div>
							</li>
						{:else}
							{@const mpChildren = selectedWeekChecklist.items.filter(c => c.parentId === group.item.id)}
							{@const hasMpChildren = mpChildren.length > 0}
							{@const completedMpChildren = mpChildren.filter(c => c.checked).length}
							{@const isMpExpanded = expandedWeekParentIds.has(group.item.id)}
							{@const mR = 7}
							{@const mC = 2 * Math.PI * mR}
							{@const mPct = mpChildren.length > 0 ? completedMpChildren / mpChildren.length : 0}
							<li class="mp-week-item" class:checked={group.item.checked} class:mp-week-item--parent={hasMpChildren}>
								{#if hasMpChildren}
									<svg class="mp-parent-circle" viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
										<circle cx="9" cy="9" r={mR} fill="none" stroke="#2a2a2a" stroke-width="2"/>
										<circle cx="9" cy="9" r={mR} fill="none"
											stroke={completedMpChildren === mpChildren.length ? '#5fa080' : '#7c8ef5'}
											stroke-width="2"
											stroke-dasharray="{mPct * mC} {mC}"
											stroke-linecap="round"
											transform="rotate(-90 9 9)"
										/>
									</svg>
								{:else}
									<span class="mp-week-item-dot" class:checked={group.item.checked}>{group.item.checked ? '✓' : ''}</span>
								{/if}
								<span class="mp-week-item-text">{group.item.text}</span>
								{#if hasMpChildren}
									<button
										type="button"
										class="mp-parent-caret"
										class:expanded={isMpExpanded}
										onclick={() => toggleWeekParentExpansion(group.item.id)}
										aria-label={isMpExpanded ? 'Lukk subitems' : 'Utvid subitems'}
									>▸</button>
								{/if}
							</li>
							{#if hasMpChildren && isMpExpanded}
								<li class="mp-week-children">
									{#each mpChildren as child}
										<div class="mp-week-child-row" class:checked={child.checked}>
											<span class="mp-week-item-dot" class:checked={child.checked}>{child.checked ? '✓' : ''}</span>
											<span class="mp-week-item-text">{child.text}</span>
										</div>
									{/each}
								</li>
							{/if}
						{/if}
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</section>

<style>
	.mp-card {
		background: linear-gradient(180deg, rgba(9, 11, 17, 0.95), rgba(8, 10, 15, 0.95));
		border-radius: 14px;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.mp-card-head {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.mp-card h2 {
		margin: 0;
		font-size: 0.95rem;
		color: var(--text-primary);
		flex: 1;
	}

	.mp-weeks {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
		gap: 6px;
	}

	.mp-week-btn {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
		padding: 10px 8px;
		border-radius: 11px;
		border: 1px solid #141720;
		background: #0b0d14;
		cursor: pointer;
		transition: background 0.12s, border-color 0.12s, outline 0.1s;
		text-align: center;
		font: inherit;
	}
	.mp-week-btn:hover { background: #0f1220; border-color: #1e2340; }
	.mp-week-btn.selected {
		outline: 2px solid rgba(124, 142, 245, 0.5);
		outline-offset: 0;
		border-color: transparent;
	}

	.mp-week-num {
		font-size: 0.88rem;
		font-weight: 700;
		color: #c8cfe8;
	}

	.mp-week-dates {
		font-size: 0.68rem;
		color: #60687e;
		white-space: nowrap;
	}

	.mp-week-progress {
		font-size: 0.7rem;
		color: #60687e;
		margin-top: 2px;
	}
	.mp-week-progress.all-done { color: #5fa080; }

	.mp-week-partial {
		font-size: 0.65rem;
		color: #3a3f52;
		margin-top: 2px;
	}

	.mp-week-detail {
		border-top: 1px solid #13151e;
		padding-top: 10px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.mp-week-detail-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.mp-week-detail-title {
		font-size: 0.8rem;
		color: var(--text-tertiary);
		font-weight: 600;
	}

	.mp-week-link {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		font-size: 0.76rem;
		color: var(--accent-light);
		text-decoration: none;
		transition: color 0.12s;
	}
	.mp-week-link:hover { color: #bac6f9; }

	.mp-week-items {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.mp-week-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 3px 0;
	}

	.mp-week-item-dot {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		border: 1.5px solid #2a2e3f;
		font-size: 0.55rem;
		font-weight: 700;
		color: white;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		transition: border-color 0.12s, background 0.12s;
	}
	.mp-week-item-dot.checked { border-color: #5fa080; background: #5fa080; }

	.mp-week-item-text {
		font-size: 0.85rem;
		color: var(--text-secondary);
		line-height: 1.4;
	}
	.mp-week-item.checked .mp-week-item-text {
		color: #3c4055;
		text-decoration: line-through;
	}

	.mp-week-item--group {
		justify-content: space-between;
	}

	.mp-week-item-label {
		font-size: 0.85rem;
		color: var(--text-secondary);
		line-height: 1.4;
	}

	.mp-week-slots {
		display: flex;
		gap: 5px;
		flex-shrink: 0;
	}

	.mp-week-slot {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		border: 1.5px solid #2a2e3f;
		font-size: 0.55rem;
		font-weight: 700;
		color: white;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: border-color 0.12s, background 0.12s;
	}
	.mp-week-slot.checked { border-color: var(--accent-light); background: var(--accent-light); }

	.mp-week-item--parent {
		align-items: center;
	}

	.mp-parent-circle {
		flex-shrink: 0;
		display: block;
	}

	.mp-parent-caret {
		margin-left: auto;
		width: 18px;
		height: 18px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: none;
		background: transparent;
		color: var(--accent-light);
		font-size: 0.75rem;
		line-height: 1;
		cursor: pointer;
		padding: 0;
		flex-shrink: 0;
		transition: transform 0.18s ease;
	}
	.mp-parent-caret.expanded {
		transform: rotate(90deg);
	}

	.mp-week-children {
		list-style: none;
		margin: 0;
		padding: 0 0 0 26px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		border-left: 1px solid #1e2235;
	}

	.mp-week-child-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 2px 0;
	}
	.mp-week-child-row.checked .mp-week-item-text {
		color: #3c4055;
		text-decoration: line-through;
	}
</style>
