<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { AppPage } from '$lib/components/ui';
	import FlowSheet from '$lib/components/flows/FlowSheet.svelte';
	import { FLOWS } from '$lib/flows/registry';
	import type { FlowContext } from '$lib/flows/types';
	import {
		MonthHeader,
		PreviousMonthContext,
		MonthNote,
		MonthChecklist,
		MonthGoals,
		WeeksOverview,
		MonthReflection,
		LongTermGoals
	} from '$lib/components/domain/maanedsplan';
	import type {
		SaveState,
		MonthChecklist as MonthChecklistType,
		MonthGoal,
		ChecklistItem
	} from '$lib/components/domain/maanedsplan/types';

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
			monthChecklist: MonthChecklistType | null;
			monthNote: string;
			reflection: string;
			vision: string;
			weeksInMonth: Array<{
				year: number;
				week: string;
				dashedKey: string;
				contextKey: string;
				startDate: string;
				endDate: string;
				daysInMonth: number;
			}>;
			weekChecklists: Record<string, {
				id: string;
				title: string;
				completedAt: string | null;
				items: ChecklistItem[];
			}>;
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

	// ── Local state ──────────────────────────────────────────────────────────

	let monthChecklistState = $state<MonthChecklistType | null>(
		data.monthChecklist ? structuredClone(data.monthChecklist) : null
	);
	let monthNoteValue = $state(data.monthNote);
	let reflectionValue = $state(data.reflection);
	let visionValue = $state(data.vision);
	let monthGoalsState = $state<MonthGoal[]>(structuredClone(data.monthGoals));
	let selectedWeekKey = $state<string | null>(null);
	let saveStates = $state<Record<string, SaveState>>({
		monthNote: 'idle',
		items: 'idle',
		review: 'idle'
	});

	let monthPlanFlowOpen = $state(false);
	let monthPlanFlowContext = $state<FlowContext>({});
	let openingMonthPlanFlow = $state(false);

	// ── Sync from data ───────────────────────────────────────────────────────

	$effect(() => {
		monthChecklistState = data.monthChecklist ? structuredClone(data.monthChecklist) : null;
	});

	$effect(() => {
		monthGoalsState = structuredClone(data.monthGoals);
	});

	$effect(() => {
		monthNoteValue = data.monthNote;
		reflectionValue = data.reflection;
		visionValue = data.vision;
	});

	$effect(() => {
		const today = new Date().toISOString().slice(0, 10);
		const currentWeek = data.weeksInMonth.find(
			(w) => today >= w.startDate && today <= w.endDate
		);
		selectedWeekKey = currentWeek?.dashedKey ?? data.weeksInMonth[0]?.dashedKey ?? null;
	});

	// ── Derived ──────────────────────────────────────────────────────────────

	const monthIsPlanned = $derived(
		!!monthNoteValue || (monthChecklistState?.items.length ?? 0) > 0
	);
	const hasPrevContext = $derived(
		!!data.previousMonthSummary.note || !!data.previousMonthSummary.reflection
	);

	// ── Save helpers ─────────────────────────────────────────────────────────

	function setSaveState(key: string, state: SaveState) {
		saveStates = { ...saveStates, [key]: state };
	}

	function flashSaved(key: string) {
		setSaveState(key, 'saved');
		setTimeout(() => setSaveState(key, 'idle'), 1800);
	}

	// ── Month plan flow ──────────────────────────────────────────────────────

	async function openMonthPlanFlow() {
		openingMonthPlanFlow = true;
		try {
			const res = await fetch(`/api/month-plan/context?month=${encodeURIComponent(data.month.dashedKey)}`);
			if (!res.ok) return;
			const ctx = await res.json() as {
				currentMonthKey: string;
				currentMonthName: string;
				prevMonthKey: string;
				prevMonthName: string;
				note: string;
				reflection: string;
				uncheckedItems: Array<{ id: string; text: string }>;
				monthGoals: Array<{ title: string; currentValue: number; target: { value: number; unit: string }; trackingMetric: string }>;
				recurringTasks: string[];
			};

			const goalLines = ctx.monthGoals.map((g) => {
				const pct = g.target.value > 0 ? Math.round((g.currentValue / g.target.value) * 100) : null;
				const pctStr = pct !== null ? ` (${pct}%)` : '';
				return `- ${g.title}: ${g.currentValue} av ${g.target.value} ${g.target.unit}${pctStr}`;
			}).join('\n');

			const refleksjonPrompt = [
				`Det er nå ${ctx.currentMonthName} og brukeren er klar for månedsplanlegging.`,
				ctx.prevMonthName ? `\nForrige måned (${ctx.prevMonthName}):` : '',
				ctx.note ? `Månedsnotat: "${ctx.note}"` : '',
				ctx.reflection ? `Refleksjon: "${ctx.reflection}"` : '',
				goalLines ? `\nMål:\n${goalLines}` : '',
				'\nGi en kort, varm oppsummering av forrige måned (2-3 setninger). Avslutt med ett åpent spørsmål om hva som gikk bra og hva som var utfordrende.'
			].filter(Boolean).join('\n');

			const maalPrompt = [
				`Du hjelper brukeren å sette månedsmål for ${ctx.currentMonthName}.`,
				goalLines ? `\nForrige måneds mål og fremgang (${ctx.prevMonthName}):\n${goalLines}` : '\nIngen mål fra forrige måned.',
				'\nSkille mellom mål og oppgaver:',
				'- MÅNEDSMÅL: kun for ting med målbar fremdrift mot et tall (løping i km, vekt i kg, frekvente treningsøkter per uke). Hold listen kort.',
				'- MÅNEDSOPPGAVER: ting du gjør 1–8 ganger denne måneden (utenatt, utebad, sykling til jobb, planleggingsprat hjemme osv.)',
				'\nGå gjennom forrige måneds mål. Foreslå om hvert bør videreføres eller justeres. Kom gjerne med nye oppgaver basert på refleksjonen.',
				'\nAvslutt alltid med begge listene (utelat seksjoner som ikke passer):',
				'\nMÅNEDSMÅL:',
				'- [tittel]: [verdi] [enhet]',
				'\nMÅNEDSOPPGAVER:',
				'- [tittel]: [antall] [enhet]'
			].filter(Boolean).join('\n');

			const maanedshistoriePrompt = [
				`Du hjelper brukeren å skrive en kort månedsbeskrivelse for ${ctx.currentMonthName}.`,
				'Spør: "Hva handler ' + ctx.currentMonthName + ' om for deg?"',
				'Basert på svaret, skriv et utkast på 1-2 avsnitt. Vær personlig og konkret.',
				'La brukeren justere utkastet via chat. Avslutt med det endelige notatet.'
			].join('\n');

			monthPlanFlowContext = {
				monthKey: ctx.currentMonthKey,
				openItems: ctx.uncheckedItems,
				weekTasks: ctx.recurringTasks,
				prevMonthData: {
					monthName: ctx.prevMonthName,
					note: ctx.note,
					reflection: ctx.reflection,
					uncheckedItems: ctx.uncheckedItems,
					monthGoals: ctx.monthGoals,
					recurringTasks: ctx.recurringTasks
				},
				systemPrompts: {
					refleksjon: refleksjonPrompt,
					maal: maalPrompt,
					maanedshistorie: maanedshistoriePrompt
				}
			};
			monthPlanFlowOpen = true;
		} finally {
			openingMonthPlanFlow = false;
		}
	}

	// ── Month note save ──────────────────────────────────────────────────────

	async function saveMonthNote() {
		setSaveState('monthNote', 'saving');
		const form = new FormData();
		form.set('monthKey', data.month.dashedKey);
		form.set('monthNote', monthNoteValue);
		const res = await fetch('?/saveMonthNote', { method: 'POST', body: form });
		if (!res.ok) { setSaveState('monthNote', 'idle'); return; }
		flashSaved('monthNote');
	}

	// ── Reflection/vision save ───────────────────────────────────────────────

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

	// ── Checklist mutations ──────────────────────────────────────────────────

	async function ensureChecklist(): Promise<MonthChecklistType | null> {
		if (monthChecklistState) return monthChecklistState;

		const res = await fetch('/api/checklists', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				title: `${data.month.monthName.charAt(0).toUpperCase() + data.month.monthName.slice(1)} ${data.month.year}`,
				emoji: '\u{1F4C5}',
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

	async function handleAddItem(text: string) {
		const checklist = await ensureChecklist();
		if (!checklist) return;

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
	}

	async function handleToggleItem(itemId: string, nextChecked: boolean) {
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

	async function handleEditItem(itemId: string, newText: string) {
		if (!monthChecklistState) return;
		const checklist = monthChecklistState;
		const original = checklist.items.find((i) => i.id === itemId);
		if (!original || original.text === newText) return;

		monthChecklistState = {
			...checklist,
			items: checklist.items.map((i) => (i.id === itemId ? { ...i, text: newText } : i))
		};

		const res = await fetch(`/api/checklists/${checklist.id}/items/${itemId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ text: newText })
		});

		if (!res.ok) {
			monthChecklistState = checklist;
		}
	}

	async function handleDeleteItem(itemId: string) {
		if (!monthChecklistState) return;
		const checklist = monthChecklistState;
		monthChecklistState = { ...checklist, items: checklist.items.filter((i) => i.id !== itemId) };
		await fetch(`/api/checklists/${checklist.id}/items/${itemId}`, { method: 'DELETE' });
	}

	// ── Month goal mutations ─────────────────────────────────────────────────

	async function handleAddGoal(goal: { title: string; goalType: MonthGoal['goalType']; targetValue: number; unit: string }) {
		const tempId = crypto.randomUUID();
		const optimistic: MonthGoal = {
			id: tempId,
			title: goal.title,
			goalType: goal.goalType,
			trackingMetric: goal.goalType,
			target: { value: goal.targetValue, unit: goal.unit },
			currentValue: 0,
			baselineValue: null
		};
		monthGoalsState = [...monthGoalsState, optimistic];

		const form = new FormData();
		form.set('monthKey', data.month.dashedKey);
		form.set('title', goal.title);
		form.set('goalType', goal.goalType);
		form.set('trackingMetric', goal.goalType);
		form.set('targetValue', String(goal.targetValue));
		form.set('unit', goal.unit);
		const res = await fetch('?/addMonthGoal', { method: 'POST', body: form });
		if (!res.ok) {
			monthGoalsState = monthGoalsState.filter((g) => g.id !== tempId);
			return;
		}
		await invalidateAll();
	}

	async function handleUpdateGoalProgress(goalId: string, delta: number) {
		const goal = monthGoalsState.find((g) => g.id === goalId);
		if (!goal) return;
		monthGoalsState = monthGoalsState.map((g) =>
			g.id === goalId ? { ...g, currentValue: Math.max(0, g.currentValue + delta) } : g
		);
		const form = new FormData();
		form.set('goalId', goalId);
		form.set('delta', String(delta));
		const res = await fetch('?/updateMonthGoalProgress', { method: 'POST', body: form });
		if (!res.ok) {
			monthGoalsState = monthGoalsState.map((g) =>
				g.id === goalId ? { ...g, currentValue: Math.max(0, g.currentValue - delta) } : g
			);
		}
	}

	async function handleDeleteGoal(goalId: string) {
		const prev = monthGoalsState;
		monthGoalsState = monthGoalsState.filter((g) => g.id !== goalId);
		const form = new FormData();
		form.set('goalId', goalId);
		const res = await fetch('?/deleteMonthGoal', { method: 'POST', body: form });
		if (!res.ok) monthGoalsState = prev;
	}
</script>

<svelte:head>
	<title>Månedsplan – {data.month.monthName} {data.month.year}</title>
</svelte:head>

<AppPage padding="none" gap="sm" surface="default">
	<div class="mp-page">

	<MonthHeader
		monthName={data.month.monthName}
		year={data.month.year}
		previousMonthKey={data.monthNav.previousMonthKey}
		nextMonthKey={data.monthNav.nextMonthKey}
		isCurrentMonth={data.monthNav.isCurrentMonth}
	/>

	{#if !monthIsPlanned}
		<PreviousMonthContext
			monthName={data.month.monthName}
			previousMonthSummary={data.previousMonthSummary}
			{hasPrevContext}
			openingFlow={openingMonthPlanFlow}
			onplanmonth={() => void openMonthPlanFlow()}
		/>
	{/if}

	<MonthNote
		monthName={data.month.monthName}
		bind:value={monthNoteValue}
		saveState={saveStates.monthNote}
		onsave={() => void saveMonthNote()}
	/>

	<MonthChecklist
		checklist={monthChecklistState}
		saveState={saveStates.items}
		onensure={ensureChecklist}
		ontoggle={(id, checked) => void handleToggleItem(id, checked)}
		onadd={(text) => void handleAddItem(text)}
		onedit={(id, text) => void handleEditItem(id, text)}
		ondelete={(id) => void handleDeleteItem(id)}
	/>

	<MonthGoals
		goals={monthGoalsState}
		onaddgoal={(g) => void handleAddGoal(g)}
		onupdateprogress={(id, delta) => void handleUpdateGoalProgress(id, delta)}
		ondeletegoal={(id) => void handleDeleteGoal(id)}
	/>

	<WeeksOverview
		weeksInMonth={data.weeksInMonth}
		weekChecklists={data.weekChecklists}
		{selectedWeekKey}
		onselectweek={(key) => (selectedWeekKey = key)}
	/>

	<MonthReflection
		bind:reflectionValue
		bind:visionValue
		saveState={saveStates.review}
		onsave={() => void saveReview()}
	/>

	<LongTermGoals goals={data.longTermGoals} />

	</div>
</AppPage>

<FlowSheet
	flow={monthPlanFlowOpen ? FLOWS.planning_month_plan : null}
	context={monthPlanFlowContext}
	onclose={() => (monthPlanFlowOpen = false)}
	oncomplete={async () => { monthPlanFlowOpen = false; await invalidateAll(); }}
/>

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
</style>
