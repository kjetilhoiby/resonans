<!--
  BodyProfileCard — høyde, kjønn og aktivitetsfaktor, med resultatet synlig.

  Bakgrunnen: `estimateDailyExpenditure` returnerer **null** uten en komplett
  kroppsprofil, framfor å gjette på kroppshøyde. Fram til nå fantes profilen bare som
  endepunkt (`PUT /api/helse/profil`), så feltene måtte settes med curl — og uten dem
  faller ernæringsflaten tilbake til Withings' `totalCalories`, som er nettopp det
  tallet vi ikke stoler på.

  Kortet viser hvileforbrenningen live mens man skriver. Det er ikke pynt: fire tall
  inn og et forbrukstall ut er hele grunnen til å fylle ut skjemaet, og et skjema som
  ikke viser hva det gjør blir ikke fylt ut.

  **Fødselsår spørres ikke om her.** Det bor på fødselsdatoen lenger opp på samme side
  (self-personen), og to felt for samme faktum gir to sannheter når bare ett rettes.
  Mangler datoen, peker kortet dit.
-->
<script lang="ts">
	import { Button, Input } from '$lib/components/ui';
	import { extractApiErrorMessage } from '$lib/client/api-error';
	import {
		ageFromBirthYear,
		validateDeskJobFactor,
		validateHeightCm,
		DESK_FACTOR_MAX,
		DESK_FACTOR_MIN,
		HEIGHT_MAX_CM,
		HEIGHT_MIN_CM
	} from '$lib/domain/health/body-profile-fields';
	import {
		basalMetabolicRate,
		DESK_JOB_FACTOR,
		type Sex
	} from '$lib/domain/health/energy-expenditure';

	interface Props {
		profile: {
			heightCm: number | null;
			birthYear: number | null;
			sex: Sex | null;
			deskJobFactor: number | null;
			birthYearSource: 'profile' | 'person' | null;
		};
		/** Siste vekt fra Withings. Kan ikke skrives inn — derfor egen beskjed. */
		weightKg?: number | null;
	}

	let { profile, weightKg = null }: Props = $props();

	/**
	 * Lokale utkast, slik at feltene kan rettes uten å lagre for hvert tastetrykk.
	 *
	 * Typen er `string | number`, ikke `string`: `bind:value` mot en `type="number"`
	 * **konverterer til tall**, så et felt som starter som «187» er et number etter
	 * første render. Første utgave kalte `.trim()` på verdien og felte hele siden med
	 * «$.get(...).trim is not a function» — en feil enhetstestene strukturelt ikke kan
	 * se, siden de ikke rendrer Svelte.
	 */
	let heightInput = $state<string | number>(profile.heightCm ?? '');
	let sex = $state<Sex | null>(profile.sex);
	let factorInput = $state<string | number>(profile.deskJobFactor ?? '');

	let saving = $state(false);
	let saved = $state(false);
	let error = $state('');
	/** Fødselsåret som gjelder nå, oppdatert etter lagring. */
	let birthYear = $state(profile.birthYear);

	/**
	 * Tallet i et felt, eller null når det er tomt eller ugyldig.
	 *
	 * Komma håndteres for strengtilfellet: `Number('1,4')` er NaN, og komma er det
	 * nordmenn skriver. Et `type="number"`-felt gir oss allerede et tall, så den
	 * grenen slår bare inn hvis feltet en gang byttes til tekst.
	 */
	function parseNumber(raw: string | number | undefined): number | null {
		if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
		if (typeof raw !== 'string') return null;
		const trimmed = raw.trim().replace(',', '.');
		if (!trimmed) return null;
		const value = Number(trimmed);
		return Number.isFinite(value) ? value : null;
	}

	/** Tomt felt — som er lovlig, og ikke det samme som ugyldig. */
	function isBlank(raw: string | number | undefined): boolean {
		if (raw === undefined || raw === null) return true;
		return typeof raw === 'number' ? !Number.isFinite(raw) : raw.trim() === '';
	}

	const heightCm = $derived(parseNumber(heightInput));
	const deskJobFactor = $derived(parseNumber(factorInput));

	/** Feilen i utkastet, før man prøver å lagre. Null når alt er greit. */
	const draftError = $derived.by(() => {
		if (!isBlank(heightInput) && heightCm === null) return 'Høyde må være et tall.';
		if (heightCm !== null) {
			const err = validateHeightCm(heightCm);
			if (err) return err;
		}
		if (!isBlank(factorInput) && deskJobFactor === null) {
			return 'Aktivitetsfaktoren må være et tall.';
		}
		if (deskJobFactor !== null) return validateDeskJobFactor(deskJobFactor);
		return null;
	});

	const age = $derived(ageFromBirthYear(birthYear));

	/**
	 * Hvileforbrenningen utkastet gir. Null så snart ett felt mangler — samme regel
	 * som serveren, så kortet ikke lover et tall flaten ikke får.
	 */
	const basalKcal = $derived(
		draftError
			? null
			: basalMetabolicRate({
					weightKg: weightKg ?? undefined,
					heightCm: heightCm ?? undefined,
					ageYears: age ?? undefined,
					sex: sex ?? undefined
				})
	);

	const factor = $derived(deskJobFactor ?? DESK_JOB_FACTOR);
	const baselineKcal = $derived(basalKcal === null ? null : Math.round(basalKcal * factor));

	const missing = $derived.by(() => {
		const list: string[] = [];
		if (heightCm === null) list.push('høyde');
		if (sex === null) list.push('kjønn');
		if (birthYear === null) list.push('fødselsdato');
		if (weightKg === null) list.push('vekt fra Withings');
		return list;
	});

	function nb(value: number): string {
		return Math.round(value).toLocaleString('nb-NO');
	}

	async function save() {
		if (draftError) {
			error = draftError;
			return;
		}
		saving = true;
		error = '';
		saved = false;
		try {
			const res = await fetch('/api/helse/profil', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ heightCm, sex, deskJobFactor })
			});
			if (!res.ok) throw new Error(extractApiErrorMessage(res.status, await res.text()));
			// Svaret er den lagrede profilen — les fødselsåret derfra, siden serveren
			// kan ha utledet det av fødselsdatoen.
			const stored = await res.json();
			if (typeof stored?.birthYear === 'number') birthYear = stored.birthYear;
			saved = true;
			setTimeout(() => (saved = false), 2200);
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			saving = false;
		}
	}
