<!--
  NutritionTargetsCard — dagsmålene, satt der man styrer etter dem.

  Målene fantes bare som endepunkt (`PUT /api/helse/ernaering/mal`). Uten et kcal-mål
  regnes ikke andelene om til gram, `frameDay` måler «Igjen i dag» mot forbruksanslaget
  framfor mot et mål, og sultvarslene holder kjeft — alt stille.

  Kortet er sammenleggbart og lukket til vanlig: det er noe man justerer sjelden og
  leser ofte, så oppsummeringslinja er hovedsaken og feltene er det man åpner.

  Chatten setter de samme fem tallene med `manage_nutrition_targets`, gjennom samme
  `saveNutritionTargets`. «Sett proteinmålet til 180» er en setning man sier; her ser
  man hva som ble satt, og retter det.
-->
<script lang="ts">
	import SectionLabel from '../../ui/SectionLabel.svelte';
	import { extractApiErrorMessage } from '$lib/client/api-error';
	import {
		macroPctWarning,
		validateTargetField,
		DEFAULT_MACRO_SPLIT,
		TARGET_LIMITS,
		type TargetField
	} from '$lib/domain/nutrition/target-settings';
	import {
		suggestedProteinTarget,
		PROTEIN_G_PER_KG_MAX,
		PROTEIN_G_PER_KG_MIN
	} from '$lib/domain/nutrition/macro-targets';

	interface Props {
		targets: {
			kcal: number | null;
			proteinG: number | null;
			proteinPct: number | null;
			carbsPct: number | null;
			fatPct: number | null;
		};
		/** Siste vekt, til proteinforslaget. Null når Withings ikke har levert. */
		weightKg?: number | null;
		/** Ber flaten hente dashboardet på nytt, så alle tallene følger målet. */
		onSaved?: () => void;
	}

	let { targets, weightKg = null, onSaved }: Props = $props();

	let open = $state(false);
	let saving = $state(false);
	let saved = $state(false);
	let error = $state('');

	/**
	 * Utkastene er `string | number`: `bind:value` mot en `type="number"` konverterer
	 * til tall, så et felt som starter som tekst er et number etter første render.
	 */
	type Draft = Record<'kcalTarget' | 'proteinTarget' | 'proteinPct' | 'carbsPct' | 'fatPct', string | number>;

	function draftFrom(source: Props['targets']): Draft {
		return {
			kcalTarget: source.kcal ?? '',
			proteinTarget: source.proteinG ?? '',
			proteinPct: source.proteinPct ?? '',
			carbsPct: source.carbsPct ?? '',
			fatPct: source.fatPct ?? ''
		};
	}

	let draft = $state<Draft>(draftFrom(targets));

	/**
	 * Friskes opp ved åpning, ikke ved hver `targets`-endring.
	 *
	 * Chatten kan ha satt målene siden sist kortet var åpent, og da skal feltene vise
	 * det som står lagret. Men å følge propen kontinuerlig ville overskrevet et utkast
	 * midt i skrivingen hvis dashboardet ble hentet på nytt under. Samme mønster som
	 * `ThemeMetricSettingsSheet`.
	 */
	$effect(() => {
		if (open) draft = draftFrom(targets);
	});

	function parseNumber(raw: string | number | undefined): number | null {
		if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
		if (typeof raw !== 'string') return null;
		const trimmed = raw.trim().replace(',', '.');
		if (!trimmed) return null;
		const value = Number(trimmed);
		return Number.isFinite(value) ? value : null;
	}

	function isBlank(raw: string | number | undefined): boolean {
		if (raw === undefined || raw === null) return true;
		return typeof raw === 'number' ? !Number.isFinite(raw) : raw.trim() === '';
	}

	const parsed = $derived({
		kcalTarget: parseNumber(draft.kcalTarget),
		proteinTarget: parseNumber(draft.proteinTarget),
		proteinPct: parseNumber(draft.proteinPct),
		carbsPct: parseNumber(draft.carbsPct),
		fatPct: parseNumber(draft.fatPct)
	});

	/** «1,6» og «2,0» — komma, og desimalen beholdt. `String(2.0)` gir «2». */
	function decimal(value: number): string {
		return value.toFixed(1).replace('.', ',');
	}

	const FIELDS: Array<{
		key: TargetField;
		label: string;
		unit: string;
		hint?: string;
	}> = [
		{
			key: 'kcalTarget',
			label: 'Kalorier',
			unit: 'kcal/dag',
			hint: 'Uten dette måles «Igjen i dag» mot forbruksanslaget, og sultvarslene er av.'
		},
		{
			key: 'proteinTarget',
			label: 'Protein',
			unit: 'g/dag',
			hint: `Vinner over proteinandelen. ${decimal(PROTEIN_G_PER_KG_MIN)}–${decimal(PROTEIN_G_PER_KG_MAX)} g per kg kroppsvekt er vanlig for den som trener.`
		},
		{ key: 'proteinPct', label: 'Proteinandel', unit: '% av energien' },
		{ key: 'carbsPct', label: 'Karboandel', unit: '% av energien' },
		{ key: 'fatPct', label: 'Fettandel', unit: '% av energien' }
	];

	/** Første feilen i utkastet, med samme tekst serveren ville svart. */
	const draftError = $derived.by(() => {
		for (const field of FIELDS) {
			const raw = draft[field.key];
			if (isBlank(raw)) continue;
			const value = parsed[field.key];
			if (value === null) return `${field.label} må være et tall.`;
			const err = validateTargetField(field.key, value);
			if (err) return err;
		}
		return null;
	});

	/** Advarselen om andelene, live — ikke først etter lagring. */
	const pctWarning = $derived(macroPctWarning(parsed));

	const suggestedProteinG = $derived(suggestedProteinTarget(weightKg));

	/** Oppsummeringslinja på det lukkede kortet. */
	const summary = $derived.by(() => {
		const parts: string[] = [];
		if (targets.kcal !== null) parts.push(`${targets.kcal.toLocaleString('nb-NO')} kcal`);
		if (targets.proteinG !== null) parts.push(`${targets.proteinG} g protein`);
		const pct = [targets.proteinPct, targets.carbsPct, targets.fatPct];
		if (pct.every((value) => value !== null)) parts.push(`${pct.join('/')} fordeling`);
		return parts.length > 0 ? parts.join(' · ') : 'Ingen mål satt';
	});

	function applyDefaultSplit() {
		draft.proteinPct = DEFAULT_MACRO_SPLIT.proteinPct;
		draft.carbsPct = DEFAULT_MACRO_SPLIT.carbsPct;
		draft.fatPct = DEFAULT_MACRO_SPLIT.fatPct;
	}

	function applySuggestedProtein() {
		if (suggestedProteinG !== null) draft.proteinTarget = suggestedProteinG;
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
			// Tomme felt sendes som null, altså «fjern målet». Å utelate dem ville
			// gjort et tømt felt til ingen endring, og da kan man ikke slette et mål.
			const res = await fetch('/api/helse/ernaering/mal', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(parsed)
			});
			if (!res.ok) throw new Error(extractApiErrorMessage(res.status, await res.text()));
			saved = true;
			setTimeout(() => (saved = false), 2200);
			onSaved?.();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			saving = false;
		}
	}
