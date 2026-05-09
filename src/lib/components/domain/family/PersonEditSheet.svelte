<script lang="ts">
	import SpondGroupPicker from './SpondGroupPicker.svelte';
	import { ALL_PERSON_KINDS, PERSON_KINDS, type PersonKind } from '$lib/domains/family';

	interface PersonInput {
		id: string;
		name: string;
		fullName: string | null;
		nickname: string | null;
		birthDate: string | null;
		kind: string;
		avatarEmoji: string | null;
		notes: string | null;
		spondGroupIds: string[];
		emailAddresses: string[];
		aliases: string[];
	}

	interface Props {
		person: PersonInput;
		onClose: () => void;
		onSaved: (next: PersonInput) => void;
	}

	let { person, onClose, onSaved }: Props = $props();

	// Initialiser state fra prop-verdiene; Svelte advarer mot direkte ref, men
	// her er det ønsket: skjemaet skal kun nullstilles når komponenten remountes.
	const initial = $derived(person);
	let name = $state('');
	let nickname = $state('');
	let kind = $state<PersonKind>('other');
	let birthDate = $state('');
	let avatarEmoji = $state('');
	let notes = $state('');
	let aliases = $state('');
	let spondGroupIds = $state<string[]>([]);

	$effect(() => {
		name = initial.name;
		nickname = initial.nickname ?? '';
		kind = initial.kind as PersonKind;
		birthDate = initial.birthDate ?? '';
		avatarEmoji = initial.avatarEmoji ?? '';
		notes = initial.notes ?? '';
		aliases = (initial.aliases ?? []).join(', ');
		spondGroupIds = initial.spondGroupIds ?? [];
	});
	let saving = $state(false);
	let error = $state<string | null>(null);
	let backfilledMessage = $state<string | null>(null);

	async function save() {
		saving = true;
		error = null;
		backfilledMessage = null;
		try {
			const res = await fetch(`/api/persons/${person.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					name: name.trim(),
					nickname: nickname.trim() || null,
					kind,
					birthDate: birthDate || null,
					avatarEmoji: avatarEmoji.trim() || null,
					notes: notes.trim() || null,
					aliases: aliases.split(',').map((s) => s.trim()).filter(Boolean),
					spondGroupIds
				})
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body.error ?? 'Kunne ikke lagre');
			}
			const body = await res.json();
			if (body.backfilled && body.backfilled > 0) {
				backfilledMessage = `Tagget ${body.backfilled} eksisterende Spond-events til ${name}.`;
			}
			onSaved(body.person);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Ukjent feil';
		} finally {
			saving = false;
		}
	}
</script>

<div class="edit-sheet" role="dialog" aria-label={`Rediger ${person.name}`}>
	<header>
		<h2>Rediger {person.name}</h2>
		<button class="ghost" onclick={onClose}>Lukk</button>
	</header>

	<form onsubmit={(e) => { e.preventDefault(); void save(); }}>
		<label>
			<span>Navn</span>
			<input type="text" bind:value={name} required />
		</label>

		<label>
			<span>Kallenavn (valgfritt)</span>
			<input type="text" bind:value={nickname} placeholder="bestemor, bestefar, …" />
		</label>

		<label>
			<span>Type</span>
			<select bind:value={kind}>
				{#each ALL_PERSON_KINDS as k}
					<option value={k}>{PERSON_KINDS[k].emoji} {PERSON_KINDS[k].label}</option>
				{/each}
			</select>
		</label>

		<label>
			<span>Fødselsdato</span>
			<input type="date" bind:value={birthDate} />
		</label>

		<label>
			<span>Avatar (emoji)</span>
			<input type="text" bind:value={avatarEmoji} maxlength="4" placeholder="🧒" />
		</label>

		<label>
			<span>Aliaser (komma-separert) — for navne-match i chat</span>
			<input type="text" bind:value={aliases} placeholder="Erlemus, lille-E" />
		</label>

		<label>
			<span>Notater</span>
			<textarea bind:value={notes} rows="3"></textarea>
		</label>

		<fieldset>
			<legend>Spond-grupper</legend>
			<p class="hint">
				Velg gruppene der denne personen er medlem. Eksisterende events for valgte grupper får automatisk personId.
			</p>
			<SpondGroupPicker
				selectedGroupIds={spondGroupIds}
				currentPersonId={person.id}
				onChange={(next) => (spondGroupIds = next)}
			/>
		</fieldset>

		{#if error}<p class="error">{error}</p>{/if}
		{#if backfilledMessage}<p class="info">{backfilledMessage}</p>{/if}

		<div class="actions">
			<button class="primary" type="submit" disabled={saving}>
				{saving ? 'Lagrer…' : 'Lagre'}
			</button>
		</div>
	</form>
</div>

<style>
	.edit-sheet {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1rem;
		background: var(--surface-1, #fff);
		border-radius: 16px;
		max-height: 85vh;
		overflow: auto;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	h2 { margin: 0; font-size: 1.15rem; }
	form {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-size: 0.85rem;
	}
	label > span { font-weight: 500; opacity: 0.85; }
	input, select, textarea {
		padding: 0.45rem 0.55rem;
		border-radius: 8px;
		border: 1px solid var(--border, #e0e0e3);
		font: inherit;
		background: var(--surface-1, #fff);
	}
	textarea { resize: vertical; }
	fieldset {
		border: 1px solid var(--border, #e0e0e3);
		border-radius: 10px;
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	legend { font-weight: 500; padding: 0 0.4rem; }
	.hint { margin: 0; font-size: 0.8rem; opacity: 0.7; }
	.actions { display: flex; justify-content: flex-end; }
	button {
		padding: 0.5rem 1rem;
		border-radius: 8px;
		border: 1px solid var(--border, #e0e0e3);
		background: var(--surface-2, #f5f5f7);
		font: inherit;
		cursor: pointer;
	}
	button.primary {
		background: linear-gradient(135deg, #7c8ef5, #6072e6);
		color: white;
		border: none;
	}
	button.ghost { background: transparent; }
	.error { color: #c0392b; margin: 0; font-size: 0.85rem; }
	.info { color: #2a6f3a; margin: 0; font-size: 0.85rem; }
</style>