</script>

<section class="settings-card">
	<div class="card-icon">📐</div>
	<h2>Kroppsprofil</h2>
	<p class="help-text">
		Høyde, kjønn og alder er det Mifflin-St Jeor trenger for å regne hvileforbrenningen din.
		Uten dem faller energibalansen tilbake på Withings' eget tall, som har vist seg upålitelig
		— vi gjetter ikke på kroppshøyde.
	</p>

	<div class="field">
		<label for="body-height">Høyde</label>
		<div class="field-row">
			<Input
				id="body-height"
				className="input"
				type="number"
				inputmode="numeric"
				min={HEIGHT_MIN_CM}
				max={HEIGHT_MAX_CM}
				bind:value={heightInput}
				placeholder="187"
				dataTrack="kroppsprofil:hoyde"
			/>
			<span class="unit">cm</span>
		</div>
	</div>

	<div class="field">
		<span class="label-text" id="body-sex-label">Kjønn</span>
		<p class="field-hint">
			Formelen har to varianter som skiller med 166 kcal. Det er den eneste bruken.
		</p>
		<div class="chips" role="group" aria-labelledby="body-sex-label">
			<button
				type="button"
				class="chip"
				class:is-active={sex === 'male'}
				aria-pressed={sex === 'male'}
				onclick={() => (sex = 'male')}
				data-track="kroppsprofil:kjonn-mann"
			>
				Mann
			</button>
			<button
				type="button"
				class="chip"
				class:is-active={sex === 'female'}
				aria-pressed={sex === 'female'}
				onclick={() => (sex = 'female')}
				data-track="kroppsprofil:kjonn-kvinne"
			>
				Kvinne
			</button>
		</div>
	</div>

	<div class="field">
		<label for="body-factor">Aktivitetsfaktor</label>
		<p class="field-hint">
			Ganges med hvileforbrenningen og dekker søvn, kontorstol, husarbeid og pendling.
			Standard er {String(DESK_JOB_FACTOR).replace('.', ',')} — lav med vilje, fordi
			<strong>treningsøktene legges på toppen</strong>. Setter du den høyt fordi du trener
			mye, teller treningen to ganger.
		</p>
		<div class="field-row">
			<Input
				id="body-factor"
				className="input"
				type="number"
				inputmode="decimal"
				step="0.05"
				min={DESK_FACTOR_MIN}
				max={DESK_FACTOR_MAX}
				bind:value={factorInput}
				placeholder={String(DESK_JOB_FACTOR).replace('.', ',')}
				dataTrack="kroppsprofil:aktivitetsfaktor"
			/>
			<span class="unit">×</span>
		</div>
	</div>

	<div class="field">
		<span class="label-text">Alder</span>
		{#if age !== null}
			<p class="field-hint">
				{age} år, fra fødselsåret {birthYear}.
				{#if profile.birthYearSource === 'person'}
					Utledet av fødselsdatoen over — rett den der, ikke her.
				{/if}
			</p>
		{:else}
			<p class="field-hint warn">
				Mangler. Sett <strong>fødselsdato</strong> i Profil-kortet over — den brukes både her
				og til årskavalkaden, så den skal bare stå på ett sted.
			</p>
		{/if}
	</div>

	<div class="result" aria-live="polite">
		{#if basalKcal !== null && baselineKcal !== null}
			<div class="result-row">
				<span class="result-label">Hvileforbrenning</span>
				<span class="result-value">{nb(basalKcal)} kcal</span>
			</div>
			<div class="result-row">
				<span class="result-label">Kontorhverdag uten trening</span>
				<span class="result-value">{nb(baselineKcal)} kcal</span>
			</div>
			<p class="result-note">
				Regnet fra {weightKg !== null ? `${String(weightKg).replace('.', ',')} kg, ` : ''}{heightCm} cm
				og {age} år. Øktene legges på toppen med MET-verdier.
			</p>
		{:else}
			<p class="result-note">
				{#if missing.length > 0}
					Mangler {missing.join(', ')} før hvileforbrenningen kan regnes.
				{:else}
					Fyll ut feltene over for å se hvileforbrenningen.
				{/if}
			</p>
		{/if}
	</div>

	{#if draftError && !error}
		<p class="message warn">{draftError}</p>
	{/if}
	{#if error}
		<p class="message error">{error}</p>
	{/if}

	<Button
		variant="secondary"
		ariaLabel="Lagre kroppsprofil"
		disabled={saving || Boolean(draftError)}
		onClick={() => void save()}
	>
		{saving ? 'Lagrer …' : saved ? 'Lagret ✓' : 'Lagre kroppsprofil'}
	</Button>
</section>

<style>
	.settings-card {
		background: #171717;
		border: none;
		border-radius: 12px;
		padding: 1.5rem;
		margin-bottom: 1.5rem;
	}

	.card-icon {
		font-size: 2rem;
		margin-bottom: 1rem;
		display: inline-block;
	}

	.settings-card h2 {
		margin: 0 0 0.5rem;
		color: var(--text-primary);
		font-size: 1.25rem;
		font-weight: 600;
	}

	.help-text {
		margin: 0 0 1.5rem;
		color: var(--text-secondary);
		line-height: 1.6;
	}

	.field {
		margin-bottom: 1.25rem;
	}

	label,
	.label-text {
		display: block;
		margin-bottom: 0.5rem;
		font-weight: 600;
		font-size: 0.9rem;
		color: var(--text-primary);
	}

	.field-hint {
		margin: 0 0 0.6rem;
		font-size: 0.82rem;
		line-height: 1.5;
		color: var(--text-tertiary);
	}

	.field-hint.warn {
		color: #f0b429;
	}

	.field-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.field-row :global(.input) {
		max-width: 8rem;
	}

	.unit {
		font-size: 0.9rem;
		color: var(--text-tertiary);
	}

	.chips {
		display: flex;
		gap: 0.5rem;
	}

	.chip {
		padding: 0.55rem 1rem;
		font: inherit;
		font-size: 0.88rem;
		color: var(--text-secondary);
		background: var(--bg-input, #111);
		border: 1px solid var(--border-color, #2a2a2a);
		border-radius: 999px;
		cursor: pointer;
	}

	.chip.is-active {
		border-color: var(--accent-primary);
		color: var(--text-primary);
	}

	.result {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding: 0.9rem 1rem;
		margin-bottom: 1rem;
		background: #111;
		border-radius: 8px;
	}

	.result-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.result-label {
		font-size: 0.85rem;
		color: var(--text-secondary);
	}

	.result-value {
		font-size: 1.05rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	.result-note {
		margin: 0.2rem 0 0;
		font-size: 0.78rem;
		line-height: 1.5;
		color: var(--text-tertiary);
	}

	.message {
		margin: 0 0 0.85rem;
		font-size: 0.84rem;
		overflow-wrap: anywhere;
	}

	.message.warn {
		color: #f0b429;
	}

	.message.error {
		color: var(--error-text, #e0776b);
	}
</style>
