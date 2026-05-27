<script lang="ts">
	import { AppPage, PageHeader } from '$lib/components/ui';
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let goal = $state('');
	let durationWeeks = $state(8);
	let sessionsPerWeek = $state(4);
	let includeStrength = $state(true);
	let includeRunning = $state(true);
	let includeBaselineTests = $state(false);
	let useAthleteSnapshot = $state(true);
	let experience = $state<'beginner' | 'intermediate' | 'advanced' | ''>('');
	let name = $state('');
	let startDate = $state(todayISO());

	let submitting = $state(false);
	let errorMessage = $state<string | null>(null);

	function todayISO(): string {
		return new Date().toISOString().slice(0, 10);
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (!goal.trim()) {
			errorMessage = 'Beskriv målet med programmet';
			return;
		}
		if (!includeStrength && !includeRunning) {
			errorMessage = 'Velg minst styrke eller løping';
			return;
		}
		submitting = true;
		errorMessage = null;
		try {
			const res = await fetch('/api/apps/programs/generate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					goal: goal.trim(),
					durationWeeks,
					sessionsPerWeek,
					includeStrength,
					includeRunning,
					includeBaselineTests,
					useAthleteSnapshot,
					experience: experience || undefined,
					name: name.trim() || undefined,
					startDate
				})
			});
			const body = await res.json();
			if (!res.ok) {
				errorMessage =
					body.error ??
					(res.status === 422 ? 'Generatoren produserte et ugyldig program — prøv igjen' : 'Noe gikk galt');
				submitting = false;
				return;
			}
			await goto(`/treningsprogram/${body.programId}`);
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Nettverksfeil';
			submitting = false;
		}
	}
</script>

<AppPage>
	<PageHeader title="Lag treningsprogram" subtitle="LLM-generert hybridprogram" backHref="/treningsprogram" />

	<form class="form" onsubmit={handleSubmit}>
		<section class="field">
			<label for="goal">Hva er målet?</label>
			<textarea
				id="goal"
				bind:value={goal}
				placeholder="Halvmaraton om 12 uker, men jeg vil holde styrken min også"
				rows="3"
				required
			></textarea>
			<p class="hint">
				Vær konkret om distanse, dato og hva du ønsker å beholde — generatoren bygger programmet
				rundt dette.
			</p>
		</section>

		<section class="row">
			<div class="field">
				<label for="durationWeeks">Varighet (uker)</label>
				<input
					id="durationWeeks"
					type="number"
					min="1"
					max="16"
					bind:value={durationWeeks}
				/>
			</div>
			<div class="field">
				<label for="sessionsPerWeek">Økter per uke</label>
				<input
					id="sessionsPerWeek"
					type="number"
					min="1"
					max="7"
					bind:value={sessionsPerWeek}
				/>
			</div>
		</section>

		<section class="field">
			<span class="label-text">Type</span>
			<div class="check-row">
				<label class="check">
					<input type="checkbox" bind:checked={includeStrength} />
					Styrke
				</label>
				<label class="check">
					<input type="checkbox" bind:checked={includeRunning} />
					Løping
				</label>
			</div>
		</section>

		<section class="field">
			<label for="experience">Erfaringsnivå (valgfritt)</label>
			<select id="experience" bind:value={experience}>
				<option value="">Ikke angi</option>
				<option value="beginner">Nybegynner</option>
				<option value="intermediate">Middels</option>
				<option value="advanced">Erfaren</option>
			</select>
		</section>

		<section class="field">
			<label for="startDate">Startdato</label>
			<input id="startDate" type="date" bind:value={startDate} />
		</section>

		<section class="field">
			<label for="name">Navn på programmet (valgfritt)</label>
			<input id="name" type="text" bind:value={name} placeholder="Halvmaraton + styrke" />
		</section>

		<section class="field toggles">
			<label class="check">
				<input type="checkbox" bind:checked={useAthleteSnapshot} />
				<span>
					<strong>Bruk historikken min</strong>
					<small>
						{#if data.snapshot}
							{#if data.snapshot.dataQuality === 'rich'}
								Vi har VDOT {data.snapshot.vdotEstimate ?? '–'} og {data.snapshot.recentVolumeKm} km/uke
								i basisen — generatoren bygger på dette.
							{:else if data.snapshot.dataQuality === 'thin'}
								Vi har litt data ({data.snapshot.recentSessionsPerWeek} økter/uke) — vi bruker
								konservative defaults.
							{:else}
								Vi mangler historikk — generatoren bruker bare det du fyller ut over.
							{/if}
						{:else}
							Trekker PR-er og volum siste 4 uker inn i prompten.
						{/if}
					</small>
				</span>
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={includeBaselineTests} />
				<span>
					<strong>Inkluder baseline-tester i uke 1</strong>
					<small>
						Én løps-test (Cooper 12 min eller 5k tempo) + én styrketest — gjør at programmet
						kan rekalibrere seg når du tester deg.
					</small>
				</span>
			</label>
		</section>

		{#if errorMessage}
			<p class="error">{errorMessage}</p>
		{/if}

		<div class="submit-row">
			<button class="primary" type="submit" disabled={submitting}>
				{#if submitting}
					Genererer… (10–30 sek)
				{:else}
					Lag program
				{/if}
			</button>
			<a class="cancel" href="/treningsprogram">Avbryt</a>
		</div>
	</form>
</AppPage>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: 20px;
		max-width: 560px;
	}
	.row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.field label,
	.label-text {
		font-size: 13px;
		font-weight: 600;
		color: var(--text-primary);
	}
	.hint {
		font-size: 12px;
		color: var(--text-tertiary);
		margin: 0;
	}
	textarea,
	input[type='text'],
	input[type='number'],
	input[type='date'],
	select {
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
		border-radius: 10px;
		padding: 10px 12px;
		color: var(--text-primary);
		font: inherit;
		font-size: 15px;
	}
	textarea {
		resize: vertical;
	}
	textarea:focus,
	input:focus,
	select:focus {
		outline: none;
		border-color: var(--accent-primary);
	}
	.check-row {
		display: flex;
		gap: 16px;
	}
	.check {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		font-size: 14px;
		color: var(--text-primary);
		cursor: pointer;
	}
	.check input {
		margin-top: 2px;
	}
	.toggles {
		gap: 12px;
	}
	.toggles .check {
		padding: 12px;
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
		border-radius: 10px;
	}
	.toggles .check span {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.toggles strong {
		font-weight: 600;
	}
	.toggles small {
		color: var(--text-secondary);
		font-size: 12px;
		line-height: 1.4;
	}
	.error {
		color: #ff6b6b;
		font-size: 14px;
		margin: 0;
	}
	.submit-row {
		display: flex;
		gap: 12px;
		align-items: center;
		margin-top: 8px;
	}
	.primary {
		padding: 12px 24px;
		border-radius: 999px;
		background: var(--accent-primary);
		color: var(--bg-primary);
		font-weight: 600;
		font-size: 15px;
		border: none;
		cursor: pointer;
	}
	.primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.cancel {
		color: var(--text-secondary);
		text-decoration: none;
		font-size: 14px;
	}
</style>
