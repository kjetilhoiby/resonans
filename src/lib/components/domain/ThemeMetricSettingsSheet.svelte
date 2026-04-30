<script lang="ts">
	export type MetricKey = 'distance' | 'sleep' | 'sleepLag' | 'steps' | 'activeMinutes' | 'weight';

	export interface MetricThreshold {
		goal?: number;
		thresholdWarn?: number;
		thresholdSuccess?: number;
	}

	export type MetricSettingsMap = Partial<Record<MetricKey, MetricThreshold>>;

	interface MetricDef {
		key: MetricKey;
		label: string;
		unit: string;
		higherIsBetter: boolean;
		defaultGoal: number;
	}

	const METRICS: MetricDef[] = [
		{ key: 'distance', label: 'Løping', unit: 'km/uke', higherIsBetter: true, defaultGoal: 20 },
		{ key: 'sleep', label: 'Søvn per natt', unit: 'timer', higherIsBetter: true, defaultGoal: 7.5 },
		{ key: 'sleepLag', label: 'Søvnavvik', unit: 'timer', higherIsBetter: false, defaultGoal: 2 },
		{ key: 'steps', label: 'Skritt per dag', unit: 'steg', higherIsBetter: true, defaultGoal: 8000 },
		{ key: 'activeMinutes', label: 'Aktive min/dag', unit: 'min', higherIsBetter: true, defaultGoal: 30 },
		{ key: 'weight', label: 'Vektendring', unit: 'kg', higherIsBetter: false, defaultGoal: 0 },
	];

	interface Props {
		open: boolean;
		settings: MetricSettingsMap;
		themeId: string;
		onclose: () => void;
		onsave: (settings: MetricSettingsMap) => void;
	}

	let { open, settings, themeId, onclose, onsave }: Props = $props();

	// Local state: one text input per field per metric
	type FieldState = { goal: string; warn: string; success: string };
	let fields = $state<Record<MetricKey, FieldState>>({} as Record<MetricKey, FieldState>);

	$effect(() => {
		if (open) {
			const fresh: Record<MetricKey, FieldState> = {} as Record<MetricKey, FieldState>;
			for (const m of METRICS) {
				const s = settings[m.key] ?? {};
				fresh[m.key] = {
					goal: s.goal != null ? String(s.goal) : '',
					warn: s.thresholdWarn != null ? String(s.thresholdWarn) : '',
					success: s.thresholdSuccess != null ? String(s.thresholdSuccess) : '',
				};
			}
			fields = fresh;
		}
	});

	let saving = $state(false);

	async function handleSave() {
		saving = true;
		const result: MetricSettingsMap = {};
		for (const m of METRICS) {
			const f = fields[m.key];
			const entry: MetricThreshold = {};
			if (f.goal !== '') { const v = parseFloat(f.goal); if (!isNaN(v)) entry.goal = v; }
			if (f.warn !== '') { const v = parseFloat(f.warn); if (!isNaN(v)) entry.thresholdWarn = v; }
			if (f.success !== '') { const v = parseFloat(f.success); if (!isNaN(v)) entry.thresholdSuccess = v; }
			if (Object.keys(entry).length > 0) result[m.key] = entry;
		}
		try {
			await fetch(`/api/tema/${themeId}/metric-settings`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(result)
			});
			onsave(result);
		} finally {
			saving = false;
		}
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
	<div class="sheet" role="dialog" aria-label="Metrikk-innstillinger">
		<div class="sheet-handle"></div>
		<h2 class="sheet-title">Terskelverdier for helse-widgets</h2>

		<div class="metrics-list">
			{#each METRICS as m}
				{@const f = fields[m.key]}
				<div class="metric-row">
					<div class="metric-header">
						<span class="metric-label">{m.label}</span>
						<span class="metric-unit">{m.unit}</span>
					</div>
					<div class="metric-inputs">
						<label class="field-mini">
							<span class="field-mini-label">Mål</span>
							<input
								class="field-input-mini"
								type="number"
								inputmode="decimal"
								placeholder={String(m.defaultGoal)}
								bind:value={f.goal}
							/>
						</label>
						<label class="field-mini">
							<span class="field-mini-label">{m.higherIsBetter ? '⚠ Advar under' : '⚠ Advar over'}</span>
							<input
								class="field-input-mini"
								type="number"
								inputmode="decimal"
								placeholder="Ingen"
								bind:value={f.warn}
							/>
						</label>
						<label class="field-mini">
							<span class="field-mini-label">{m.higherIsBetter ? '✓ OK over' : '✓ OK under'}</span>
							<input
								class="field-input-mini"
								type="number"
								inputmode="decimal"
								placeholder="Ingen"
								bind:value={f.success}
							/>
						</label>
					</div>
				</div>
			{/each}
		</div>

		<div class="sheet-actions">
			<button class="btn-cancel" onclick={onclose} type="button">Avbryt</button>
			<button class="btn-save" onclick={() => void handleSave()} type="button" disabled={saving}>
				{saving ? 'Lagrer…' : 'Lagre'}
			</button>
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

	.metrics-list {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.metric-row {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding-bottom: 14px;
		border-bottom: 1px solid #1e1e1e;
	}

	.metric-row:last-child {
		border-bottom: none;
	}

	.metric-header {
		display: flex;
		align-items: baseline;
		gap: 6px;
	}

	.metric-label {
		font-size: 0.85rem;
		font-weight: 600;
		color: #ccc;
	}

	.metric-unit {
		font-size: 0.75rem;
		color: #666;
	}

	.metric-inputs {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		gap: 8px;
	}

	.field-mini {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.field-mini-label {
		font-size: 0.68rem;
		color: #666;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.field-input-mini {
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 8px;
		color: #eee;
		font-size: 0.82rem;
		padding: 6px 8px;
		width: 100%;
		box-sizing: border-box;
	}

	.field-input-mini:focus {
		outline: none;
		border-color: #444;
	}

	.sheet-actions {
		display: flex;
		gap: 10px;
		margin-top: 20px;
		padding-top: 12px;
		border-top: 1px solid #1e1e1e;
	}

	.btn-cancel {
		flex: 1;
		padding: 11px;
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 10px;
		color: #aaa;
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

	.btn-save:disabled {
		opacity: 0.6;
	}
</style>
