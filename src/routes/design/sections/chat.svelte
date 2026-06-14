<script lang="ts">
	import { ChatInput } from '$lib/components/ui';
	import TriageCard from '$lib/components/composed/TriageCard.svelte';
	import ChatMessages from '$lib/components/ui/ChatMessages.svelte';
	import { chatMessagesMock } from '../mocks';

	let lastSent = $state('');
	const noop = () => {};
</script>

<!-- ══ CHAT ═══════════════════════════════════════════════════════════════ -->
<section id="chat" class="section">
	<h2 class="section-heading">Chat</h2>
	<p class="section-desc">
		Bot-svar i chat-flatene (hjem, temasider) rendres som <code>TriageCard</code> — med tenketilstand,
		streaming, markdown og triage-handlinger. Under: live komponent i alle tilstander.
	</p>

	<h3 class="subsection">TriageCard — tilstander</h3>
	<div class="chat-demo">
		<TriageCard loading steps={['Henter vektdata fra Withings', 'Sammenligner med forrige måned']} />
	</div>
	<p class="demo-caption">Tenker — med ekspanderbare steg</p>

	<div class="chat-demo">
		<TriageCard streaming text="Du har veid deg 14 ganger siste 30 dager. Trenden er **−1,1 kg**, og du ligger" />
	</div>
	<p class="demo-caption">Streaming — markøren pulserer mens svaret kommer</p>

	<div class="chat-demo">
		<TriageCard
			text={'Du har veid deg 14 ganger siste 30 dager. Trenden er **−1,1 kg**, og du ligger litt bak planen mot 88 kg.\n\nVil du justere målet eller fortsette som nå?'}
			actions={[
				{ label: 'Fortsett som nå', onclick: noop },
				{ label: 'Juster målet', onclick: noop }
			]}
		/>
	</div>
	<p class="demo-caption">Ferdig svar med triage-handlinger</p>

	<div class="chat-demo">
		<TriageCard stopped text="Jeg begynte å hente treningsdataene dine, men ble" />
	</div>
	<p class="demo-caption">Avbrutt av brukeren</p>

	<h3 class="subsection">ChatMessages — meldingslisten</h3>
	<p class="section-desc">
		Den delte meldingslisten for alle chat-flater: brukerbobler, bot-svar (TriageCard), stjernemerking
		og handlingsknapper. Demoen viser også en pågående streaming-melding nederst.
	</p>
	<div class="chat-demo chat-demo--wide">
		<ChatMessages
			messages={chatMessagesMock}
			streamingText="Ser på treningsdataene dine — du har"
			onAction={noop}
			onStarMessage={noop}
		/>
	</div>

	<h3 class="subsection">ChatInput</h3>
	<p class="section-desc">
		Gjenbrukbar meldingsboks med auto-resize textarea — samme komponent som på hjemskjermen og temasidene.
	</p>
	<div class="demo-stack">
		<ChatInput
			placeholder="Skriv en melding…"
			onsubmit={(msg) => (lastSent = msg)}
		/>
		{#if lastSent}
			<p class="demo-caption">Sendt: «{lastSent}»</p>
		{/if}
	</div>
</section>
