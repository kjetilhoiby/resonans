<script lang="ts">
	/**
	 * Dosekalenderen — «har jeg tatt den, og når er den neste».
	 *
	 * Kortet leder med NESTE DOSE på tvers av kurene. Det er spørsmålet man har
	 * med to medisiner på ulik frekvens, og det eneste man ikke kan holde i hodet.
	 *
	 * En fast kur er en rad SLOTS man haker av; en ved-behov-kur er en knapp og en
	 * teller. To ulike former fordi de stiller to ulike spørsmål — se
	 * modulkommentaren i `$lib/domain/health/medications.ts`.
	 *
	 * Vi varsler ikke og vurderer ingenting. «Klar nå» er aritmetikk mot din egen
	 * plan, ikke en formaning.
	 */
	import DateInput from '$lib/components/ui/DateInput.svelte';
	import { extractApiErrorMessage } from '$lib/client/api-error';
	import {
		MEDICATION_RHYTHMS,
		MEDICATION_RHYTHM_LABELS,
		type DoseSlot,
		type MedicationDay,
		type MedicationRhythm
	} from '$lib/domain/health/medications';

	interface MedicationView {
		id: string;
		name: string;
		purpose: string | null;
		rhythm: MedicationRhythm;
		times: string[];
		startDate: string;
		endDate: string | null;
		ongoing: boolean;
		days: number;
		tracksDoses: boolean;
		today: MedicationDay;
		todayText: string | null;
		calendar: MedicationDay[];
	}

	interface Payload {
		today: string;
		now: string;
		days: string[];
		next: { medicationId: string; name: string; time: string; day: string } | null;
		medications: MedicationView[];
	}

	let data = $state<Payload | null>(null);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let adding = $state(false);
	let showCalendar = $state(false);

	let newName = $state('');
	let newPurpose = $state('');
	let newRhythm = $state<MedicationRhythm>('fast');
	let newCount = $state(3);
	let newStart = $state('');

	const ongoing = $derived(data?.medications.filter((m) => m.ongoing) ?? []);
	const past = $derived(data?.medications.filter((m) => !m.ongoing) ?? []);

	const nextText = $derived.by(() => {
		const n = data?.next;
		if (!n) return null;
		const when = n.day === data?.today ? `kl. ${n.time}` : `i morgen kl. ${n.time}`;
		return `${n.name} ${when}`;
	});

	async function call(url: string, init: RequestInit) {
		if (busy) return;
		busy = true;
		error = null;
		try {
			const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
			if (!res.ok) {
				// Serverens melding er skrevet for å leses — «har ingen dose kl. 11:00»
				// er en beskjed man kan rette seg etter.
				error = extractApiErrorMessage(res.status, await res.text());
				return;
			}
			data = await res.json();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Klarte ikke å lagre.';
		} finally {
			busy = false;
		}
	}

	async function load() {
		const res = await fetch('/api/helse/medisiner');
		if (res.ok) data = await res.json();
	}
	void load();

	async function addMedication() {
		const name = newName.trim();
		if (!name) return;
		await call('/api/helse/medisiner', {
			method: 'POST',
			body: JSON.stringify({
				name,
				purpose: newPurpose.trim() || null,
				rhythm: newRhythm,
				// Et ANTALL, ikke klokkeslett: serveren slår opp standardtidene, så
				// ingen må skrive dem for hånd for å komme i gang.
				times: newRhythm === 'fast' ? newCount : undefined,
				startDate: newStart || undefined
			})
		});
		if (!error) {
			newName = '';
			newPurpose = '';
			newStart = '';
			adding = false;
		}
	}

	/** Hak av en planlagt dose. Sloten sies eksplisitt — aldri utledet av klokka. */
	const takeSlot = (id: string, slot: string) =>
		call(`/api/helse/medisiner/${id}/dose`, { method: 'POST', body: JSON.stringify({ slot }) });

	/** Ved behov, eller en ekstradose utenom planen. */
	const takeDose = (id: string) =>
		call(`/api/helse/medisiner/${id}/dose`, { method: 'POST', body: JSON.stringify({}) });

	/** Angre. Et feiltrykk skal kunne fjernes — kalenderen er ellers ikke til å stole på. */
	const undoDose = (doseId: string) =>
		call(`/api/helse/medisiner/dose/${doseId}`, { method: 'DELETE' });

	const endCourse = (id: string) =>
		call(`/api/helse/medisiner/${id}`, { method: 'PATCH', body: JSON.stringify({ action: 'end' }) });

	const remove = (id: string) => call(`/api/helse/medisiner/${id}`, { method: 'DELETE' });

	const SLOT_LABEL: Record<DoseSlot['status'], string> = {
		taken: 'Tatt',
		due: 'Klar nå',
		upcoming: 'Kommer',
		missed: 'Ikke tatt'
	};

	/** «14.»/«15.» under kalenderstripa. */
	const dayNum = (day: string) => Number(day.slice(8));
