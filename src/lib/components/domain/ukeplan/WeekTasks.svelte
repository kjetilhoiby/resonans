<script lang="ts">
	import { tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { CardTitle, ChecklistItemRow, ChecklistGroupRow } from '$lib/components/ui';
	import type { ChecklistItemLike } from '$lib/types/checklist';
	import Icon from '$lib/components/ui/Icon.svelte';
	import ProcedureBadge from '$lib/components/ui/ProcedureBadge.svelte';
	import TaskTitle from '$lib/components/ui/TaskTitle.svelte';
	import MentionPicker from '$lib/components/ui/MentionPicker.svelte';
	import MentionAutocomplete from '$lib/components/ui/MentionAutocomplete.svelte';
	import { createMentionState } from '$lib/utils/mention-input.svelte';
	import TaskContextMenu from '$lib/components/ui/TaskContextMenu.svelte';
	import ProcedureSheet from '$lib/components/ui/ProcedureSheet.svelte';
	import { groupChecklistItems, sortByStatus } from '$lib/utils/checklist-group';
	import type { WeekChecklist, WeekTask, ChecklistItem, EditingItem, EditingTask, ProcedureMatch, SaveState } from './types';
	import { weekTasksApi, type WeekTasksApi } from './week-tasks-api';
	import {
		checklistProgress,
		slotState,
		doneTask,
		formatStructuredTaskMeta,
		getTaskIntentBadge,
		getTaskIntentFailureReasonLabel,
		getTaskEvaluationLabel
	} from './week-tasks-logic';

	interface Props {
		weekTasks: WeekTask[];
		weekChecklistState: WeekChecklist | null;
		dashedKey: string;
		weekPlanJustCompleted: boolean;
		planConversationId: string | null | undefined;
		saveStateWeekItems: SaveState;
		// Callbacks
		onCreateChecklistItem: (checklistId: string, text: string, count: number) => Promise<void>;
		onToggleChecklistItem: (checklistId: string, itemId: string, checked: boolean) => Promise<void>;
		onDeleteChecklistItem: (checklistId: string, itemId: string) => Promise<void>;
		onReorderChecklistItems: (checklistId: string, sourceId: string, targetId: string) => Promise<void>;
		onSaveEditedItem: (editingItem: EditingItem) => Promise<void>;
		onStartEditing: (checklistId: string, item: ChecklistItem) => void;
		onCreateWeekChecklist: () => void;
		onSetWeekPlanJustCompleted: (value: boolean) => void;
		onContextMenuOpen: (checklistId: string, item: ChecklistItem, rect: DOMRect) => void;
		onToggleWeekParent: (parentId: string) => void;
		onAddChild: (checklistId: string, parentId: string, text: string) => Promise<void>;
		expandedWeekParentIds: Set<string>;
		editingItem: EditingItem | null;
		selectedDayIso: string;
		dayChecklistId: string | null;
		/** Nettverkslag — injiseres som mock på /design. Default: ekte API. */
		api?: WeekTasksApi;
	}

	let {
		weekTasks,
		weekChecklistState,
		dashedKey,
		weekPlanJustCompleted,
		planConversationId,
		saveStateWeekItems,
		onCreateChecklistItem,
		onToggleChecklistItem,
		onDeleteChecklistItem,
		onReorderChecklistItems,
		onSaveEditedItem,
		onStartEditing,
		onCreateWeekChecklist,
		onSetWeekPlanJustCompleted,
		onContextMenuOpen,
		onToggleWeekParent,
		onAddChild,
		expandedWeekParentIds,
		editingItem,
		selectedDayIso,
		dayChecklistId,
		api = weekTasksApi,
	}: Props = $props();

	const LONG_PRESS_MS = 600;

	// Week composer
	let weekComposerText = $state('');
	let weekComposerInput = $state<HTMLInputElement | null>(null);
	let editInput = $state<HTMLInputElement | null>(null);
	let skipEditBlur = false;

	// Task editing
	let localEditingTask = $state<EditingTask | null>(null);
	let editTaskInput = $state<HTMLInputElement | null>(null);
	let skipEditTask = false;
	let deletingTaskId = $state<string | null>(null);

	// Drag
	let dragItem = $state<{ checklistId: string; itemId: string } | null>(null);
	let dragOverItemId = $state<string | null>(null);

	// Task context menu (for week tasks, not checklist items)
	let taskContextMenuItem = $state<WeekTask | null>(null);
	let taskContextMenuRect = $state<DOMRect | null>(null);
	let taskLongPressTimer: ReturnType<typeof setTimeout> | null = null;
	let taskLongPressTriggered = $state(false);

	// Procedure matching
	let procedureMatches = $state<Map<string, ProcedureMatch>>(new Map());
	let procedureSheetId = $state<string | null>(null);
	let procedureSheetData = $state<any>(null);

	// Mention state for task editing
	const taskMention = createMentionState();
	let taskMentionPickerEl = $state<ReturnType<typeof MentionPicker> | null>(null);

	const progress = $derived(checklistProgress(weekChecklistState));

	// Procedure loading
	async function loadProcedureMatches() {
		if (weekTasks.length === 0) return;
		const results = new Map<string, ProcedureMatch>();
		for (const task of weekTasks) {
			if (task.metadata?.matchedProcedureId) {
				results.set(task.id, {
					procedureId: task.metadata.matchedProcedureId,
					title: task.metadata.matchedProcedureTitle ?? 'Oppskrift',
					emoji: task.metadata.matchedProcedureEmoji ?? null
				});
				continue;
			}
			const match = await api.matchProcedure(task.title);
			if (match) results.set(task.id, match);
		}
		procedureMatches = results;
	}

	$effect(() => { loadProcedureMatches(); });

	async function openProcedureSheet(procedureId: string) {
		const data = await api.getProcedure(procedureId);
		if (!data) return;
		procedureSheetData = data;
		procedureSheetId = procedureId;
	}

	// Task press handlers
	function handleTaskPressStart(e: PointerEvent, task: WeekTask) {
		if (localEditingTask) return;
		const target = e.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		taskLongPressTriggered = false;
		taskLongPressTimer = setTimeout(() => {
			taskLongPressTriggered = true;
			taskContextMenuItem = task;
			taskContextMenuRect = rect;
		}, LONG_PRESS_MS);
	}

	function handleTaskPressEnd() {
		if (taskLongPressTimer) { clearTimeout(taskLongPressTimer); taskLongPressTimer = null; }
	}

	async function handleTaskStartChat(task: WeekTask) {
		await api.startTaskChat(task);
	}

	async function deleteTask(taskId: string) {
		deletingTaskId = taskId;
		try {
			await api.deleteTask(taskId);
		} finally { deletingTaskId = null; }
	}

	async function saveEditTask() {
		if (skipEditTask) { skipEditTask = false; return; }
		if (!localEditingTask) return;
		const { taskId, title, originalTitle } = localEditingTask;
		localEditingTask = null;
		const trimmed = title.trim();
		if (!trimmed || trimmed === originalTitle) return;
		await api.updateTaskTitle(taskId, trimmed);
	}

	// Checklist item row callbacks (for week checklist)
	function makeRowLongpress(checklistId: string) {
		return (rect: DOMRect, item: ChecklistItemLike) => {
			onContextMenuOpen(checklistId, item as ChecklistItem, rect);
		};
	}

	function makeRowTextClick(checklistId: string) {
		return (item: ChecklistItemLike) => {
			onStartEditing(checklistId, item as ChecklistItem);
		};
	}

	function makeRowToggle(checklistId: string) {
		return (item: ChecklistItemLike) => {
			void onToggleChecklistItem(checklistId, item.id, !item.checked);
		};
	}

	function makeRowAddChild(checklistId: string) {
		return async (parentId: string, text: string) => {
			await onAddChild(checklistId, parentId, text);
		};
	}

	function handleEditBlur() {
		if (skipEditBlur) { skipEditBlur = false; return; }
		if (editingItem) void onSaveEditedItem(editingItem);
	}

	function handleEditKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') { event.preventDefault(); if (editingItem) void onSaveEditedItem(editingItem); return; }
		if (event.key === 'Escape') { onStartEditing('', null as any); }
	}

	async function submitWeekComposer() {
		if (!weekChecklistState) return;
		await onCreateChecklistItem(weekChecklistState.id, weekComposerText, 1);
		weekComposerText = '';
		await tick();
		weekComposerInput?.focus();
	}

	function handleComposerKeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter' || event.shiftKey) return;
		event.preventDefault();
		void submitWeekComposer();
	}

	function startTouchDrag(event: TouchEvent, checklistId: string, itemId: string) {
		event.preventDefault();
		dragItem = { checklistId, itemId };
		dragOverItemId = null;

		function onMove(e: TouchEvent) {
			e.preventDefault();
			const touch = e.touches[0];
			if (!touch) return;
			const el = document.elementFromPoint(touch.clientX, touch.clientY);
			const row = el?.closest('[data-item-id]') as HTMLElement | null;
			dragOverItemId = row?.dataset.itemId ?? null;
		}

		function onEnd() {
			const src = dragItem;
			const target = dragOverItemId;
			dragItem = null;
			dragOverItemId = null;
			document.removeEventListener('touchmove', onMove);
			if (src && target && target !== src.itemId) {
				void onReorderChecklistItems(src.checklistId, src.itemId, target);
			}
		}

		document.addEventListener('touchmove', onMove, { passive: false });
		document.addEventListener('touchend', onEnd, { once: true });
	}
