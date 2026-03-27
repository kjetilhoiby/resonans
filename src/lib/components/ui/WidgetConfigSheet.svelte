<script lang="ts">
	interface WidgetConfig {
		id: string;
		title: string;
		metricType: string;
		unit: string;
		color: string;
		goal: number | null;
		thresholdWarn: number | null;
		thresholdSuccess: number | null;
	}

	interface Props {
		widget: WidgetConfig;
		open: boolean;
		onclose: () => void;
		onsave: (updates: Partial<WidgetConfig>) => void;
	}

	let { widget, open, onclose, onsave }: Props = $props();

	// Standardretning per metrikk: true = høyere er bedre
	const DEFAULT_HIGHER_IS_BETTER: Record<string, boolean> = {
		steps: true,
		sleepDuration: true,
		distance: true,
		workoutCount: true,
		mood: true,
		weight: false,
		amount: false,
		screenTime: false,
		heartrate: false,
	};

	const COLORS = [
		{ hex: '#7c8ef5', name: 'Indigo' },
		{ hex: '#82c882', name: 'Grønn' },
		{ hex: '#e07070', name: 'Rød' },
		{ hex: '#f0b429', name: 'Gul' },
		{ hex: '#5fa0a0', name: 'Teal' },
		{ hex: '#d4829a', name: 'Rosa' },
	];

	// Lokale skjema-felt
	let title = $state(widget.title);
	let goalStr = $state(widget.goal != null ? String(widget.goal) : '');
	let warnStr = $state(widget.thresholdWarn != null ? String(widget.thresholdWarn) : '');
	let successStr = $state(widget.thresholdSuccess != null ? String(widget.thresholdSuccess) : '');
	let color = $state(widget.color);

	// Retning: auto-detekt fra terskler hvis satt, ellers metrikk-standard
	function detectDirection(): boolean {
		if (widget.thresholdSuccess != null && widget.thresholdWarn != null) {
			return widget.thresholdSuccess > widget.thresholdWarn;
		}
		return DEFAULT_HIGHER_IS_BETTER[widget.metricType] ?? true;
	}
	let higherIsBetter = $state(detectDirection());

	// Synk form-felt når widget-prop endres (ny widget åpnet)
	$effect(() => {
		title = widget.title;
		goalStr = widget.goal != null ? String(widget.goal) : '';
		warnStr = widget.thresholdWarn != null ? String(widget.thresholdWarn) : '';
		successStr = widget.thresholdSuccess != null ? String(widget.thresholdSuccess) : '';
		color = widget.color;
		higherIsBetter = detectDirection();
	});

	function numOrNull(s: string): number | null {
		const n = parseFloat(s);
		return isNaN(n) ? null : n;
	}

	function handleSave() {
		onsave({
			title: title.trim() || widget.title,
			goal: numOrNull(goalStr),
			thresholdWarn: numOrNull(warnStr),
			thresholdSuccess: numOrNull(successStr),
			color,
		});
	}
</script>

