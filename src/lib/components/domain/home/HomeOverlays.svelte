<!--
  HomeOverlays — alle overlays som hører til hjemskjermen.
  Widget-panel, tema-panel, tema-meny, snooze-meny, ChecklistSheet,
  WidgetConfigSheet, og FlowSheets for planlegging/egenfrekvens/fokus.

  Leser all state fra HomeContext via getContext.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { getContext } from 'svelte';
	import { fade } from 'svelte/transition';
	import WidgetConfigSheet from '../../ui/WidgetConfigSheet.svelte';
	import ChecklistSheet from '../../ui/ChecklistSheet.svelte';
	import FlowSheet from '../../flows/FlowSheet.svelte';
	import Icon from '../../ui/Icon.svelte';
	import { FLOWS } from '$lib/flows/registry';
	import { buildEgenfrekvensSlotFlow } from '$lib/flows/egenfrekvens-slot';
	import { localIsoDay, periodSlotStorageKey } from '$lib/domains/egenfrekvens/period-slots';
	import { getThemeHueStyle } from '$lib/domain/theme-hues';
	import type { Checklist } from '../../composed/ChecklistWidget.svelte';
	import { HOME_CTX, type HomeContext } from './home-context';

	const ctx = getContext<HomeContext>(HOME_CTX);

	// Marker dagens slot: 'dismissed' gir chip på hjemskjermen, 'done' skjuler alt
	function markSlotCheckinSeen(state: 'dismissed' | 'done') {
		const slot = ctx.egenfrekvensSlotCheckin;
		if (!slot || typeof localStorage === 'undefined') return;
		localStorage.setItem(periodSlotStorageKey(localIsoDay(), slot.id), state);
	}

	function handleSlotContinueChat(data: Record<string, any>) {
		const slot = ctx.egenfrekvensSlotCheckin;
		if (!slot) return;
		const level = Number.isInteger(data?.level) ? Number(data.level) : 3;
		const note = typeof data?.note === 'string' ? data.note.trim() : '';
		// Lagre sjekkinnen først, så chatten har ferske data
		void fetch('/api/egenfrekvens/checkin', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ level, slot: slot.id, note: note || null, day: localIsoDay() })
		}).then(() => { void ctx.loadEgenfrekvensRecent(); });
		markSlotCheckinSeen('done');
		ctx.egenfrekvensSlotChip = null;
		ctx.egenfrekvensSlotCheckin = null;
		ctx.egenfrekvensSlotGate = null;
		// Første melding i chatten: «Kvelden gikk 4, rolig kveld med lesing»
		const labelCap = slot.label.charAt(0).toUpperCase() + slot.label.slice(1);
		ctx.startHomeChat(`${labelCap} gikk ${level}${note ? `, ${note}` : ''}`);
	}
</script>

