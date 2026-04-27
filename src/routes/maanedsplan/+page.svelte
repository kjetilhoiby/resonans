<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { tick } from 'svelte';
	import { AppPage } from '$lib/components/ui';
	import ScreenTitle from '$lib/components/ui/ScreenTitle.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { startNavMetric } from '$lib/client/nav-metrics';
	import { groupChecklistItems, activityEmoji } from '$lib/utils/checklist-group';

	type SaveState = 'idle' | 'saving' | 'saved';

	interface ChecklistItem {
		id: string;
		text: string;
		checked: boolean;
	}

	interface MonthChecklist {
		id: string;
		title: string;
		emoji: string;
		completedAt: string | null;
		items: ChecklistItem[];
	}

	interface MonthGoal {
		id: string;
		title: string;
		goalType:
			| 'running_distance'
			| 'yoga_sessions'
			| 'weight_kg'
			| 'reading_books'
			| 'spending_nok'
			| 'manual_counter';
		trackingMetric:
			| 'running_distance'
			| 'yoga_sessions'
			| 'weight_kg'
			| 'reading_books'
			| 'spending_nok'
			| 'manual_counter';
		target: { value: number; unit: string };
		currentValue: number;
		baselineValue: number | null;
	}

	interface WeekInMonth {
		year: number;
		week: string;
		dashedKey: string;
		contextKey: string;
		startDate: string;
		endDate: string;
		daysInMonth: number;
	}

	interface WeekChecklist {
		id: string;
		title: string;
		completedAt: string | null;
		items: ChecklistItem[];
	}

	interface Props {
		data: {
			month: {
				year: number;
				month: string;
				dashedKey: string;
				compactKey: string;
				contextKey: string;
				startDate: string;
				endDate: string;
				monthName: string;
			};
			monthNav: {
				previousMonthKey: string;
				nextMonthKey: string;
				isCurrentMonth: boolean;
			};
			monthChecklist: MonthChecklist | null;
			monthNote: string;
			reflection: string;
			vision: string;
			weeksInMonth: WeekInMonth[];
			weekChecklists: Record<string, WeekChecklist>;
			longTermGoals: Array<{ id: string; title: string; targetDate: string | null }>;
					monthGoals: MonthGoal[];
			previousMonthSummary: {
				monthKey: string;
				monthName: string;
				note: string;
				reflection: string;
			};
		};
	}

	let { data }: Props = $props();

	let monthChecklistState = $state<MonthChecklist | null>(
		data.monthChecklist ? structuredClone(data.monthChecklist) : null
	);
	let monthNoteValue = $state(data.monthNote);
	let reflectionValue = $state(data.reflection);
	let visionValue = $state(data.vision);
	let monthGoalsState = $state<MonthGoal[]>(structuredClone(data.monthGoals));
	let showAddGoalForm = $state(false);
	let newGoalType = $state<MonthGoal['goalType']>('running_distance');
	let newGoalTitle = $state('');
	let newGoalTarget = $state('');
	let newGoalUnit = $state('');
	let addGoalTitleInput = $state<HTMLInputElement | null>(null);
	let composerText = $state('');
	let composerInput = $state<HTMLInputElement | null>(null);
	let editingItemId = $state<string | null>(null);
	let editingText = $state('');
	let editInput = $state<HTMLInputElement | null>(null);
	let selectedWeekKey = $state<string | null>(null);
	let saveStates = $state<Record<string, SaveState>>({
		monthNote: 'idle',
		items: 'idle',
		review: 'idle'
	});

	$effect(() => {
		monthGoalsState = structuredClone(data.monthGoals);
	});

	// Auto-select the current week if it's in this month
	$effect(() => {
		if (selectedWeekKey === null && data.weeksInMonth.length > 0) {
			const today = new Date().toISOString().slice(0, 10);
			const currentWeek = data.weeksInMonth.find(
				(w) => today >= w.startDate && today <= w.endDate
			);
			selectedWeekKey = currentWeek?.dashedKey ?? data.weeksInMonth[0].dashedKey;
		}
	});

	const selectedWeek = $derived(data.weeksInMonth.find((w) => w.dashedKey === selectedWeekKey) ?? null);
	const selectedWeekChecklist = $derived(
		selectedWeekKey ? (data.weekChecklists[selectedWeekKey] ?? null) : null
	);
	const monthIsPlanned = $derived(
		!!monthNoteValue || (monthChecklistState?.items.length ?? 0) > 0
	);
	const monthIsClosed = $derived(!!reflectionValue);
	const hasPrevContext = $derived(
		!!data.previousMonthSummary.note || !!data.previousMonthSummary.reflection
	);

	function setSaveState(key: string, state: SaveState) {
		saveStates = { ...saveStates, [key]: state };
	}

	function flashSaved(key: string) {
		setSaveState(key, 'saved');
		setTimeout(() => setSaveState(key, 'idle'), 1800);
	}

	function monthHref(key: string) {
		return `/maanedsplan?month=${encodeURIComponent(key)}`;
	}

	function formatTargetDate(iso: string | null): string {
		if (!iso) return '';
		const d = new Date(iso);
		if (isNaN(d.getTime())) return '';
		return new Intl.DateTimeFormat('nb-NO', { month: 'short', year: 'numeric' }).format(d);
	}

	const GOAL_TYPE_CONFIG: Record<MonthGoal['goalType'], {
		emoji: string;
		label: string;
		placeholder: string;
		unitPlaceholder: string;
		tracked: boolean;
	}> = {
		running_distance: {
			emoji: '🏃',
			label: 'Løping',
			placeholder: 'Løpemål i måneden',
			unitPlaceholder: 'km',
			tracked: true
		},
		yoga_sessions: {
			emoji: '🧘',
			label: 'Yoga',
			placeholder: 'Yogamål i måneden',
			unitPlaceholder: 'økter',
			tracked: true
		},
		weight_kg: {
			emoji: '⚖️',
			label: 'Vekt',
			placeholder: 'Målvekt ved månedsslutt',
			unitPlaceholder: 'kg',
			tracked: true
		},
		reading_books: {
			emoji: '📚',
			label: 'Boklesing',
			placeholder: 'Bøker i måneden',
			unitPlaceholder: 'bøker',
			tracked: false
		},
		spending_nok: {
			emoji: '💰',
			label: 'Forbruk',
			placeholder: 'Månedlig forbrukstak',
			unitPlaceholder: 'kr',
			tracked: false
		},
		manual_counter: {
			emoji: '✏️',
			label: 'Annet',
			placeholder: 'Mål du teller manuelt',
			unitPlaceholder: 'ganger',
			tracked: false
		}
	} as const;

	function goalTypeEmoji(type: MonthGoal['goalType'] | MonthGoal['trackingMetric']) {
		return GOAL_TYPE_CONFIG[type]?.emoji ?? '🎯';
	}

	function isAutoTracked(goal: MonthGoal) {
		return GOAL_TYPE_CONFIG[goal.trackingMetric]?.tracked ?? false;
	}

	function goalReached(goal: MonthGoal) {
		if (goal.target.value <= 0) return false;
		if (goal.trackingMetric === 'weight_kg') return goal.currentValue <= goal.target.value;
		return goal.currentValue >= goal.target.value;
	}

	function formatGoalProgress(goal: MonthGoal) {
		if (goal.trackingMetric === 'weight_kg') {
			const current = Number.isFinite(goal.currentValue) ? goal.currentValue.toFixed(1) : '-';
			const target = Number.isFinite(goal.target.value) ? goal.target.value.toFixed(1) : '-';
			return `${current} / ${target} ${goal.target.unit || 'kg'}`;
		}
		if (goal.target.value > 0) {
			return `${goal.currentValue} / ${goal.target.value} ${goal.target.unit}`;
		}
		return `${goal.currentValue} ${goal.target.unit}`;
	}

	function goalTrackingLabel(goal: MonthGoal) {
		if (goal.trackingMetric === 'running_distance') return 'Oppdateres automatisk fra løpeøkter';
		if (goal.trackingMetric === 'yoga_sessions') return 'Oppdateres automatisk fra yogaøkter';
		if (goal.trackingMetric === 'weight_kg') return 'Oppdateres automatisk fra vektregistreringer';
		if (goal.trackingMetric === 'spending_nok') return 'Klar for kobling til økonomiregistrering';
		if (goal.trackingMetric === 'reading_books') return 'Klar for kobling til leseregistrering';
		return 'Manuell teller';
	}

	async function openAddGoalForm() {
		showAddGoalForm = true;
		newGoalTitle = '';
		newGoalTarget = '';
		newGoalUnit = GOAL_TYPE_CONFIG[newGoalType].unitPlaceholder;
		await tick();
		addGoalTitleInput?.focus();
	}

	function selectGoalType(type: MonthGoal['goalType']) {
		newGoalType = type;
		newGoalUnit = GOAL_TYPE_CONFIG[type].unitPlaceholder;
		if (type === 'weight_kg') newGoalTarget = '';
	}

	async function submitAddGoal() {
		const title = newGoalTitle.trim();
		if (!title) return;

		const tempId = crypto.randomUUID();
		const targetVal = Number(newGoalTarget);
		if (!Number.isFinite(targetVal) || targetVal <= 0) return;
		const unit = newGoalUnit.trim();

		// Optimistic add
		const optimistic: MonthGoal = {
			id: tempId,
			title,
			goalType: newGoalType,
			trackingMetric: newGoalType,
			target: { value: targetVal, unit },
			currentValue: 0,
			baselineValue: null
		};
		monthGoalsState = [...monthGoalsState, optimistic];
		showAddGoalForm = false;
		newGoalTitle = '';
		newGoalTarget = '';

		const form = new FormData();
		form.set('monthKey', data.month.dashedKey);
		form.set('title', title);
		form.set('goalType', newGoalType);
		form.set('trackingMetric', newGoalType);
		form.set('targetValue', String(targetVal));
		form.set('unit', unit);
		const res = await fetch('?/addMonthGoal', { method: 'POST', body: form });
		if (!res.ok) {
			monthGoalsState = monthGoalsState.filter((g) => g.id !== tempId);
			return;
		}
		// Reload to get real ID
		await invalidateAll();
	}

	async function updateGoalProgress(goalId: string, delta: number) {
		const goal = monthGoalsState.find((g) => g.id === goalId);
		if (!goal || isAutoTracked(goal)) return;
		// Optimistic update
		monthGoalsState = monthGoalsState.map((g) =>
			g.id === goalId ? { ...g, currentValue: Math.max(0, g.currentValue + delta) } : g
		);
		const form = new FormData();
		form.set('goalId', goalId);
		form.set('delta', String(delta));
		const res = await fetch('?/updateMonthGoalProgress', { method: 'POST', body: form });
		if (!res.ok) {
			// Revert
			monthGoalsState = monthGoalsState.map((g) =>
				g.id === goalId ? { ...g, currentValue: Math.max(0, g.currentValue - delta) } : g
			);
		}
	}

	async function deleteMonthGoal(goalId: string) {
		const prev = monthGoalsState;
		monthGoalsState = monthGoalsState.filter((g) => g.id !== goalId);
		const form = new FormData();
		form.set('goalId', goalId);
		const res = await fetch('?/deleteMonthGoal', { method: 'POST', body: form });
		if (!res.ok) monthGoalsState = prev;
	}

	function handleAddGoalKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submitAddGoal(); }
		if (e.key === 'Escape') { showAddGoalForm = false; }
	}
	function formatWeekRange(week: WeekInMonth): string {
		const start = new Date(`${week.startDate}T12:00:00Z`);
		const end = new Date(`${week.endDate}T12:00:00Z`);
		const startDay = start.getUTCDate();
		const endDay = end.getUTCDate();
		const startMonth = new Intl.DateTimeFormat('nb-NO', { month: 'short' }).format(start);
		const endMonth = new Intl.DateTimeFormat('nb-NO', { month: 'short' }).format(end);
		if (startMonth === endMonth) return `${startDay}–${endDay}. ${endMonth}`;
		return `${startDay}. ${startMonth} – ${endDay}. ${endMonth}`;
	}

	// ── Checklist mutations ───────────────────────────────────────────────────

	async function ensureChecklist(): Promise<MonthChecklist | null> {
		if (monthChecklistState) return monthChecklistState;

		const res = await fetch('/api/checklists', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				title: `${data.month.monthName.charAt(0).toUpperCase() + data.month.monthName.slice(1)} ${data.month.year}`,
				emoji: '📅',
				context: data.month.contextKey
			})
		});
		if (!res.ok) return null;
		const created = await res.json();
		monthChecklistState = {
			id: created.id,
			title: created.title,
			emoji: created.emoji,
			completedAt: created.completedAt ?? null,
			items: created.items ?? []
		};
		return monthChecklistState;
	}

	async function submitComposer() {
		const text = composerText.trim();
		if (!text) return;

		const checklist = await ensureChecklist();
		if (!checklist) return;

		composerText = '';
		setSaveState('items', 'saving');

		const res = await fetch(`/api/checklists/${checklist.id}/items`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ text, sortOrder: checklist.items.length })
		});

		if (!res.ok) {
			setSaveState('items', 'idle');
			return;
		}

		const created = await res.json();
		const newItems = Array.isArray(created) ? created : [created];
		monthChecklistState = {
			...checklist,
			items: [
				...checklist.items,
				...newItems.map((i: any) => ({ id: i.id, text: i.text, checked: i.checked ?? false }))
			]
		};
		flashSaved('items');
		await tick();
		composerInput?.focus();
	}

	async function toggleItem(itemId: string, nextChecked: boolean) {
		if (!monthChecklistState) return;
		const checklist = monthChecklistState;
		setSaveState('items', 'saving');

		monthChecklistState = {
			...checklist,
			items: checklist.items.map((i) => (i.id === itemId ? { ...i, checked: nextChecked } : i))
		};

		const res = await fetch(`/api/checklists/${checklist.id}/items/${itemId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ checked: nextChecked })
		});

		if (!res.ok) {
			monthChecklistState = checklist;
			setSaveState('items', 'idle');
			return;
		}

		flashSaved('items');
	}

	async function startEditing(item: ChecklistItem) {
		editingItemId = item.id;
		editingText = item.text;
		await tick();
		editInput?.focus();
		editInput?.select();
	}

	async function saveEdit() {
		const id = editingItemId;
		if (!id || !monthChecklistState) return;
		const trimmed = editingText.trim();
		editingItemId = null;

		if (!trimmed) {
			await deleteItem(id);
			return;
		}

		const checklist = monthChecklistState;
		const original = checklist.items.find((i) => i.id === id);
		if (!original || original.text === trimmed) return;

		monthChecklistState = {
			...checklist,
			items: checklist.items.map((i) => (i.id === id ? { ...i, text: trimmed } : i))
		};

		const res = await fetch(`/api/checklists/${checklist.id}/items/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ text: trimmed })
		});

		if (!res.ok) {
			monthChecklistState = checklist;
		}
	}

	async function deleteItem(itemId: string) {
		if (!monthChecklistState) return;
		const checklist = monthChecklistState;
		monthChecklistState = { ...checklist, items: checklist.items.filter((i) => i.id !== itemId) };

		await fetch(`/api/checklists/${checklist.id}/items/${itemId}`, { method: 'DELETE' });
	}

	let skipEditBlur = false;

	function handleEditBlur() {
		if (skipEditBlur) { skipEditBlur = false; return; }
		void saveEdit();
	}

	function handleEditKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') { e.preventDefault(); void saveEdit(); }
		if (e.key === 'Escape') editingItemId = null;
	}

	function handleComposerKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submitComposer(); }
	}

	// ── Notes ─────────────────────────────────────────────────────────────────

	let initialValue = '';
	function markInitialValue(e: Event) {
		initialValue = (e.currentTarget as HTMLTextAreaElement).value;
	}

	function submitOnBlurIfChanged(e: Event) {
		const el = e.currentTarget as HTMLTextAreaElement;
		if (el.value !== initialValue) el.form?.requestSubmit();
	}

	async function saveMonthNote() {
		setSaveState('monthNote', 'saving');
		const form = new FormData();
		form.set('monthKey', data.month.dashedKey);
		form.set('monthNote', monthNoteValue);
		const res = await fetch('?/saveMonthNote', { method: 'POST', body: form });
		if (!res.ok) { setSaveState('monthNote', 'idle'); return; }
		flashSaved('monthNote');
	}

	async function saveReview() {
		setSaveState('review', 'saving');
		const form = new FormData();
		form.set('monthKey', data.month.dashedKey);
		form.set('reflection', reflectionValue);
		form.set('vision', visionValue);
		const res = await fetch('?/saveNotes', { method: 'POST', body: form });
		if (!res.ok) { setSaveState('review', 'idle'); return; }
		flashSaved('review');
	}