{#if open}
	<!-- Backdrop -->
	<div
		class="backdrop"
		role="presentation"
		onpointerdown={onclose}
	></div>

	<!-- Sheet -->
	<div class="sheet" role="dialog" aria-label="Widget-konfigurasjon">
		<div class="sheet-handle"></div>
		<h2 class="sheet-title">Konfigurer widget</h2>

		<div class="form">
			<!-- Tittel -->
			<label class="field">
				<span class="field-label">Tittel</span>
				<input
					class="field-input"
					type="text"
					maxlength="80"
					bind:value={title}
					placeholder={widget.title}
				/>
			</label>

			<!-- Mål -->
			<label class="field">
				<span class="field-label">Mål <span class="field-unit">({widget.unit})</span></span>
				<input
					class="field-input"
					type="number"
					inputmode="decimal"
					bind:value={goalStr}
					placeholder="Ingen"
				/>
			</label>

			<!-- Terskler -->
			<fieldset class="threshold-group">
				<legend class="field-label">Terskler</legend>

				<!-- Retningsvalg -->
				<div class="direction-toggle">
					<button
						class="dir-btn"
						class:active={higherIsBetter}
						onpointerdown={(e) => e.stopPropagation()}
						onclick={() => higherIsBetter = true}
						type="button"
					>
						↑ Høyere er bedre
					</button>
					<button
						class="dir-btn"
						class:active={!higherIsBetter}
						onpointerdown={(e) => e.stopPropagation()}
						onclick={() => higherIsBetter = false}
						type="button"
					>
						↓ Lavere er bedre
					</button>
				</div>

				<div class="threshold-inputs">
					<label class="field field-half">
						<span class="field-label threshold-warn-label">
							{higherIsBetter ? '⚠ Advar under' : '⚠ Advar over'}
						</span>
						<input
							class="field-input"
							type="number"
							inputmode="decimal"
							bind:value={warnStr}
							placeholder="Ingen"
						/>
					</label>
					<label class="field field-half">
						<span class="field-label threshold-success-label">
							{higherIsBetter ? '✓ Suksess over' : '✓ Suksess under'}
						</span>
						<input
							class="field-input"
							type="number"
							inputmode="decimal"
							bind:value={successStr}
							placeholder="Ingen"
						/>
					</label>
				</div>

				<!-- Visuell preview av terskel-området -->
				{#if warnStr || successStr}
					<div class="threshold-preview">
						{#if higherIsBetter}
							<div class="range warn">&lt; {warnStr || '?'} → advarsel</div>
							<div class="range normal">{warnStr || '?'} – {successStr || '?'} → normal</div>
							<div class="range success">&gt; {successStr || '?'} → suksess</div>
						{:else}
							<div class="range success">&lt; {successStr || '?'} → suksess</div>
							<div class="range normal">{successStr || '?'} – {warnStr || '?'} → normal</div>
							<div class="range warn">&gt; {warnStr || '?'} → advarsel</div>
						{/if}
					</div>
				{/if}
			</fieldset>

			<!-- Farge -->
			<div class="field">
				<span class="field-label">Farge</span>
				<div class="color-swatches">
					{#each COLORS as c}
						<button
							class="swatch"
							class:selected={color === c.hex}
							style:background={c.hex}
							onpointerdown={(e) => e.stopPropagation()}
							onclick={() => color = c.hex}
							type="button"
							aria-label={c.name}
							title={c.name}
						></button>
					{/each}
				</div>
			</div>
		</div>

		<!-- Handlinger -->
		<div class="sheet-actions">
			<button class="btn-cancel" onclick={onclose} type="button">Avbryt</button>
			<button class="btn-save" onclick={handleSave} type="button">Lagre</button>
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		z-index: 300;
	}

	.sheet {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 301;
		background: #111;
		border-radius: 18px 18px 0 0;
		border-top: 1px solid #222;
		padding: 12px 20px calc(20px + env(safe-area-inset-bottom));
		display: flex;
		flex-direction: column;
		gap: 0;
		max-height: 88vh;
		overflow-y: auto;
	}

	.sheet-handle {
		width: 36px;
		height: 4px;
		background: #333;
		border-radius: 2px;
		margin: 0 auto 14px;
		flex-shrink: 0;
	}

	.sheet-title {
		font-size: 0.95rem;
		font-weight: 600;
		color: #ccc;
		margin: 0 0 16px;
		text-align: center;
	}

	.form {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	.field-half {
		flex: 1;
		min-width: 0;
	}

	.field-label {
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: #555;
	}

	.field-unit {
		text-transform: none;
		letter-spacing: 0;
		font-size: 0.65rem;
	}

	.field-input {
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 8px;
		color: #ccc;
		font-size: 0.9rem;
		padding: 8px 10px;
		width: 100%;
		box-sizing: border-box;
		outline: none;
		-moz-appearance: textfield;
		appearance: textfield;
	}
	.field-input:focus {
		border-color: #444;
	}
	.field-input::-webkit-inner-spin-button,
	.field-input::-webkit-outer-spin-button {
		opacity: 0.4;
	}

	.threshold-group {
		border: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.direction-toggle {
		display: flex;
		gap: 6px;
	}

	.dir-btn {
		flex: 1;
		padding: 6px 8px;
		border-radius: 7px;
		border: 1px solid #2a2a2a;
		background: #1a1a1a;
		color: #555;
		font-size: 0.72rem;
		cursor: pointer;
		transition: background 0.15s, color 0.15s, border-color 0.15s;
	}
	.dir-btn.active {
		background: #232336;
		border-color: #7c8ef5;
		color: #9ba8f5;
	}

	.threshold-inputs {
		display: flex;
		gap: 10px;
	}

	.threshold-warn-label {
		color: #c09030;
	}

	.threshold-success-label {
		color: #5a9a5a;
	}

	.threshold-preview {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 8px 10px;
		background: #161616;
		border-radius: 8px;
		font-size: 0.68rem;
	}

	.range {
		padding: 2px 0;
	}

	.range.warn { color: #f0b429; }
	.range.normal { color: #555; }
	.range.success { color: #82c882; }

	.color-swatches {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
	}

	.swatch {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		border: 2px solid transparent;
		cursor: pointer;
		transition: transform 0.1s, border-color 0.1s;
	}
	.swatch.selected {
		border-color: #fff;
		transform: scale(1.15);
	}

	.sheet-actions {
		display: flex;
		gap: 10px;
		margin-top: 20px;
	}

	.btn-cancel {
		flex: 1;
		padding: 11px;
		background: none;
		border: 1px solid #2a2a2a;
		border-radius: 10px;
		color: #555;
		font-size: 0.88rem;
		cursor: pointer;
	}

	.btn-save {
		flex: 2;
		padding: 11px;
		background: #7c8ef5;
		border: none;
		border-radius: 10px;
		color: #fff;
		font-size: 0.88rem;
		font-weight: 600;
		cursor: pointer;
	}
	.btn-save:active {
		opacity: 0.85;
	}
</style>