<!-- Widget-panel -->
{#if ctx.widgetPanelOpen}
	<div class="widget-sheet-backdrop" onclick={() => (ctx.widgetPanelOpen = false)} aria-hidden="true"></div>
	<section class="widget-panel" aria-label="Administrer widgets">
		<div class="widget-panel-handle" aria-hidden="true"></div>
		<div class="widget-panel-head">
			<p>Widget-panel</p>
			<button class="widget-panel-close" onclick={() => (ctx.widgetPanelOpen = false)}>Lukk</button>
		</div>

		<div class="widget-panel-content">
			<div class="widget-panel-section">
				<p class="widget-panel-title">På hjemskjerm</p>
				{#if ctx.pinnedWidgets.length === 0}
					<p class="widget-panel-empty">Ingen aktive widgets</p>
				{:else}
					{#each ctx.pinnedWidgets as w, i (w.id)}
						<div class="widget-panel-row">
							<span class="widget-panel-name">{w.title}</span>
							<div class="widget-panel-actions">
								<button class="widget-btn" onclick={() => ctx.openWidgetConfigSheet(w)}>Konfig</button>
								<button class="widget-btn" onclick={() => ctx.moveWidget(w.id, 'up')} disabled={i === 0}>↑</button>
								<button class="widget-btn" onclick={() => ctx.moveWidget(w.id, 'down')} disabled={i === ctx.pinnedWidgets.length - 1}>↓</button>
								<button class="widget-btn" onclick={() => ctx.unpinWidget(w.id)}>Fjern</button>
								<button class="widget-btn widget-btn-danger" onclick={() => ctx.deleteWidget(w.id)}>Slett</button>
							</div>
						</div>
					{/each}
				{/if}
			</div>

			<div class="widget-panel-section">
				<p class="widget-panel-title">Skjulte widgets</p>
				{#if ctx.hiddenWidgets.length === 0}
					<p class="widget-panel-empty">Ingen skjulte widgets</p>
				{:else}
					{#each ctx.hiddenWidgets as w (w.id)}
						<div class="widget-panel-row">
							<span class="widget-panel-name">{w.title}</span>
							<div class="widget-panel-actions">
								<button class="widget-btn" onclick={() => ctx.openWidgetConfigSheet(w)}>Konfig</button>
								<button class="widget-btn" onclick={() => ctx.repinWidget(w.id)}>Legg til</button>
								<button class="widget-btn widget-btn-danger" onclick={() => ctx.deleteWidget(w.id)}>Slett</button>
							</div>
						</div>
					{/each}
				{/if}
			</div>
		</div>
	</section>
{/if}

<!-- Tema-panel -->
{#if ctx.themePanelOpen}
	<div class="widget-sheet-backdrop" onclick={() => (ctx.themePanelOpen = false)} aria-hidden="true"></div>
	<section class="widget-panel" aria-label="Temaer">
		<div class="widget-panel-handle" aria-hidden="true"></div>
		<div class="widget-panel-head">
			<p>Temaer</p>
			<button class="widget-panel-close theme-panel-close" onclick={() => (ctx.themePanelOpen = false)} aria-label="Lukk"><Icon name="close" size={14} /></button>
		</div>
		<div class="widget-panel-content">
			<div
				class="widget-panel-section"
				bind:this={ctx.themeListEl}
				ondragover={ctx.handleThemeDragOver}
				ondrop={ctx.commitThemeReorder}
				ontouchmove={ctx.handleTouchDragMove}
				ontouchend={ctx.handleTouchDragEnd}
				ontouchcancel={ctx.handleTouchDragEnd}
				role="list"
			>
				{#each ctx.displayList as entry (entry.key)}
					{#if entry.type === 'placeholder'}
						<div class="tema-panel-slot" aria-hidden="true"></div>
					{:else}
						{@const theme = entry.theme}
						<div
							class="tema-panel-row"
							class:tema-panel-row-collapsed={entry.collapsed}
							class:tema-panel-row-dragging={ctx.dragThemeId === theme.id && !ctx.isTouchDrag}
							style={getThemeHueStyle(theme.name)}
							data-theme-id={theme.id}
							draggable="true"
							role="listitem"
							ondragstart={() => { ctx.cancelThemeRowPress(); ctx.handleThemeDragStart(theme.id); }}
							ondragend={ctx.resetDrag}
							onpointerdown={() => ctx.startThemeRowPress(theme)}
							onpointerup={ctx.cancelThemeRowPress}
							onpointerleave={ctx.cancelThemeRowPress}
							onpointercancel={ctx.cancelThemeRowPress}
							oncontextmenu={(e) => e.preventDefault()}
						>
							<span
								class="tema-panel-row-handle"
								aria-hidden="true"
								ontouchstart={(e) => ctx.handleTouchDragStart(e, theme.id)}
								onpointerdown={(e) => e.stopPropagation()}
							>⠿</span>
							<button
								class="tema-panel-row-btn"
								onclick={() => ctx.handleThemeRowClick(theme)}
							>
								<span class="tema-panel-row-icon">{theme.emoji}</span>
								<span class="tema-panel-row-name">{theme.name}</span>
								<span class="tema-panel-row-arrow">→</span>
							</button>
						</div>
					{/if}
				{/each}
			</div>
		</div>
	</section>

	{#if ctx.isTouchDrag && ctx.draggedTheme && ctx.touchChip}
		<div
			class="tema-panel-row tema-panel-row-floating"
			style="{getThemeHueStyle(ctx.draggedTheme.name)}; left: {ctx.touchChip.left}px; top: {ctx.touchChip.top}px; width: {ctx.touchChip.width}px; height: {ctx.touchChip.height}px;"
			aria-hidden="true"
		>
			<span class="tema-panel-row-handle">⠿</span>
			<span class="tema-panel-row-btn">
				<span class="tema-panel-row-icon">{ctx.draggedTheme.emoji}</span>
				<span class="tema-panel-row-name">{ctx.draggedTheme.name}</span>
				<span class="tema-panel-row-arrow">→</span>
			</span>
		</div>
	{/if}
{/if}

<!-- Tema-langpress-meny -->
{#if ctx.themeMenuId}
	<button class="theme-menu-backdrop" onclick={ctx.closeThemeMenu} aria-label="Lukk meny"></button>
	<div class="theme-menu" role="menu" aria-label={`Handlinger for ${ctx.themeMenuName}`}>
		<div class="theme-menu-title">{ctx.themeMenuName}</div>
		<button class="theme-menu-item" role="menuitem" disabled={ctx.themeActionBusy} onclick={() => ctx.archiveThemeFromMenu(ctx.themeMenuId!)}>📥 Arkiver</button>
		<button class="theme-menu-item theme-menu-item-danger" role="menuitem" disabled={ctx.themeActionBusy} onclick={() => ctx.deleteThemeFromMenu(ctx.themeMenuId!, ctx.themeMenuName)}>🗑️ Slett permanent</button>
	</div>
{/if}

<!-- Widget config -->
{#if ctx.configWidget}
	<WidgetConfigSheet
		widget={ctx.configWidget}
		open={true}
		onclose={() => (ctx.configWidget = null)}
		onsave={(updates) => ctx.saveWidgetConfig(ctx.configWidget!.id, updates)}
	/>
{/if}

<!-- Sjekkliste-sheet -->
{#if ctx.openChecklist}
	<ChecklistSheet
		checklist={ctx.openChecklist}
		routines={ctx.todaysRoutines}
		onclose={() => (ctx.openChecklist = null)}
		onChanged={() => { void ctx.fetchChecklists(); }}
		onDeleted={() => {
			ctx.activeChecklists = ctx.activeChecklists.filter((c) => c.id !== ctx.openChecklist?.id);
			ctx.openChecklist = null;
		}}
		onNavigateDay={async (dateIso) => {
			const d = new Date(dateIso + 'T12:00:00');
			const weekKey = ctx.getLocalIsoWeekDashed(d);
			const ctxStr = `week:${weekKey}:day:${dateIso}`;
			let target = ctx.activeChecklists.find((c) => c.context === ctxStr)
				?? ctx.allContextChecklists.find((c) => c.context === ctxStr) ?? null;
			if (!target) {
				try {
					const res = await fetch(`/api/checklists?contexts=${encodeURIComponent(ctxStr)}`);
					if (res.ok) {
						const rows = (await res.json()) as Checklist[];
						target = rows.find((c) => c.context === ctxStr) ?? null;
					}
				} catch { /* stille */ }
			}
			if (target) {
				ctx.openChecklist = target;
			} else {
				ctx.openChecklist = {
					id: '',
					title: `Dag ${dateIso}`,
					emoji: '☑️',
					context: ctxStr,
					completedAt: null,
					items: []
				};
			}
		}}
		onStartChat={async (itemText, checklistId, itemId) => {
			ctx.openChecklist = null;
			try {
				const res = await fetch('/api/conversations/new', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						title: itemText,
						sourceContext: { sourceChecklistId: checklistId, sourceItemId: itemId, sourceItemText: itemText }
					})
				});
				if (res.ok) {
					const { conversationId } = await res.json();
					goto(`/samtaler?conversation=${conversationId}`);
				} else {
					goto('/samtaler');
				}
			} catch {
				goto('/samtaler');
			}
		}}
	/>
{/if}

<!-- FlowSheets: planlegging -->
{#if ctx.homeDayPlanOpen}
	<FlowSheet
		flow={FLOWS['day_plan']}
		context={{ dayIso: ctx.homeDayPlanIso, weekDashedKey: ctx.homeDayPlanWeekKey }}
		onclose={() => (ctx.homeDayPlanOpen = false)}
		oncomplete={async () => { ctx.homeDayPlanOpen = false; await ctx.fetchChecklists(); void ctx.loadActionCandidates(); }}
	/>
{/if}

{#if ctx.homeWeekPlanOpen}
	<FlowSheet
		flow={FLOWS['planning_week_plan']}
		context={ctx.homeWeekPlanContext}
		onclose={() => (ctx.homeWeekPlanOpen = false)}
		oncomplete={async () => { ctx.homeWeekPlanOpen = false; await ctx.fetchChecklists(); void ctx.loadActionCandidates(); }}
	/>
{/if}

{#if ctx.homeMonthPlanOpen}
	<FlowSheet
		flow={FLOWS['planning_month_plan']}
		context={ctx.homeMonthPlanContext}
		onclose={() => (ctx.homeMonthPlanOpen = false)}
		oncomplete={async () => { ctx.homeMonthPlanOpen = false; await ctx.fetchChecklists(); void ctx.loadActionCandidates(); }}
	/>
{/if}

<!-- Egenfrekvens FlowSheets -->
{#if ctx.egenfrekvensFlowOpen}
	{@const carriedInitialData = (() => {
		const init: Record<string, any> = {};
		if (ctx.egenfrekvensInitialNote) init.note = ctx.egenfrekvensInitialNote;
		if (ctx.egenfrekvensCarriedLevel !== null) init.level = ctx.egenfrekvensCarriedLevel;
		return Object.keys(init).length > 0 ? init : undefined;
	})()}
	<FlowSheet
		flow={FLOWS['egenfrekvens_checkin']}
		context={{
			slot: ctx.egenfrekvensActiveSlot,
			...(carriedInitialData ? { initialData: carriedInitialData } : {}),
			...(ctx.egenfrekvensReflectionPrompt ? { systemPrompts: { reflection: ctx.egenfrekvensReflectionPrompt } } : {}),
			...(ctx.egenfrekvensDreamReasons ? { dreamReasons: ctx.egenfrekvensDreamReasons } : {})
		}}
		onclose={() => {
			ctx.egenfrekvensFlowOpen = false;
			ctx.egenfrekvensInitialNote = '';
			ctx.egenfrekvensCarriedLevel = null;
			ctx.egenfrekvensReflectionPrompt = null;
			ctx.egenfrekvensDreamReasons = null;
			if (ctx.returnToChatAfterFlow) { ctx.chatOpen = true; ctx.chatInputAutoFocus = true; }
			ctx.returnToChatAfterFlow = false;
		}}
		oncomplete={() => {
			ctx.egenfrekvensFlowOpen = false;
			ctx.egenfrekvensInitialNote = '';
			ctx.egenfrekvensCarriedLevel = null;
			ctx.egenfrekvensReflectionPrompt = null;
			ctx.egenfrekvensDreamReasons = null;
			void ctx.loadEgenfrekvensRecent();
			void ctx.loadActionCandidates();
			if (ctx.returnToChatAfterFlow) { ctx.chatOpen = true; ctx.chatInputAutoFocus = true; }
			ctx.returnToChatAfterFlow = false;
		}}
	/>
{/if}

{#if ctx.egenfrekvensQuickFlowOpen}
	<FlowSheet
		flow={FLOWS['egenfrekvens_quick']}
		context={{ slot: ctx.egenfrekvensActiveSlot }}
		onclose={() => { ctx.egenfrekvensQuickFlowOpen = false; }}
		oncomplete={() => { ctx.egenfrekvensQuickFlowOpen = false; void ctx.loadEgenfrekvensRecent(); void ctx.loadActionCandidates(); }}
		onsecondaryaction={(action) => {
			if (action.id === 'go-deeper') {
				const carriedNote = typeof action.data?.note === 'string' ? action.data.note.trim() : '';
				const carriedLevel = Number.isInteger(action.data?.level) ? action.data.level : null;
				ctx.egenfrekvensQuickFlowOpen = false;
				if (carriedNote) ctx.egenfrekvensInitialNote = carriedNote;
				ctx.egenfrekvensCarriedLevel = carriedLevel;
				ctx.egenfrekvensFlowOpen = true;
				void ctx.loadEgenfrekvensContext();
			}
		}}
	/>
{/if}

<!-- Slot-gate: dekker hjemskjermen fra første render til vi vet om sjekkinnen skal vises -->
{#if ctx.egenfrekvensSlotGate}
	<div class="slot-gate" out:fade={{ duration: 250 }} aria-hidden="true">
		<img src="/icons/icon-192.svg" alt="" class="slot-gate-logo" />
	</div>
{/if}

<!-- Slot-sjekkin: app-open fullskjerm «Hvordan gikk …?» -->
{#if ctx.egenfrekvensSlotCheckin}
	<FlowSheet
		flow={buildEgenfrekvensSlotFlow(ctx.egenfrekvensSlotCheckin)}
		context={{ initialData: { level: 3 } }}
		onclose={() => {
			// Dismiss (X): la en chip ligge på hjemskjermen til slottet registreres
			markSlotCheckinSeen('dismissed');
			ctx.egenfrekvensSlotChip = ctx.egenfrekvensSlotCheckin;
			ctx.egenfrekvensSlotCheckin = null;
			ctx.egenfrekvensSlotGate = null;
		}}
		oncomplete={() => {
			markSlotCheckinSeen('done');
			ctx.egenfrekvensSlotChip = null;
			ctx.egenfrekvensSlotCheckin = null;
			ctx.egenfrekvensSlotGate = null;
			void ctx.loadEgenfrekvensRecent();
			void ctx.loadActionCandidates();
		}}
		onsecondaryaction={(action) => { if (action.id === 'continue-chat') handleSlotContinueChat(action.data); }}
	/>
{/if}

<!-- Andre FlowSheets -->
{#if ctx.focusTimerFlowOpen}
	<FlowSheet flow={FLOWS['jobb_focus_timer']} onclose={() => { ctx.focusTimerFlowOpen = false; }} oncomplete={() => { ctx.focusTimerFlowOpen = false; void ctx.loadActionCandidates(); }} />
{/if}

{#if ctx.reflectionLightFlowOpen}
	<FlowSheet flow={FLOWS['reflection_light']} onclose={() => { ctx.reflectionLightFlowOpen = false; }} oncomplete={() => { ctx.reflectionLightFlowOpen = false; void ctx.loadActionCandidates(); }} />
{/if}

{#if ctx.quickWinFlowOpen}
	<FlowSheet flow={FLOWS['quick_win']} context={{ openItems: ctx.quickWinOpenItems }} onclose={() => { ctx.quickWinFlowOpen = false; }} oncomplete={() => { ctx.quickWinFlowOpen = false; void ctx.loadActionCandidates(); }} />
{/if}

{#if ctx.inboxNoteFlowOpen}
	<FlowSheet flow={FLOWS['inbox_note']} onclose={() => { ctx.inboxNoteFlowOpen = false; }} oncomplete={() => { ctx.inboxNoteFlowOpen = false; void ctx.loadActionCandidates(); }} />
{/if}

<!-- Snooze-meny -->
{#if ctx.snoozeMenuChipId}
	<button class="snooze-backdrop" aria-label="Lukk snooze-meny" onclick={ctx.closeSnoozeMenu}></button>
	<div class="snooze-menu" role="menu" aria-label={`Snooze ${ctx.snoozeMenuLabel}`}>
		<div class="snooze-menu-title">{ctx.snoozeMenuLabel}</div>
		<button class="snooze-opt" onclick={() => ctx.snoozeChip('today')}><span>Til i morgen</span></button>
		<button class="snooze-opt" onclick={() => ctx.snoozeChip('week')}><span>Til neste mandag</span></button>
		<button class="snooze-opt snooze-opt-strong" onclick={() => ctx.snoozeChip('forever')}><span>Skjul permanent</span></button>
	</div>
{/if}

<style>
	/* Slot-gate: fullskjerm-teppe mens slot-sjekkin avklares. Samme bakgrunn som
	   FlowSheet focus-modus (#0b0b0f) og z-index rett under sheeten (201) for sømløs overgang. */
	.slot-gate {
		position: fixed;
		inset: 0;
		z-index: 200;
		background: #0b0b0f;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.slot-gate-logo {
		width: 72px;
		height: 72px;
		border-radius: 18px;
		animation: slot-gate-pulse 1.6s ease-in-out infinite;
	}
	@keyframes slot-gate-pulse {
		0%, 100% { opacity: 0.4; transform: scale(1); }
		50% { opacity: 0.85; transform: scale(1.05); }
	}

	/* Overlay-stiler (widget-panel, tema-panel, menyer) */

	.widget-sheet-backdrop {
		position: fixed;
		inset: 0;
		z-index: 39;
		background: rgba(0, 0, 0, 0.52);
	}

	.widget-panel {
		position: fixed;
		left: 10px;
		right: 10px;
		bottom: calc(8px + env(safe-area-inset-bottom, 0px));
		z-index: 40;
		max-height: min(72dvh, 560px);
		background: #111;
		border: 1px solid #2b2b2b;
		border-radius: 18px;
		padding: 8px 10px 10px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		overflow: hidden;
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
	}

	.widget-panel-handle {
		width: 40px;
		height: 4px;
		margin: 2px auto 6px;
		border-radius: 999px;
		background: #333;
	}

	.widget-panel-content {
		display: flex;
		flex-direction: column;
		gap: 10px;
		overflow: auto;
		padding-right: 2px;
	}

	.widget-panel-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.widget-panel-head p {
		margin: 0;
		font-size: 0.82rem;
		font-weight: 600;
		color: #e6e6e6;
	}

	.widget-panel-close {
		border: 1px solid #333;
		background: #191919;
		color: #cfcfcf;
		border-radius: 999px;
		padding: 3px 10px;
		font-size: 0.7rem;
		cursor: pointer;
	}

	.widget-panel-close:hover {
		border-color: #4a5af0;
		color: #fff;
	}

	.theme-panel-close {
		width: 32px;
		height: 32px;
		padding: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.widget-panel-section {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.widget-panel-title {
		margin: 0;
		font-size: 0.66rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #7a7a7a;
	}

	.widget-panel-empty {
		margin: 0;
		font-size: 0.74rem;
		color: #727272;
	}

	.widget-panel-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 7px 8px;
		background: #171717;
		border: 1px solid #272727;
		border-radius: 10px;
	}

	.widget-panel-name {
		font-size: 0.76rem;
		color: #d6d6d6;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.widget-panel-actions {
		display: flex;
		gap: 4px;
	}

	.widget-btn {
		border: 1px solid #333;
		background: #1f1f1f;
		color: #ccc;
		border-radius: 8px;
		padding: 3px 7px;
		font-size: 0.68rem;
		cursor: pointer;
	}

	.widget-btn:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.widget-btn-danger {
		border-color: #5a2e2e;
		color: #ffb4b4;
	}

	/* Tema-panel: full liste */
	.tema-panel-row {
		--theme-hue: 228;
		position: relative;
		display: flex;
		align-items: center;
		gap: 6px;
		border-radius: 12px;
		margin-bottom: 6px;
		background: linear-gradient(90deg, hsl(var(--theme-hue) 20% 11%) 0%, hsl(var(--theme-hue) 18% 9%) 100%);
		transition: background 0.12s, opacity 0.12s, box-shadow 0.12s;
		cursor: grab;
	}

	.tema-panel-row:active { cursor: grabbing; }

	.tema-panel-row-dragging {
		opacity: 0.4;
		outline: 1px dashed hsl(var(--theme-hue) 30% 45%);
		outline-offset: -1px;
	}

	.tema-panel-row-collapsed {
		height: 0;
		min-height: 0;
		margin: 0;
		padding: 0;
		opacity: 0;
		overflow: hidden;
		pointer-events: none;
	}

	.tema-panel-slot {
		height: 44px;
		margin-bottom: 6px;
		border-radius: 12px;
		border: 2px dashed var(--accent-primary, hsl(228 50% 55%));
		background: hsl(228 40% 50% / 0.1);
		box-sizing: border-box;
		transition: height 0.12s ease;
	}

	.tema-panel-row-floating {
		position: fixed;
		z-index: 1000;
		margin: 0;
		pointer-events: none;
		box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6);
		outline: 2px solid var(--accent-primary, hsl(var(--theme-hue) 60% 55%));
		outline-offset: -2px;
		transform: scale(1.03);
		transition: none;
	}

	.tema-panel-row-handle {
		padding: 0 4px 0 10px;
		color: #333;
		font-size: 1rem;
		flex-shrink: 0;
		line-height: 1;
		cursor: grab;
		touch-action: none;
	}

	.tema-panel-row-btn {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 10px;
		background: none;
		border: none;
		padding: 11px 14px 11px 0;
		cursor: pointer;
		font: inherit;
		color: #ddd;
		text-align: left;
	}

	.tema-panel-row:hover {
		background: linear-gradient(90deg, hsl(var(--theme-hue) 24% 14%) 0%, hsl(var(--theme-hue) 20% 11%) 100%);
	}

	.tema-panel-row-icon {
		font-size: 1.2rem;
		line-height: 1;
		flex-shrink: 0;
	}

	.tema-panel-row-name {
		flex: 1;
		font-size: 0.9rem;
		font-weight: 600;
		color: hsl(var(--theme-hue) 22% 80%);
	}

	.tema-panel-row-arrow {
		color: #444;
		font-size: 0.85rem;
	}

	/* Tema-langpress-meny */
	.theme-menu-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.45);
		border: 0;
		padding: 0;
		z-index: 1100;
		animation: snooze-fade 120ms ease-out;
	}

	.theme-menu {
		position: fixed;
		left: 50%;
		bottom: max(120px, env(safe-area-inset-bottom, 0px) + 120px);
		transform: translateX(-50%);
		min-width: 240px;
		max-width: 320px;
		background: hsl(228 19% 11%);
		border: 1px solid hsl(228 16% 22%);
		border-radius: 16px;
		padding: 8px;
		z-index: 1101;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
		animation: snooze-pop 160ms cubic-bezier(0.2, 0.9, 0.3, 1.2);
	}

	.theme-menu-title {
		padding: 10px 12px 6px;
		font-size: 0.78rem;
		color: hsl(228 10% 60%);
		text-transform: uppercase;
		letter-spacing: 0.03em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.theme-menu-item {
		display: flex;
		width: 100%;
		padding: 12px 14px;
		background: transparent;
		border: 0;
		border-radius: 10px;
		color: #e2e8f0;
		font-size: 0.95rem;
		text-align: left;
		cursor: pointer;
		transition: background 80ms;
	}

	.theme-menu-item:hover,
	.theme-menu-item:focus-visible {
		background: hsl(228 19% 16%);
	}

	.theme-menu-item:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.theme-menu-item-danger {
		color: hsl(8 70% 70%);
	}

	/* Snooze-meny */
	.snooze-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.45);
		border: 0;
		padding: 0;
		z-index: 1000;
		animation: snooze-fade 120ms ease-out;
	}

	.snooze-menu {
		position: fixed;
		left: 50%;
		bottom: max(120px, env(safe-area-inset-bottom, 0px) + 120px);
		transform: translateX(-50%);
		min-width: 240px;
		max-width: 320px;
		background: hsl(228 19% 11%);
		border: 1px solid hsl(228 16% 22%);
		border-radius: 16px;
		padding: 8px;
		z-index: 1001;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
		animation: snooze-pop 160ms cubic-bezier(0.2, 0.9, 0.3, 1.2);
	}

	.snooze-menu-title {
		padding: 10px 12px 6px;
		font-size: 0.78rem;
		color: hsl(228 10% 60%);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.snooze-opt {
		display: flex;
		width: 100%;
		padding: 12px 14px;
		background: transparent;
		border: 0;
		border-radius: 10px;
		color: #e2e8f0;
		font-size: 0.95rem;
		text-align: left;
		cursor: pointer;
		transition: background 80ms;
	}

	.snooze-opt:hover,
	.snooze-opt:focus-visible {
		background: hsl(228 19% 16%);
	}

	.snooze-opt-strong {
		color: hsl(8 70% 70%);
	}

	@keyframes snooze-fade {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	@keyframes snooze-pop {
		from { opacity: 0; transform: translate(-50%, 12px); }
		to { opacity: 1; transform: translate(-50%, 0); }
	}
</style>