</script>

<section class="targets">
	<button
		type="button"
		class="head"
		aria-expanded={open}
		onclick={() => (open = !open)}
		data-track="ernaering:apne-dagsmal"
	>
		<span class="head-text">
			<SectionLabel tag="h2">Dagsmål</SectionLabel>
			<span class="summary" class:is-empty={targets.kcal === null && targets.proteinG === null}>
				{summary}
			</span>
		</span>
		<span class="chevron" aria-hidden="true">{open ? '−' : '+'}</span>
	</button>

	{#if open}
		<div class="fields">
			{#each FIELDS as field (field.key)}
				<div class="field">
					<label for={`target-${field.key}`}>
						{field.label}
						<span class="unit">{field.unit}</span>
					</label>
					<input
						id={`target-${field.key}`}
						class="input"
						type="number"
						inputmode="decimal"
						min={TARGET_LIMITS[field.key][0]}
						max={TARGET_LIMITS[field.key][1]}
						placeholder="Ingen"
						bind:value={draft[field.key]}
						data-track={`ernaering:mal-${field.key}`}
					/>
					{#if field.hint}
						<p class="hint">{field.hint}</p>
					{/if}
				</div>
			{/each}
		</div>

		<div class="shortcuts">
			{#if suggestedProteinG !== null}
				<button
					type="button"
					class="shortcut"
					onclick={applySuggestedProtein}
					data-track="ernaering:foresla-proteinmal"
				>
					Foreslå {suggestedProteinG} g protein
					<span class="shortcut-why">({weightKg} kg)</span>
				</button>
			{/if}
			<button
				type="button"
				class="shortcut"
				onclick={applyDefaultSplit}
				data-track="ernaering:standard-makrofordeling"
			>
				Sett 30/40/30
			</button>
		</div>

		{#if pctWarning}
			<p class="message warn">{pctWarning}</p>
		{/if}
		{#if draftError && !error}
			<p class="message warn">{draftError}</p>
		{/if}
		{#if error}
			<p class="message error">{error}</p>
		{/if}

		<div class="actions">
			<button
				type="button"
				class="save"
				disabled={saving || Boolean(draftError)}
				onclick={() => void save()}
				data-track="ernaering:lagre-dagsmal"
			>
				{saving ? 'Lagrer …' : saved ? 'Lagret ✓' : 'Lagre mål'}
			</button>
			<span class="chat-hint">Du kan også si det i chatten: «sett proteinmålet til 180 g».</span>
		</div>
	{/if}
</section>

<style>
	.targets {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 16px;
		background: var(--card-bg-subtle, #141414);
		border-radius: var(--card-radius, 16px);
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		width: 100%;
		padding: 0;
		font: inherit;
		text-align: left;
		color: inherit;
		background: none;
		border: none;
		cursor: pointer;
	}

	.head-text {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}

	.summary {
		font-size: 0.82rem;
		color: #aaa;
	}

	.summary.is-empty {
		color: #f0b429;
	}

	.chevron {
		width: 14px;
		font-size: 1rem;
		text-align: center;
		color: #666;
		flex-shrink: 0;
	}

	.fields {
		display: grid;
		grid-template-columns: 1fr;
		gap: 12px;
	}

	@media (min-width: 480px) {
		.fields {
			grid-template-columns: 1fr 1fr;
		}
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}

	label {
		display: flex;
		align-items: baseline;
		gap: 6px;
		font-size: 0.78rem;
		font-weight: 600;
		color: #ccc;
	}

	.unit {
		font-weight: 400;
		font-size: 0.7rem;
		color: #666;
	}

	.input {
		padding: 8px 10px;
		font: inherit;
		font-size: 0.88rem;
		color: #eee;
		background: #0f0f0f;
		border: 1px solid #2a2a2a;
		border-radius: 10px;
		width: 100%;
		box-sizing: border-box;
	}

	.input:focus {
		outline: none;
		border-color: #444;
	}

	.hint {
		margin: 0;
		font-size: 0.7rem;
		line-height: 1.45;
		color: #6d6d6d;
	}

	.shortcuts {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.shortcut {
		padding: 6px 11px;
		font: inherit;
		font-size: 0.76rem;
		color: #9aa7f0;
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 999px;
		cursor: pointer;
	}

	.shortcut-why {
		color: #666;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
	}

	.save {
		padding: 9px 16px;
		font: inherit;
		font-size: 0.84rem;
		color: #82c882;
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 10px;
		cursor: pointer;
	}

	.save:disabled {
		opacity: 0.55;
		cursor: default;
	}

	.chat-hint {
		font-size: 0.72rem;
		color: #6d6d6d;
	}

	.message {
		margin: 0;
		font-size: 0.76rem;
		line-height: 1.5;
		overflow-wrap: anywhere;
	}

	.message.warn {
		color: #f0b429;
	}

	.message.error {
		color: #e0776b;
	}
</style>