</script>

<div class="med-card">
	<div class="med-head">
		<span class="med-icon" aria-hidden="true">💊</span>
		<div class="med-head-text">
			<h3>Medisiner</h3>
			<p class="med-sub">
				{#if nextText}
					Neste: {nextText}
				{:else if ongoing.length > 0}
					Ingen flere planlagte doser i dag.
				{:else}
					Legg inn det du går på, så får du en dosekalender.
				{/if}
			</p>
		</div>
		{#if !adding}
			<button
				class="med-btn"
				type="button"
				disabled={busy}
				data-track="helse-medisin:legg-til"
				onclick={() => (adding = true)}
			>Legg til</button>
		{/if}
	</div>

	{#if error}
		<p class="med-error" role="alert">{error}</p>
	{/if}

	{#each ongoing as m (m.id)}
		<div class="med-kur">
			<div class="med-kur-topp">
				<span class="med-name">{m.name}</span>
				{#if m.purpose}<span class="med-purpose">{m.purpose}</span>{/if}
				<button
					class="med-link"
					type="button"
					disabled={busy}
					aria-label="Avslutt {m.name}"
					data-track="helse-medisin:avslutt"
					onclick={() => void endCourse(m.id)}
				>Avslutt</button>
			</div>

			{#if m.todayText}
				<p class="med-status">{m.todayText}</p>
			{/if}

			{#if m.rhythm === 'fast'}
				<!--
					Dagens slots. Trykk haker av NETTOPP den sloten — vi gjetter aldri
					hvilken en dose hører til ut fra klokka, siden «jeg tok morgendosen
					kl. 11» er helt vanlig.
				-->
				<div class="med-slots">
					{#each m.today.slots as slot (slot.time)}
						{#if slot.status === 'taken'}
							<button
								class="med-slot is-taken"
								type="button"
								disabled={busy}
								data-track="helse-medisin:angre-dose"
								aria-label="Angre dosen kl. {slot.time}"
								onclick={() => slot.doseId && void undoDose(slot.doseId)}
							>
								<span class="med-slot-tid">{slot.time}</span>
								<span class="med-slot-merke">✓</span>
							</button>
						{:else}
							<button
								class="med-slot"
								class:is-due={slot.status === 'due'}
								type="button"
								disabled={busy || slot.status === 'upcoming'}
								data-track="helse-medisin:ta-dose"
								aria-label="Hak av dosen kl. {slot.time} ({SLOT_LABEL[slot.status]})"
								onclick={() => void takeSlot(m.id, slot.time)}
							>
								<span class="med-slot-tid">{slot.time}</span>
								<span class="med-slot-merke">{slot.status === 'due' ? '+' : '·'}</span>
							</button>
						{/if}
					{/each}
				</div>
				{#if m.today.extra.length > 0}
					<p class="med-note">
						{m.today.extra.length} ekstra{m.today.extra.length === 1 ? 'dose' : 'doser'} utenom planen i dag.
					</p>
				{/if}
			{:else}
				<div class="med-slots">
					<button
						class="med-btn med-btn--dose"
						type="button"
						disabled={busy}
						data-track="helse-medisin:dose"
						onclick={() => void takeDose(m.id)}
					>+ Dose nå</button>
					{#each m.today.extra as d (d.id)}
						<button
							class="med-slot is-taken"
							type="button"
							disabled={busy}
							aria-label="Angre dosen"
							data-track="helse-medisin:angre-dose"
							onclick={() => void undoDose(d.id)}
						>
							<span class="med-slot-tid">{d.takenAt.slice(11, 16)}</span>
							<span class="med-slot-merke">✓</span>
						</button>
					{/each}
				</div>
			{/if}
		</div>
	{/each}

	{#if adding}
		<div class="med-form">
			<label class="med-field">
				<span>Navn</span>
				<input type="text" bind:value={newName} placeholder="Paracet" data-track="helse-medisin:navn" />
			</label>
			<label class="med-field">
				<span>Hva du forventer</span>
				<input type="text" bind:value={newPurpose} placeholder="mot hodepine" data-track="helse-medisin:forventning" />
			</label>
			<div class="med-field">
				<span>Rytme</span>
				<div class="med-chips">
					{#each MEDICATION_RHYTHMS as r (r)}
						<button
							class="med-chip"
							class:is-on={newRhythm === r}
							type="button"
							data-track="helse-medisin:rytme"
							onclick={() => (newRhythm = r)}
						>{MEDICATION_RHYTHM_LABELS[r]}</button>
					{/each}
				</div>
			</div>
			{#if newRhythm === 'fast'}
				<div class="med-field">
					<span>Doser per dag</span>
					<div class="med-chips">
						{#each [1, 2, 3, 4] as n (n)}
							<button
								class="med-chip"
								class:is-on={newCount === n}
								type="button"
								data-track="helse-medisin:antall"
								onclick={() => (newCount = n)}
							>{n} ×</button>
						{/each}
					</div>
					<p class="med-note">Klokkeslettene settes automatisk, og kan rettes etterpå.</p>
				</div>
			{:else}
				<p class="med-note">Ved behov: ingen plan. Du haker av hver dose, og antallet per dag telles.</p>
			{/if}
			<label class="med-field">
				<span>Startet</span>
				<DateInput bind:value={newStart} max={data?.today} dataTrack="helse-medisin:startdato" />
			</label>
			<div class="med-form-actions">
				<button class="med-btn med-btn--primary" type="button" disabled={busy} onclick={() => void addMedication()}>Lagre</button>
				<button class="med-link" type="button" onclick={() => { adding = false; error = null; }}>Avbryt</button>
			</div>
		</div>
	{/if}

	{#if ongoing.length > 0}
		<details class="med-history" bind:open={showCalendar}>
			<summary>Siste to uker</summary>
			{#each ongoing as m (m.id)}
				<div class="med-kalender">
					<span class="med-kalender-navn">{m.name}</span>
					<div class="med-stripe">
						{#each m.calendar as day (day.day)}
							{@const done = day.slots.filter((s) => s.status === 'taken').length}
							{@const full = day.planned > 0 ? done === day.planned : day.taken > 0}
							<!--
								Dekningen per dag. En dag UTENFOR kuren er tom, ikke null doser:
								skillet er det samme som `0` mot `null` i doseraden.
							-->
							<div
								class="med-dag"
								class:ute={!day.inCourse}
								class:hel={day.inCourse && full}
								class:delvis={day.inCourse && !full && day.taken > 0}
								title="{day.day}: {day.planned > 0 ? `${done} av ${day.planned}` : `${day.taken} doser`}"
							>
								<span class="med-dag-tall">{dayNum(day.day)}</span>
							</div>
						{/each}
					</div>
				</div>
			{/each}
			<p class="med-note">
				Fylt = alle planlagte doser haket av. Halvfylt = noen. Tom = ingen, eller en dag kuren
				ikke dekket.
			</p>
		</details>
	{/if}

	{#if past.length > 0}
		<details class="med-history">
			<summary>Avsluttede kurer ({past.length})</summary>
			{#each past as m (m.id)}
				<div class="med-kur-topp">
					<span class="med-name">{m.name}</span>
					<span class="med-purpose">{m.startDate}–{m.endDate}</span>
					<button
						class="med-link med-link--danger"
						type="button"
						disabled={busy}
						aria-label="Slett {m.name}"
						onclick={() => void remove(m.id)}
					>Slett</button>
				</div>
			{/each}
		</details>
	{/if}
</div>

<style>
	.med-card {
		background: var(--bg-card, #141414);
		border: 1px solid var(--border-color, #2a2a2a);
		border-radius: 14px;
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.med-head { display: flex; align-items: flex-start; gap: 12px; }
	.med-icon { font-size: 22px; line-height: 1.2; }
	.med-head-text { flex: 1; min-width: 0; }
	.med-head-text h3 { margin: 0; font-size: 15px; color: var(--text-primary); }
	.med-sub { margin: 2px 0 0; font-size: 12px; line-height: 1.45; color: var(--text-tertiary); }

	.med-kur {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 10px 12px;
		border-radius: 10px;
		background: var(--bg-input, #111);
	}
	.med-kur-topp { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
	.med-name { font-size: 14px; color: var(--text-primary); }
	.med-purpose { font-size: 12px; color: var(--text-tertiary); flex: 1; min-width: 0; }
	.med-status { margin: 0; font-size: 12px; color: var(--text-secondary); }

	.med-slots { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
	/*
	 * Sloten er en knapp med tid og status. Størrelsen er den samme uansett
	 * status — en slot som krymper når den er tatt ville flyttet naboene, og
	 * kolonnen skal stå i ro gjennom dagen.
	 */
	.med-slot {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 76px;
		justify-content: space-between;
		background: transparent;
		border: 1px solid var(--border-color, #2a2a2a);
		border-radius: 999px;
		padding: 7px 12px;
		font-size: 13px;
		color: var(--text-tertiary);
		cursor: pointer;
	}
	.med-slot:disabled { cursor: default; opacity: 0.55; }
	.med-slot.is-due {
		border-color: var(--accent-primary, #4a7fb5);
		color: var(--text-primary);
	}
	.med-slot.is-taken {
		border-color: var(--success-border, #3d6b4a);
		color: var(--success-text, #7dbd8e);
	}
	.med-slot-tid { font-variant-numeric: tabular-nums; }
	.med-slot-merke { opacity: 0.8; }

	.med-btn {
		flex-shrink: 0;
		background: var(--bg-input, #111);
		border: 1px solid var(--border-color, #2a2a2a);
		color: var(--text-secondary);
		border-radius: 999px;
		padding: 7px 14px;
		font-size: 13px;
		cursor: pointer;
	}
	.med-btn:hover:not(:disabled) { color: var(--text-primary); border-color: var(--accent-primary); }
	.med-btn:disabled { opacity: 0.5; cursor: default; }
	.med-btn--primary { border-color: var(--accent-warning, #b8863b); color: var(--text-primary); }
	.med-btn--dose { border-color: var(--accent-primary, #4a7fb5); color: var(--text-primary); }

	.med-link {
		background: none;
		border: none;
		color: var(--text-tertiary);
		font-size: 12px;
		cursor: pointer;
		text-decoration: underline;
		padding: 0;
	}
	.med-link:hover:not(:disabled) { color: var(--text-primary); }
	.med-link:disabled { opacity: 0.5; cursor: default; }
	.med-link--danger:hover:not(:disabled) { color: var(--accent-danger, #d9534f); }

	.med-form { display: flex; flex-direction: column; gap: 8px; }
	.med-field { display: flex; flex-direction: column; gap: 4px; }
	.med-field > span { font-size: 12px; color: var(--text-tertiary); }
	.med-field input[type='text'] {
		background: var(--bg-input, #111);
		border: 1px solid var(--border-color, #2a2a2a);
		border-radius: 8px;
		color: var(--text-primary);
		padding: 8px 10px;
		font-size: 14px;
	}
	.med-chips { display: flex; gap: 6px; flex-wrap: wrap; }
	.med-chip {
		background: var(--bg-input, #111);
		border: 1px solid var(--border-color, #2a2a2a);
		color: var(--text-secondary);
		border-radius: 999px;
		padding: 6px 12px;
		font-size: 13px;
		cursor: pointer;
	}
	.med-chip.is-on { border-color: var(--accent-warning, #b8863b); color: var(--text-primary); }
	.med-form-actions { display: flex; align-items: center; gap: 12px; }
	.med-note { margin: 0; font-size: 12px; line-height: 1.45; color: var(--text-tertiary); }

	.med-error { margin: 0; font-size: 12px; color: var(--accent-danger, #d9534f); }

	.med-history { font-size: 13px; }
	.med-history summary {
		cursor: pointer;
		color: var(--text-tertiary);
		font-size: 12px;
		padding: 2px 0;
	}

	.med-kalender { margin-top: 8px; }
	.med-kalender-navn { font-size: 12px; color: var(--text-tertiary); }
	.med-stripe { display: flex; gap: 3px; margin-top: 4px; }
	.med-dag {
		flex: 1;
		min-width: 0;
		aspect-ratio: 1;
		max-width: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 5px;
		border: 1px solid var(--border-color, #2a2a2a);
		font-size: 10px;
		color: var(--text-tertiary);
	}
	.med-dag-tall { font-variant-numeric: tabular-nums; }
	/* Dekning, ikke en dom: fylt er alle planlagte doser, ikke «bra». */
	.med-dag.hel { background: var(--success-border, #3d6b4a); color: var(--text-primary); }
	.med-dag.delvis { background: rgba(61, 107, 74, 0.4); color: var(--text-secondary); }
	/* Utenfor kuren: ingen ramme heller — det er ikke en dag med null doser. */
	.med-dag.ute { border-color: transparent; opacity: 0.35; }
</style>
