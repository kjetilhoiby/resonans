<script lang="ts">
	import { Input, Textarea, Select, Checkbox, StatusBadge, DateInput, TimeInput } from '$lib/components/ui';

	let moodVal = $state(62);
	const moodLabel = $derived(
		moodVal < 22 ? 'Tung' :
		moodVal < 42 ? 'Flat' :
		moodVal < 62 ? 'OK'   :
		moodVal < 82 ? 'Bra' : 'Strålende'
	);
	const moodEmoji = $derived(
		moodVal < 22 ? '😔' :
		moodVal < 42 ? '😐' :
		moodVal < 62 ? '🙂' :
		moodVal < 82 ? '😊' : '🤩'
	);
</script>

<!-- ══ SKJEMA ═════════════════════════════════════════════════════════════ -->
<section id="skjema" class="section">
	<h2 class="section-heading">Skjema</h2>
	<p class="section-desc">
		Skjemakomponentene fra <code>ui/</code> — brukt i innstillinger, flows og dashboards.
	</p>

	<h3 class="subsection">Felt-komponenter</h3>
	<div class="input-demo">
		<Input placeholder="Hva tenker du på?" />
		<Textarea placeholder="Lengre notat…" />
		<Select value="uke">
			<option value="uke">Uke</option>
			<option value="måned">Måned</option>
			<option value="år">År</option>
		</Select>
		<label style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem; color: #aaa;">
			<Checkbox checked /> Aktivert
		</label>
	</div>

	<h3 class="subsection">DateInput + TimeInput — dato og klokkeslett</h3>
	<p class="section-desc">
		Appens dato- og tidsfelt — tynne wrappere over <code>.ds-input</code> med <code>color-scheme: dark</code>,
		så native kalender/tidvelger og ikonene deres er synlige på mørk bakgrunn.
		Bruk disse — aldri rå <code>&lt;input type="date"&gt;</code>.
	</p>
	<div class="demo-row" style="align-items: center;">
		<DateInput value="2026-06-11" ariaLabel="Dato" />
		<DateInput value="2026-06-11" min="2026-06-01" max="2026-06-30" ariaLabel="Dato med min/maks" />
		<DateInput disabled value="2026-06-11" ariaLabel="Deaktivert dato" />
		<TimeInput value="06:45" />
	</div>

	<h3 class="subsection">StatusBadge</h3>
	<p class="section-desc">Toner: <code>ok | warn | error | off</code> — som dot eller tekst.</p>
	<div class="demo-row" style="align-items: center;">
		<StatusBadge tone="ok" text="Tilkoblet" dot />
		<StatusBadge tone="warn" text="Utløper snart" dot />
		<StatusBadge tone="error" text="Feilet" dot />
		<StatusBadge tone="off" text="Ikke aktiv" dot />
		<StatusBadge tone="ok" text="Tilkoblet" />
	</div>

	<h3 class="subsection">Slider (flow-felttype)</h3>
	<p class="section-desc">
		Felttypen <code>slider</code> i <code>FlowFormStep</code> — brukes i egenfrekvens-sjekkin (1–5 med nivå-labels).
		Demoen bruker den globale <code>.ds-slider</code>-klassen.
	</p>
	<div class="input-demo">
		<div class="mood-display">
			<span class="mood-emoji">{moodEmoji}</span>
			<span class="mood-label">{moodLabel}</span>
		</div>
		<input
			type="range" min="0" max="100" step="1"
			class="ds-slider" style="--pct:{moodVal}%"
			bind:value={moodVal}
		/>
	</div>
</section>
