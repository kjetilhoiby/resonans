<script lang="ts">
	import BookHeaderBar from '$lib/components/domain/BookHeaderBar.svelte';
	import BookFaktaTab from '$lib/components/domain/BookFaktaTab.svelte';
	import BookClipsTab from '$lib/components/domain/BookClipsTab.svelte';
	import BookContextTab from '$lib/components/domain/BookContextTab.svelte';
	import BookChatTab from '$lib/components/domain/BookChatTab.svelte';
	import { bookMock, bookWithPackMock, bookClipsMock, bookChatMessagesMock, mockBookTabsApi } from '../mocks';

	const noop = () => {};
</script>

<!-- ══ BØKER ══════════════════════════════════════════════════════════════ -->
<section id="boker" class="section">
	<h2 class="section-heading">Bøker</h2>
	<p class="section-desc">
		Bok-temaets komponenter (<code>domain/Book*</code>) — på <code>--book-*</code>-tokens og med
		injisert nettverkslag (<code>BookTabsApi</code>). Kontekst- og chat-taben demoes ikke ennå.
	</p>

	<h3 class="subsection">BookHeaderBar — bokheader med fremdrift</h3>
	<div class="demo-card demo-card--wide">
		<BookHeaderBar
			book={bookMock}
			progressEditorOpen={false}
			progressPage="148"
			posHours={4}
			posMins={23}
			totalDurHours={6}
			totalDurMins={52}
			progressSaving={false}
			progressError=""
			onClose={noop}
			onToggleEditor={noop}
			onSaveProgress={noop}
			onCancelEditor={noop}
			onProgressPageChange={noop}
			onPosHoursChange={noop}
			onPosMinsChange={noop}
		/>
	</div>

	<h3 class="subsection">BookHeaderBar — fremdriftseditor åpen</h3>
	<div class="demo-card demo-card--wide">
		<BookHeaderBar
			book={bookMock}
			progressEditorOpen={true}
			progressPage="148"
			posHours={4}
			posMins={23}
			totalDurHours={6}
			totalDurMins={52}
			progressSaving={false}
			progressError=""
			onClose={noop}
			onToggleEditor={noop}
			onSaveProgress={noop}
			onCancelEditor={noop}
			onProgressPageChange={noop}
			onPosHoursChange={noop}
			onPosMinsChange={noop}
		/>
	</div>

	<h3 class="subsection">BookFaktaTab — fremdriftsgraf, ETA og fakta</h3>
	<div class="demo-card demo-card--wide">
		<BookFaktaTab themeId="demo" book={bookMock} onBookUpdated={noop} onBookDeleted={noop} api={mockBookTabsApi} today={new Date('2026-06-12T12:00:00')} />
	</div>

	<h3 class="subsection">BookClipsTab — klipp med karaoke-spiller</h3>
	<p class="section-desc">
		Første klipp har ord-tidsstempler → AudioKaraokePlayer rendres (lyd-src er tom i demoen,
		så avspilling er inert men teksten og spillerlinja er live).
	</p>
	<div class="demo-card demo-card--wide">
		<BookClipsTab themeId="demo" book={bookMock} api={mockBookTabsApi} />
	</div>

	<h3 class="subsection">BookContextTab — kontekstpakke</h3>
	<div class="demo-card demo-card--wide">
		<BookContextTab book={bookWithPackMock} themeId="demo" onRefresh={async () => {}} api={mockBookTabsApi} />
	</div>

	<h3 class="subsection">BookChatTab — boksamtale</h3>
	<p class="section-desc">
		Chat om boka med klipp-referanser. Streaming/opplasting/transkripsjon går via api-prop — mock her.
	</p>
	<div class="demo-card demo-card--wide">
		<BookChatTab
			themeId="demo"
			book={bookMock}
			clips={bookClipsMock}
			chatMessages={bookChatMessagesMock}
			chatMessagesLoaded={true}
			onAutoProgress={noop}
			onClipAdded={noop}
			onChatMessage={noop}
			api={mockBookTabsApi}
		/>
	</div>
</section>
