<script lang="ts">
	import TaskContextMenu from '$lib/components/ui/TaskContextMenu.svelte';
	import AutoCheckModal from '$lib/components/domain/ukeplan/AutoCheckModal.svelte';
	import LocationPickerModal from '$lib/components/ui/LocationPickerModal.svelte';
	import BreakdownModal from '$lib/components/ui/BreakdownModal.svelte';
	import ShareSheet from '$lib/components/domain/share/ShareSheet.svelte';
	import ConversationContextMenu from '$lib/components/ui/ConversationContextMenu.svelte';
	import {
		taskMenuAnchor,
		autoCheckPromptMock,
		geoCandidatesMock,
		mockShareApi,
		mockLoadBreakdownSuggestions,
		conversationThemesMock,
		mockConversationMenuApi
	} from '../mocks';

	const noop = () => {};
</script>

<!-- ══ MENYER & MODALER ═══════════════════════════════════════════════════ -->
<section id="modaler" class="section">
	<h2 class="section-heading">Menyer & modaler</h2>
	<p class="section-desc">
		Interaksjons-overlays som ellers bare er synlige ved long-press eller spesifikke hendelser —
		her statisk åpne i scener. BreakdownModal og ShareSheet har injisert nettverkslag (mock).
	</p>

	<h3 class="subsection">TaskContextMenu — long-press-meny</h3>
	<div class="sheet-stage sheet-stage--short">
		<TaskContextMenu
			open
			anchor={taskMenuAnchor}
			itemText="Svømmehall"
			onClose={noop}
			onEdit={noop}
			onBreakdown={noop}
			onSnooze={noop}
			onSkip={noop}
			onDelete={noop}
			onStartChat={noop}
		/>
	</div>

	<h3 class="subsection">AutoCheckModal — auto-avkryssing</h3>
	<p class="section-desc">Foreslår avkryssing når et nytt punkt matcher en registrert treningsøkt.</p>
	<div class="sheet-stage sheet-stage--short">
		<AutoCheckModal prompt={autoCheckPromptMock} busy={false} onConfirm={noop} onDismiss={noop} />
	</div>

	<h3 class="subsection">LocationPickerModal — flertydig stedsnavn</h3>
	<div class="sheet-stage">
		<LocationPickerModal
			placeName="Håøya"
			candidates={geoCandidatesMock}
			onPick={noop}
			onKeepAsTyped={noop}
			onClose={noop}
		/>
	</div>

	<h3 class="subsection">BreakdownModal — AI-nedbrytning</h3>
	<p class="section-desc">AI-forslagene hentes via <code>loadSuggestionsFn</code>-prop — mock her.</p>
	<div class="sheet-stage">
		<BreakdownModal
			itemTitle="Male barnerommet"
			onClose={noop}
			onSave={async () => {}}
			loadSuggestionsFn={mockLoadBreakdownSuggestions}
		/>
	</div>

	<h3 class="subsection">ConversationContextMenu — samtale-meny</h3>
	<p class="section-desc">
		⋯-menyen på samtaler (stjerne, arkiver, flytt til tema, slett). Nettverk via <code>api</code>-prop;
		<code>initialOpen</code> holder den åpen i demoen.
	</p>
	<div class="sheet-stage sheet-stage--short" style="padding: 12px 12px 0 160px;">
		<ConversationContextMenu
			conversationId="demo"
			starred={true}
			archived={false}
			themes={conversationThemesMock}
			api={mockConversationMenuApi}
			initialOpen
		/>
	</div>

	<h3 class="subsection">ShareSheet — deling</h3>
	<p class="section-desc">Delingspanel for sjekklister/temalister. Nettverk via <code>api</code>-prop — mock viser én eksisterende deling.</p>
	<div class="sheet-stage sheet-stage--tall">
		<ShareSheet
			resourceType="checklist"
			resourceId="cls-1"
			resourceTitle="Bergenstur"
			open
			onClose={noop}
			api={mockShareApi}
		/>
	</div>
</section>