</script>

<section class="wp-card" id="ukeplan-checklist">
	<div class="wp-card-head">
		<CardTitle>Ukas oppgaver</CardTitle>
		{#if weekChecklistState}
			<span class="wp-pill">{weekTasks.length + progress.total} totalt</span>
		{:else}
			<span class="wp-pill">{weekTasks.length} fra tema/mål</span>
		{/if}
	</div>

	{#if weekTasks.length > 0}
		<ul class="wp-task-list">
			{#each weekTasks as task}
				{@const structuredMeta = formatStructuredTaskMeta(task)}
				{@const intentBadge = getTaskIntentBadge(task)}
				{@const intentFailureReason = getTaskIntentFailureReasonLabel(task)}
				{@const evaluationLabel = getTaskEvaluationLabel(task)}
				<li
					class="wp-task"
					onpointerdown={(e) => handleTaskPressStart(e, task)}
					onpointerup={handleTaskPressEnd}
					onpointercancel={handleTaskPressEnd}
					onpointerleave={handleTaskPressEnd}
				>
					<div class="wp-task-main">
						<div>
							{#if localEditingTask?.taskId === task.id}
								<div class="wp-edit-shell">
									<MentionPicker
										bind:this={taskMentionPickerEl}
										visible={taskMention.visible}
										persons={taskMention.filtered}
										anchorEl={editTaskInput}
										onSelect={(p) => {
											if (!editTaskInput || !localEditingTask) return;
											taskMention.insert(
												p.name,
												() => editTaskInput!.value,
												() => editTaskInput!.selectionStart ?? editTaskInput!.value.length,
												(v) => { localEditingTask!.title = v; },
												(pos) => tick().then(() => editTaskInput?.setSelectionRange(pos, pos))
											);
										}}
										onClose={() => taskMention.close()}
									/>
									<input
										bind:this={editTaskInput}
										class="wp-task-edit-input"
										type="text"
										bind:value={localEditingTask.title}
										oninput={(e) => {
											const el = e.currentTarget as HTMLInputElement;
											taskMention.scan(el.value, el.selectionStart ?? el.value.length);
										}}
										onkeydown={(e) => {
											if (taskMention.visible && taskMentionPickerEl?.handleKeydown(e)) return;
											if (e.key === 'Enter') void saveEditTask();
											if (e.key === 'Escape') localEditingTask = null;
										}}
										onblur={() => void saveEditTask()}
									/>
									<button
										type="button"
										class="btn-icon-danger"
										onmousedown={() => (skipEditTask = true)}
										onclick={() => void deleteTask(task.id)}
										aria-label="Slett oppgave"
									><Icon name="close" size={13} /></button>
								</div>
							{:else}
								<div class="wp-task-title-row">
									<button
										type="button"
										class="wp-task-title-btn"
										class:done={doneTask(task)}
										onclick={() => { if (!taskLongPressTriggered) localEditingTask = { taskId: task.id, title: task.title, originalTitle: task.title }; }}
									><TaskTitle title={task.title} /></button>
									{#if procedureMatches.has(task.id)}
										{@const match = procedureMatches.get(task.id)!}
										<ProcedureBadge
											emoji={match.emoji}
											title={match.title}
											onclick={() => openProcedureSheet(match.procedureId)}
										/>
									{/if}
								</div>
							{/if}
							<p class="wp-task-meta">
								{task.goalTitle ?? 'Uten mål'}
								{#if task.themeName} · {task.themeName}{/if}
								{#if structuredMeta} · {structuredMeta}{/if}
							</p>
							{#if intentBadge}
								<div class={`wp-task-intent-pill wp-task-intent-${intentBadge.tone}`}>{intentBadge.label}</div>
							{/if}
							{#if evaluationLabel}
								<div class="wp-task-evaluation">{evaluationLabel}</div>
							{/if}
							{#if intentFailureReason}
								<div class="wp-task-intent-failure-reason">{intentFailureReason}</div>
							{/if}
						</div>
						<div class="wp-slot-row" aria-label="Progresjon">
							{#each Array.from({ length: task.repeatCount }) as _, index}
								<span class="wp-slot" class:checked={slotState(task, index)}>{slotState(task, index) ? '✓' : ''}</span>
							{/each}
						</div>
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	{#if weekChecklistState}
		{@const weekChecklistId = weekChecklistState.id}
		<div class="wp-progress-track" aria-hidden="true">
			<div class="wp-progress-fill" style={`width:${progress.pct}%`}></div>
		</div>

		<ul class="wp-checklist">
			{#snippet weekTrailingAction(item: ChecklistItemLike)}
				<span class="wp-drag-handle" aria-hidden="true" ontouchstart={(event) => startTouchDrag(event, weekChecklistId, item.id)}>⋮⋮</span>
			{/snippet}

			{#each groupChecklistItems(sortByStatus(weekChecklistState.items.filter(i => !i.parentId))) as group}
				{#if group.type === 'group'}
					<li class="wp-check-row">
						<ChecklistGroupRow
							label={group.label}
							items={group.items}
							allItems={weekChecklistState.items}
							ontoggle={makeRowToggle(weekChecklistId)}
							onlongpress={makeRowLongpress(weekChecklistId)}
						/>
					</li>
				{:else}
					<li
						class="wp-check-row"
						class:is-dragging={dragItem?.itemId === group.item.id}
						class:is-drag-over={dragOverItemId === group.item.id && dragItem?.itemId !== group.item.id}
						data-item-id={group.item.id}
						draggable={editingItem?.itemId !== group.item.id}
						ondragstart={() => (dragItem = { checklistId: weekChecklistId, itemId: group.item.id })}
						ondragover={(event) => { event.preventDefault(); dragOverItemId = group.item.id; }}
						ondragleave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) dragOverItemId = null; }}
						ondrop={() => {
							if (!dragItem) return;
							void onReorderChecklistItems(weekChecklistId, dragItem.itemId, group.item.id);
							dragItem = null;
							dragOverItemId = null;
						}}
						ondragend={() => { dragItem = null; dragOverItemId = null; }}
					>
						{#if editingItem?.itemId === group.item.id}
							<div class="wp-edit-shell">
								<input
									bind:this={editInput}
									bind:value={editingItem.text}
									class="wp-input wp-edit-input"
									onblur={handleEditBlur}
									onkeydown={handleEditKeydown}
								/>
								<button
									type="button"
									class="btn-icon-danger"
									onmousedown={() => (skipEditBlur = true)}
									onclick={() => void onDeleteChecklistItem(weekChecklistId, group.item.id)}
									aria-label="Slett punkt"
								><Icon name="close" size={13} /></button>
							</div>
						{:else}
							<ChecklistItemRow
								item={group.item}
								allItems={weekChecklistState.items}
								expandedParentIds={expandedWeekParentIds}
								showTime={false}
								showTravel={false}
								ontoggle={makeRowToggle(weekChecklistId)}
								ontextclick={makeRowTextClick(weekChecklistId)}
								onlongpress={makeRowLongpress(weekChecklistId)}
								onexpand={onToggleWeekParent}
								onaddchild={makeRowAddChild(weekChecklistId)}
								animated={false}
								trailingAction={weekTrailingAction}
							/>
						{/if}
					</li>
				{/if}
			{/each}
		</ul>

		<div class="wp-add-form">
			<div class="wp-field-shell">
				<input
					bind:this={weekComposerInput}
					bind:value={weekComposerText}
					class="wp-input"
					type="text"
					placeholder="Skriv punkt og trykk Enter (skriv @ for å nevne en person)"
					onkeydown={handleComposerKeydown}
				/>
				<MentionAutocomplete
					textareaEl={weekComposerInput}
					value={weekComposerText}
					onValueChange={(t) => (weekComposerText = t)}
				/>
				<span class="wp-save-dot" class:is-saving={saveStateWeekItems === 'saving'} class:is-saved={saveStateWeekItems === 'saved'} aria-hidden="true"></span>
			</div>
		</div>
	{:else}
		<form method="POST" action="?/createChecklistForWeek">
			<input type="hidden" name="weekKey" value={dashedKey} />
			<button class="btn-secondary" type="submit">Opprett ukeliste</button>
		</form>
	{/if}
	{#if planConversationId}
		<a href="/samtaler?conversation={planConversationId}" class="wp-plan-conv-link">Åpne planleggingssamtalen →</a>
	{/if}
	{#if weekPlanJustCompleted}
		<div class="wp-completion-banner">
			<span>Ukeplanen er klar! 🎉</span>
			<div class="wp-completion-banner-actions">
				<a href="#ukeplan-checklist" class="wp-completion-banner-btn" onclick={() => onSetWeekPlanJustCompleted(false)}>Åpne ukeplanen</a>
				<button type="button" class="wp-completion-banner-btn" onclick={() => onSetWeekPlanJustCompleted(false)}>Lukk</button>
			</div>
		</div>
	{/if}
</section>

<TaskContextMenu
	open={taskContextMenuItem !== null}
	anchor={taskContextMenuRect}
	itemText={taskContextMenuItem?.title ?? ''}
	onClose={() => { taskContextMenuItem = null; taskContextMenuRect = null; }}
	onStartChat={() => { if (taskContextMenuItem) handleTaskStartChat(taskContextMenuItem); }}
	onUseProcedure={taskContextMenuItem && procedureMatches.has(taskContextMenuItem.id)
		? () => { if (taskContextMenuItem) { const m = procedureMatches.get(taskContextMenuItem.id); if (m) openProcedureSheet(m.procedureId); } }
		: undefined}
/>

{#if procedureSheetData}
	<ProcedureSheet
		procedure={procedureSheetData}
		onclose={() => { procedureSheetId = null; procedureSheetData = null; }}
		onStartChat={(conversationId) => {
			procedureSheetId = null;
			procedureSheetData = null;
			if (conversationId) {
				goto(`/samtaler?id=${conversationId}`);
			} else {
				goto(`/samtaler?newChat=true&title=${encodeURIComponent(procedureSheetData?.title ?? '')}`);
			}
		}}
		onApply={async (procedureId) => {
			if (!dayChecklistId) return;
			await api.applyProcedure(procedureId, dayChecklistId);
			procedureSheetId = null;
			procedureSheetData = null;
		}}
	/>
{/if}

<style>
	.wp-card {
		background: var(--card-bg);
		border: none;
		border-radius: var(--card-radius, 14px);
		padding: var(--card-padding, 12px);
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.wp-card-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
	}


	.wp-pill {
		font-size: 0.72rem;
		color: #8a90a3;
		background: #10131a;
		border: none;
		padding: 3px 8px;
		border-radius: 999px;
	}

	.wp-task-list,
	.wp-checklist {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.wp-task,
	.wp-check-row {
		border: none;
		background: #0e1119;
		border-radius: 10px;
		padding: 10px;
		touch-action: manipulation;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}

	.wp-task-main {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 10px;
	}

	.wp-task-title-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.wp-task-title-btn {
		background: none;
		border: none;
		padding: 0;
		margin: 0;
		font: inherit;
		font-size: 1rem;
		font-weight: 600;
		color: inherit;
		text-align: left;
		cursor: text;
		flex: 1;
		display: block;
	}

	.wp-task-title-btn.done {
		text-decoration: line-through;
		opacity: 0.5;
	}

	.wp-task-meta {
		margin: 4px 0 0;
		font-size: 0.72rem;
		color: #626b82;
	}

	.wp-task-intent-pill {
		margin: 6px 0 0;
		font-size: 0.72rem;
		padding: 4px 8px;
		border-radius: 6px;
		font-weight: 600;
		display: inline-block;
	}

	.wp-task-intent-pending {
		background: rgba(255, 193, 7, 0.1);
		color: #ffc107;
		border: 1px solid rgba(255, 193, 7, 0.3);
	}

	.wp-task-intent-parsed {
		background: rgba(76, 175, 80, 0.1);
		color: #4caf50;
		border: 1px solid rgba(76, 175, 80, 0.3);
	}

	.wp-task-intent-failed {
		background: rgba(244, 67, 54, 0.1);
		color: #f44336;
		border: 1px solid rgba(244, 67, 54, 0.3);
	}

	.wp-task-intent-failure-reason {
		margin: 4px 0 0;
		font-size: 0.82rem;
		color: #d94f4f;
		padding: 4px 0;
		line-height: 1.3;
	}

	.wp-task-evaluation {
		margin: 6px 0 0;
		font-size: 0.82rem;
		color: #7ec97e;
		padding: 0;
		line-height: 1.3;
		font-weight: 500;
	}

	.wp-slot-row {
		display: inline-flex;
		gap: 6px;
		flex-wrap: wrap;
	}

	.wp-slot {
		width: 18px;
		height: 18px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		border: 1px solid #353c50;
		font-size: 0.72rem;
		line-height: 1;
		color: #7180b8;
		background: #111624;
	}

	.wp-slot.checked {
		border-color: #5566b7;
		background: #1a2454;
		color: #ccd8ff;
	}

	.wp-task-edit-input {
		width: 100%;
		padding: 4px 8px;
		font-size: 0.95rem;
		border-radius: 6px;
		border: 1px solid var(--accent-primary);
		background: #1a1f35;
		color: inherit;
		outline: none;
	}

	.wp-edit-shell {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 8px;
		align-items: center;
	}

	.wp-progress-track {
		height: 8px;
		border-radius: 999px;
		background: #151925;
		overflow: hidden;
	}

	.wp-progress-fill {
		height: 100%;
		background: linear-gradient(90deg, #4a5af0, #6f7bf4);
	}

	.wp-add-form {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.wp-field-shell {
		position: relative;
	}

	.wp-input {
		width: 100%;
		background: #0f121b;
		border: none;
		color: var(--text-primary);
		border-radius: 10px;
		font: inherit;
		height: 38px;
		padding: 0 10px;
	}

	.wp-edit-input {
		height: 34px;
	}

	.wp-save-dot {
		position: absolute;
		right: 12px;
		top: 12px;
		width: 8px;
		height: 8px;
		border-radius: 999px;
		background: rgba(102, 112, 138, 0.38);
		box-shadow: 0 0 0 0 rgba(124, 142, 245, 0);
		transition: background-color 160ms ease, box-shadow 220ms ease, opacity 220ms ease;
		opacity: 0;
	}

	.wp-save-dot.is-saving,
	.wp-save-dot.is-saved {
		opacity: 1;
	}

	.wp-save-dot.is-saving {
		background: var(--accent-light);
		animation: wp-dot-pulse 1s ease-in-out infinite;
	}

	.wp-save-dot.is-saved {
		background: #6ab08e;
		box-shadow: 0 0 0 5px rgba(106, 176, 142, 0.08);
	}

	@keyframes wp-dot-pulse {
		0% { box-shadow: 0 0 0 0 rgba(124, 142, 245, 0.22); }
		70% { box-shadow: 0 0 0 6px rgba(124, 142, 245, 0); }
		100% { box-shadow: 0 0 0 0 rgba(124, 142, 245, 0); }
	}

	.wp-drag-handle {
		color: #5e6780;
		font-size: 0.92rem;
		cursor: grab;
		user-select: none;
		touch-action: none;
	}

	.wp-check-row.is-dragging {
		opacity: 0.35;
	}

	.wp-check-row.is-drag-over {
		box-shadow: 0 -2px 0 0 var(--accent-light);
		background: rgba(124, 142, 245, 0.08);
	}

	.wp-plan-conv-link {
		display: inline-block;
		margin-top: 12px;
		font-size: 0.8rem;
		color: var(--accent-light);
		text-decoration: none;
	}
	.wp-plan-conv-link:hover {
		text-decoration: underline;
	}

	.wp-completion-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 12px;
		padding: 10px 14px;
		border-radius: 10px;
		background: #1a2040;
		font-size: 0.85rem;
		color: #c8d0f0;
	}

	.wp-completion-banner-actions {
		display: flex;
		gap: 8px;
	}

	.wp-completion-banner-btn {
		background: none;
		border: none;
		color: var(--accent-light);
		cursor: pointer;
		font-size: 0.8rem;
		padding: 2px 6px;
	}
	.wp-completion-banner-btn:hover {
		text-decoration: underline;
	}
</style>