</script>

<svelte:head>
	<title>Månedsplan – {data.month.monthName} {data.month.year}</title>
</svelte:head>

<AppPage width="full" padding="none" gap="sm" theme="dark" surface="default">
	<div class="mp-page">

	<header class="mp-header">
		<ScreenTitle
			title={`${data.month.monthName.charAt(0).toUpperCase() + data.month.monthName.slice(1)} ${data.month.year}`}
			ariaLabel="Tilbake til hjem"
			onpress={() => { startNavMetric('maanedsplan', 'home'); void goto('/'); }}
		/>
		<div class="mp-header-actions">
			<a class="mp-nav-btn" href="/ukeplan" aria-label="Til ukeplan">
				<Icon name="calendar" size={15} />
				<span>Uke</span>
			</a>
			<a class="mp-nav-btn" href={monthHref(data.monthNav.previousMonthKey)} aria-label="Forrige måned">
				<Icon name="back" size={16} />
			</a>
			<a class="mp-nav-btn" href={monthHref(data.monthNav.nextMonthKey)} aria-label="Neste måned">
				<Icon name="forward" size={16} />
			</a>
			{#if !data.monthNav.isCurrentMonth}
				<a class="mp-nav-btn mp-nav-btn--today" href="/maanedsplan" aria-label="Gå til denne måneden">
					I dag
				</a>
			{/if}
		</div>
	</header>

	<!-- Previous month context -->
	{#if hasPrevContext && !monthIsPlanned}
		<section class="mp-card mp-prev-context">
			<p class="mp-subhead">Fra {data.previousMonthSummary.monthName}</p>
			{#if data.previousMonthSummary.reflection}
				<p class="mp-prev-text">"{data.previousMonthSummary.reflection}"</p>
			{:else if data.previousMonthSummary.note}
				<p class="mp-prev-text">"{data.previousMonthSummary.note}"</p>
			{/if}
		</section>
	{/if}

	<!-- Month note -->
	<section class="mp-card">
		<div class="mp-card-head">
			<h2>Månedsnotat</h2>
			<span class="mp-save-dot" class:is-saving={saveStates.monthNote === 'saving'} class:is-saved={saveStates.monthNote === 'saved'} aria-hidden="true"></span>
		</div>
		<textarea
			class="mp-textarea"
			rows="2"
			placeholder={`Hva handler ${data.month.monthName} om?`}
			bind:value={monthNoteValue}
			onfocus={markInitialValue}
			onblur={async (e) => { submitOnBlurIfChanged(e); await saveMonthNote(); }}
		></textarea>
	</section>

	<!-- Monthly goals checklist -->
	<section class="mp-card">
		<div class="mp-card-head">
			<h2>Gjøremål</h2>
			{#if monthChecklistState}
				{@const done = monthChecklistState.items.filter((i) => i.checked).length}
				{@const total = monthChecklistState.items.length}
				<span class="mp-pill">{done} / {total}</span>
				<span class="mp-save-dot" class:is-saving={saveStates.items === 'saving'} class:is-saved={saveStates.items === 'saved'} aria-hidden="true"></span>
			{/if}
		</div>

		{#if monthChecklistState && monthChecklistState.items.length > 0}
			<ul class="mp-checklist">
				{#each monthChecklistState.items as item (item.id)}
					<li class="mp-check-row">
						{#if editingItemId === item.id}
							<div class="mp-edit-shell">
								<input
									bind:this={editInput}
									bind:value={editingText}
									class="mp-input mp-edit-input"
									type="text"
									onblur={handleEditBlur}
									onkeydown={handleEditKeydown}
								/>
								<button
									type="button"
									class="mp-btn-danger"
									onmousedown={() => (skipEditBlur = true)}
									onclick={() => void deleteItem(item.id)}
									aria-label="Slett"
								><Icon name="close" size={13} /></button>
							</div>
						{:else}
							<button
								type="button"
								class="mp-item-text-btn"
								onclick={() => void startEditing(item)}
							>
								<span class="mp-check-text" class:checked={item.checked}>{item.text}</span>
							</button>
						{/if}
						<button
							type="button"
							class="mp-check-toggle"
							onclick={() => void toggleItem(item.id, !item.checked)}
							aria-label={item.checked ? 'Marker som ikke gjort' : 'Marker som gjort'}
						>
							<span class="mp-check-circle" class:checked={item.checked}>{item.checked ? '✓' : ''}</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		<div class="mp-add-form">
			<div class="mp-field-shell">
				<input
					bind:this={composerInput}
					bind:value={composerText}
					class="mp-input"
					type="text"
					placeholder="Legg til gjøremål og trykk Enter"
					onkeydown={handleComposerKeydown}
				/>
			</div>
		</div>
	</section>

	<!-- Monthly quantified goals -->
	<section class="mp-card mp-goals-month-card">
		<div class="mp-card-head">
			<h2>Månedsmål</h2>
			<button type="button" class="mp-goal-add-btn" onclick={() => void openAddGoalForm()} aria-label="Legg til mål">
				<span>+</span> Legg til mål
			</button>
		</div>

		{#if monthGoalsState.length > 0}
			<ul class="mp-month-goals-list">
				{#each monthGoalsState as goal (goal.id)}
					<li class="mp-month-goal-row">
						<span class="mp-month-goal-emoji">{goalTypeEmoji(goal.trackingMetric)}</span>
						<div class="mp-month-goal-main">
							<span class="mp-month-goal-title">{goal.title}</span>
							<span class="mp-month-goal-sub">{goalTrackingLabel(goal)}</span>
						</div>
						<div class="mp-month-goal-progress">
							<span class="mp-month-goal-count" class:reached={goalReached(goal)}>
								{formatGoalProgress(goal)}
							</span>
							{#if !isAutoTracked(goal)}
								<button type="button" class="mp-goal-stepper" onclick={() => void updateGoalProgress(goal.id, -1)} aria-label="Minus">−</button>
								<button type="button" class="mp-goal-stepper mp-goal-stepper--plus" onclick={() => void updateGoalProgress(goal.id, 1)} aria-label="Pluss">+</button>
							{/if}
						</div>
						<button type="button" class="mp-goal-delete" onclick={() => void deleteMonthGoal(goal.id)} aria-label="Slett mål">×</button>
					</li>
				{/each}
			</ul>
		{/if}

		{#if showAddGoalForm}
			<div class="mp-add-goal-form">
				<p class="mp-goal-flow-hint">Velg måltype. Løping, yoga og vekt blir koblet til registreringer automatisk.</p>
				<div class="mp-goal-type-pills">
					{#each Object.entries(GOAL_TYPE_CONFIG) as [type, cfg]}
						<button
							type="button"
							class="mp-type-pill"
							class:active={newGoalType === type}
							onclick={() => selectGoalType(type as MonthGoal['goalType'])}
						>{cfg.emoji} {cfg.label}</button>
					{/each}
				</div>
				<div class="mp-add-goal-fields">
					<input
						bind:this={addGoalTitleInput}
						bind:value={newGoalTitle}
						class="mp-input"
						type="text"
						placeholder={GOAL_TYPE_CONFIG[newGoalType].placeholder}
						onkeydown={handleAddGoalKeydown}
					/>
					<div class="mp-goal-target-row">
						<input
							bind:value={newGoalTarget}
							class="mp-input mp-input--narrow"
							type="number"
							min="0.1"
							step={newGoalType === 'weight_kg' || newGoalType === 'running_distance' ? '0.1' : '1'}
							placeholder={newGoalType === 'weight_kg' ? 'Målvekt' : 'Målverdi'}
							onkeydown={handleAddGoalKeydown}
						/>
						<input
							bind:value={newGoalUnit}
							class="mp-input"
							type="text"
							placeholder={GOAL_TYPE_CONFIG[newGoalType].unitPlaceholder}
							onkeydown={handleAddGoalKeydown}
						/>
					</div>
					{#if GOAL_TYPE_CONFIG[newGoalType].tracked}
						<p class="mp-goal-hint">Progresjon beregnes automatisk fra registreringene dine.</p>
					{:else}
						<p class="mp-goal-hint">Dette målet kan du telle manuelt inntil vi kobler registreringstype.</p>
					{/if}
					<div class="mp-add-goal-actions">
						<button type="button" class="mp-btn-primary" onclick={() => void submitAddGoal()}>Legg til</button>
						<button type="button" class="mp-btn-ghost" onclick={() => (showAddGoalForm = false)}>Avbryt</button>
					</div>
				</div>
			</div>
		{:else if monthGoalsState.length === 0}
			<p class="mp-goals-empty">Ingen månedsmål ennå. Legg til et mål med knappen over.</p>
		{/if}
	</section>
	<!-- Weeks in month -->
	<section class="mp-card">
		<div class="mp-card-head">
			<h2>Uker i måneden</h2>
		</div>

		<div class="mp-weeks">
			{#each data.weeksInMonth as week}
				{@const wCl = data.weekChecklists[week.dashedKey]}
				{@const done = wCl ? wCl.items.filter((i) => i.checked).length : 0}
				{@const total = wCl ? wCl.items.length : 0}
				{@const isPartial = week.daysInMonth < 7}
				<button
					type="button"
					class="mp-week-btn"
					class:selected={selectedWeekKey === week.dashedKey}
					onclick={() => (selectedWeekKey = week.dashedKey)}
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
						{#each groupChecklistItems(selectedWeekChecklist.items) as group}
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
								<li class="mp-week-item" class:checked={group.item.checked}>
									<span class="mp-week-item-dot" class:checked={group.item.checked}>{group.item.checked ? '✓' : ''}</span>
									<span class="mp-week-item-text">{group.item.text}</span>
								</li>
							{/if}
						{/each}
					</ul>
				{:else}
					<p class="mp-week-empty">
						{#if selectedWeekChecklist}
							Ingen punkter på ukeslisten ennå.
						{:else}
							Ingen ukesliste opprettet ennå.
						{/if}
						<a class="mp-week-link" href={`/ukeplan?week=${encodeURIComponent(selectedWeek.dashedKey)}`}>
							Gå til ukeplan →
						</a>
					</p>
				{/if}
			</div>
		{/if}
	</section>

	<!-- Reflection / Vision -->
	<section class="mp-card">
		<div class="mp-card-head">
			<h2>Refleksjon og retning</h2>
			<span class="mp-save-dot" class:is-saving={saveStates.review === 'saving'} class:is-saved={saveStates.review === 'saved'} aria-hidden="true"></span>
		</div>

		<label class="mp-label" for="mp-reflection">Hva lærte jeg denne måneden?</label>
		<div class="mp-field-shell">
			<textarea
				id="mp-reflection"
				class="mp-textarea"
				rows="2"
				placeholder="Refleksjon over måneden..."
				bind:value={reflectionValue}
				onfocus={markInitialValue}
				onblur={async (e) => { submitOnBlurIfChanged(e); await saveReview(); }}
			></textarea>
		</div>

		<label class="mp-label" for="mp-vision">Hva tar jeg med meg videre?</label>
		<div class="mp-field-shell">
			<textarea
				id="mp-vision"
				class="mp-textarea"
				rows="2"
				placeholder="Intensjon for neste måned..."
				bind:value={visionValue}
				onfocus={markInitialValue}
				onblur={async (e) => { submitOnBlurIfChanged(e); await saveReview(); }}
			></textarea>
		</div>
	</section>

	<!-- Long-term goals -->
	{#if data.longTermGoals.length > 0}
		<section class="mp-card">
			<div class="mp-card-head">
				<h2>Langsiktige mål</h2>
			</div>
			<ul class="mp-goals-list">
				{#each data.longTermGoals as goal}
					<li class="mp-goal-row">
						<a class="mp-goal-link" href={`/goals?goal=${goal.id}`}>
							<span class="mp-goal-title">{goal.title}</span>
							{#if goal.targetDate}
								<span class="mp-goal-date">{formatTargetDate(goal.targetDate)}</span>
							{/if}
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	</div>
</AppPage>

<style>
	.mp-page {
		min-height: 100vh;
		width: 100%;
		padding: var(--screen-title-top-pad, 34px) 20px 110px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		background:
			radial-gradient(900px 480px at 0% -10%, rgba(51, 82, 122, 0.18), transparent 70%),
			linear-gradient(180deg, #060709 0%, #08090d 55%, #060709 100%);
		color: #dcdde2;
	}

	.mp-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}

	.mp-header-actions {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
		padding-top: 2px;
	}

	.mp-nav-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 32px;
		padding: 0 10px;
		border-radius: 9px;
		border: 1px solid #1e2030;
		background: #0c0e18;
		color: #8a99c4;
		font-size: 0.78rem;
		font-weight: 600;
		text-decoration: none;
		cursor: pointer;
		transition: background 0.12s, color 0.12s, border-color 0.12s;
	}
	.mp-nav-btn:hover { background: #12162a; color: #bac6f9; border-color: #2e3660; }
	.mp-nav-btn--today { color: #7c8ef5; }

	.mp-card {
		background: linear-gradient(180deg, rgba(9, 11, 17, 0.95), rgba(8, 10, 15, 0.95));
		border-radius: 14px;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.mp-prev-context {
		border-left: 2px solid rgba(186, 198, 249, 0.12);
		border-radius: 0 10px 10px 0;
		padding-left: 14px;
		background: rgba(9, 11, 17, 0.5);
	}

	.mp-card-head {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.mp-card h2 {
		margin: 0;
		font-size: 0.95rem;
		color: #ddd;
		flex: 1;
	}

	.mp-subhead {
		font-size: 0.72rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #70788f;
		font-weight: 650;
		margin: 0;
	}

	.mp-prev-text {
		font-size: 0.85rem;
		color: #8a90a3;
		font-style: italic;
		margin: 0;
		line-height: 1.5;
	}

	.mp-pill {
		font-size: 0.72rem;
		color: #8a90a3;
		background: #10131a;
		padding: 3px 8px;
		border-radius: 999px;
	}

	.mp-label {
		font-size: 0.78rem;
		color: #70788f;
		font-weight: 600;
	}

	.mp-textarea {
		width: 100%;
		background: #0a0c14;
		border: 1px solid #1a1d2a;
		border-radius: 10px;
		color: #ccc;
		padding: 9px 11px;
		font: inherit;
		font-size: max(0.88rem, 16px);
		resize: none;
		outline: none;
		line-height: 1.5;
		box-sizing: border-box;
		transition: border-color 0.12s;
	}
	.mp-textarea:focus { border-color: #3a4adf; }
	.mp-textarea::placeholder { color: #3a3f52; }

	.mp-field-shell {
		position: relative;
	}

	.mp-save-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: transparent;
		transition: background 0.2s;
		flex-shrink: 0;
	}
	.mp-save-dot.is-saving { background: #7c8ef5; }
	.mp-save-dot.is-saved { background: #5fa080; }

	/* ── Checklist ── */
	.mp-checklist {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.mp-check-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 2px;
	}

	.mp-item-text-btn {
		flex: 1;
		background: none;
		border: none;
		text-align: left;
		cursor: pointer;
		padding: 4px 6px;
		border-radius: 6px;
		transition: background 0.1s;
	}
	.mp-item-text-btn:hover { background: #0d1020; }

	.mp-check-text {
		font-size: 0.9rem;
		color: #ccc;
		line-height: 1.4;
		transition: color 0.15s, text-decoration 0.15s;
	}
	.mp-check-text.checked {
		color: #444;
		text-decoration: line-through;
	}

	.mp-check-toggle {
		background: none;
		border: none;
		cursor: pointer;
		padding: 4px;
		flex-shrink: 0;
	}

	.mp-check-circle {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		border: 2px solid #2a2e3f;
		color: white;
		font-size: 0.65rem;
		font-weight: 700;
		transition: border-color 0.15s, background 0.15s;
	}
	.mp-check-circle.checked {
		border-color: #5fa080;
		background: #5fa080;
	}

	.mp-edit-shell {
		display: flex;
		align-items: center;
		gap: 6px;
		flex: 1;
	}

	.mp-input {
		flex: 1;
		background: #0a0c14;
		border: 1px solid #1a1d2a;
		border-radius: 9px;
		color: #ccc;
		padding: 8px 11px;
		font: inherit;
		font-size: max(0.88rem, 16px);
		outline: none;
		transition: border-color 0.12s;
	}
	.mp-input:focus { border-color: #3a4adf; }
	.mp-input::placeholder { color: #3a3f52; }

	.mp-edit-input {
		border-color: #3a4adf;
	}

	.mp-btn-danger {
		background: none;
		border: none;
		color: #554;
		cursor: pointer;
		padding: 4px;
		border-radius: 6px;
		display: flex;
		align-items: center;
		transition: color 0.12s;
	}
	.mp-btn-danger:hover { color: #e07070; }

	.mp-add-form {
		padding-top: 2px;
	}

	/* ── Weeks grid ── */
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
		color: #888;
		font-weight: 600;
	}

	.mp-week-link {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		font-size: 0.76rem;
		color: #7c8ef5;
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
		color: #aaa;
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
		color: #aaa;
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
	.mp-week-slot.checked { border-color: #7c8ef5; background: #7c8ef5; }

	.mp-week-empty {
		font-size: 0.82rem;
		color: #555;
		margin: 0;
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	/* ── Goals ── */
	.mp-goals-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.mp-goal-row {
		border-radius: 8px;
		transition: background 0.1s;
	}
	.mp-goal-row:hover { background: #0c0e18; }

	.mp-goal-link {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 8px 6px;
		text-decoration: none;
	}

	.mp-goal-title {
		font-size: 0.88rem;
		color: #c0c6d8;
		flex: 1;
	}

	.mp-goal-date {
		font-size: 0.72rem;
		color: #555;
		flex-shrink: 0;
	}

	/* ── Monthly quantified goals ── */
	.mp-goal-add-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 28px;
		padding: 0 10px;
		border-radius: 8px;
		border: 1px solid #252840;
		background: #0e1022;
		color: #7c8ef5;
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.12s, border-color 0.12s;
	}
	.mp-goal-add-btn:hover { background: #141830; border-color: #3a4adf; }

	.mp-month-goals-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.mp-month-goal-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 4px;
		border-radius: 8px;
		transition: background 0.1s;
	}
	.mp-month-goal-row:hover { background: #0b0d18; }

	.mp-month-goal-emoji {
		font-size: 1rem;
		flex-shrink: 0;
		width: 22px;
		text-align: center;
	}

	.mp-month-goal-title {
		font-size: 0.9rem;
		color: #c8cfe8;
		line-height: 1.3;
	}

	.mp-month-goal-main {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.mp-month-goal-sub {
		font-size: 0.7rem;
		color: #565f7a;
		line-height: 1.25;
	}

	.mp-month-goal-progress {
		display: flex;
		align-items: center;
		gap: 5px;
		flex-shrink: 0;
	}

	.mp-month-goal-count {
		font-size: 0.78rem;
		color: #60687e;
		min-width: 60px;
		text-align: right;
		transition: color 0.2s;
	}
	.mp-month-goal-count.reached { color: #5fa080; }

	.mp-goal-stepper {
		width: 26px;
		height: 26px;
		border-radius: 50%;
		border: 1px solid #1e2030;
		background: #0c0e18;
		color: #70788f;
		font-size: 1rem;
		line-height: 1;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		transition: background 0.1s, color 0.1s, border-color 0.1s;
	}
	.mp-goal-stepper:hover { background: #12162a; color: #bac6f9; border-color: #3a4adf; }
	.mp-goal-stepper--plus { color: #7c8ef5; }
	.mp-goal-stepper--plus:hover { color: #fff; }

	.mp-goal-delete {
		background: none;
		border: none;
		color: #333;
		font-size: 1.1rem;
		cursor: pointer;
		padding: 2px 4px;
		border-radius: 4px;
		line-height: 1;
		flex-shrink: 0;
		transition: color 0.12s;
	}
	.mp-goal-delete:hover { color: #e07070; }

	.mp-add-goal-form {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 2px 0;
	}

	.mp-goal-flow-hint {
		margin: 0;
		font-size: 0.76rem;
		color: #70788f;
		line-height: 1.35;
	}

	.mp-goal-type-pills {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}

	.mp-type-pill {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 28px;
		padding: 0 10px;
		border-radius: 999px;
		border: 1px solid #1e2030;
		background: #0c0e18;
		color: #70788f;
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.12s, color 0.12s, border-color 0.12s;
	}
	.mp-type-pill:hover { background: #101326; color: #bac6f9; }
	.mp-type-pill.active {
		background: #141830;
		border-color: #7c8ef5;
		color: #bac6f9;
	}

	.mp-add-goal-fields {
		display: flex;
		flex-direction: column;
		gap: 7px;
	}

	.mp-goal-target-row {
		display: flex;
		gap: 7px;
	}

	.mp-input--narrow {
		width: 80px;
		flex-shrink: 0;
	}

	.mp-add-goal-actions {
		display: flex;
		gap: 8px;
		align-items: center;
	}

	.mp-goal-hint {
		margin: 0;
		font-size: 0.74rem;
		line-height: 1.35;
		color: #5c6684;
	}

	.mp-btn-primary {
		height: 34px;
		padding: 0 16px;
		border-radius: 9px;
		border: none;
		background: #3a4adf;
		color: #fff;
		font: inherit;
		font-size: 0.85rem;
		font-weight: 650;
		cursor: pointer;
		transition: background 0.12s;
	}
	.mp-btn-primary:hover { background: #4d5ef0; }

	.mp-btn-ghost {
		height: 34px;
		padding: 0 14px;
		border-radius: 9px;
		border: 1px solid #1e2030;
		background: transparent;
		color: #70788f;
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
		transition: color 0.12s, border-color 0.12s;
	}
	.mp-btn-ghost:hover { color: #bac6f9; border-color: #3a4adf; }

	.mp-goals-empty {
		font-size: 0.82rem;
		color: #3a3f52;
		margin: 0;
		padding: 4px 2px;
	}
</style>
