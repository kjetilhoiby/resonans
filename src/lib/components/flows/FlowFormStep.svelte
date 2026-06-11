<script lang="ts">
	import type { FlowFormField, FlowContext } from '$lib/flows/types';
	import DateInput from '$lib/components/ui/DateInput.svelte';

	interface Props {
		fields: FlowFormField[];
		flowData: Record<string, any>;
		context: FlowContext;
		isFocus: boolean;
		pyramidExpanded: boolean;
		onFieldChange: (fieldId: string, value: unknown) => void;
		onPyramidToggle: () => void;
		onAutoAdvanceClear: () => void;
		onAutoAdvanceStart: () => void;
	}

	let {
		fields,
		flowData,
		context,
		isFocus,
		pyramidExpanded,
		onFieldChange,
		onPyramidToggle,
		onAutoAdvanceClear,
		onAutoAdvanceStart
	}: Props = $props();
</script>

<div class="fs-form" class:fs-focus-form={isFocus}>
	{#each fields as field (field.id)}
		<label class="fs-form-field" class:fs-focus-field={isFocus}>
			{#if !isFocus}
			<span class="fs-form-label">
				{field.label}{#if field.required}<span class="fs-required">*</span>{/if}
			</span>
			{/if}

			{#if field.type === 'text'}
				<input
					type="text"
					class="fs-form-input"
					placeholder={field.placeholder}
					value={flowData[field.id] ?? ''}
					oninput={(e) => onFieldChange(field.id, e.currentTarget.value)}
				/>
			{:else if field.type === 'textarea'}
				<textarea
					class="fs-form-textarea"
					placeholder={field.placeholder}
					rows="4"
					value={flowData[field.id] ?? ''}
					oninput={(e) => onFieldChange(field.id, e.currentTarget.value)}
				></textarea>
			{:else if field.type === 'number'}
				<input
					type="number"
					class="fs-form-input"
					placeholder={field.placeholder}
					min={field.min}
					max={field.max}
					step={field.step}
					value={flowData[field.id] ?? field.defaultValue ?? ''}
					oninput={(e) => onFieldChange(field.id, e.currentTarget.value ? parseFloat(e.currentTarget.value) : null)}
				/>
			{:else if field.type === 'date'}
				<DateInput
					value={flowData[field.id] ?? ''}
					onChange={(e) => onFieldChange(field.id, e.currentTarget.value)}
				/>
			{:else if field.type === 'select'}
				{@const selOptions = field.optionsFn ? field.optionsFn(flowData, context) : (field.options ?? [])}
				<select
					class="fs-form-select"
					value={flowData[field.id] ?? ''}
					onchange={(e) => onFieldChange(field.id, e.currentTarget.value)}
				>
					<option value="">Velg…</option>
					{#each selOptions as opt (opt.value)}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>
			{:else if field.type === 'slider'}
				{@const sliderVal = flowData[field.id] ?? field.defaultValue ?? field.min ?? 0}
				{@const sliderMin = field.min ?? 0}
				{@const sliderMax = field.max ?? 100}
				{@const sliderPct = ((sliderVal - sliderMin) / (sliderMax - sliderMin)) * 100}
				{#if isFocus}
					<div class="fs-focus-slider-display">
						{#if field.helperLabels && field.helperLabels[sliderVal] !== undefined}
							<span class="fs-focus-slider-label">{field.helperLabels[sliderVal]}</span>
						{/if}
					</div>
					<div class="fs-focus-slider-track">
						<div class="fs-focus-slider-fill" style:width="{sliderPct}%"></div>
						<input
							type="range"
							class="fs-focus-slider"
							min={sliderMin}
							max={sliderMax}
							step={field.step ?? 1}
							value={sliderVal}
							oninput={(e) => { onAutoAdvanceClear(); onFieldChange(field.id, parseFloat(e.currentTarget.value)); }}
							onpointerup={onAutoAdvanceStart}
							ontouchend={onAutoAdvanceStart}
						/>
					</div>
				{:else}
				<div class="fs-slider-wrap">
					<input
						type="range"
						class="fs-slider"
						min={sliderMin}
						max={sliderMax}
						step={field.step ?? 1}
						value={sliderVal}
						oninput={(e) => { onAutoAdvanceClear(); onFieldChange(field.id, parseFloat(e.currentTarget.value)); }}
						onpointerup={onAutoAdvanceStart}
						ontouchend={onAutoAdvanceStart}
					/>
					<span class="fs-slider-val">{sliderVal}</span>
				</div>
				{#if field.helperLabels && field.helperLabels[sliderVal] !== undefined}
					<p class="fs-slider-helper">{field.helperLabels[sliderVal]}</p>
				{/if}
				{/if}
			{:else if field.type === 'multiselect'}
				{@const groups = field.optionGroupsFn ? field.optionGroupsFn(flowData) : null}
				{#if groups}
					{#each groups as group}
						{#if group.isActive}
							<p class="fs-pyramid-label fs-pyramid-active">{group.label}</p>
							<div class="fs-multiselect" class:fs-focus-grid={isFocus}>
								{#each group.options as opt (opt.value)}
									{@const sel = Array.isArray(flowData[field.id]) && flowData[field.id].includes(opt.value)}
									<button
										type="button"
										class="fs-ms-opt"
										class:selected={sel}
										class:fs-focus-card={isFocus}
										onclick={() => {
											const cur: string[] = Array.isArray(flowData[field.id]) ? flowData[field.id] : [];
											onFieldChange(field.id, sel ? cur.filter((v) => v !== opt.value) : [...cur, opt.value]);
										}}
									>{opt.label}</button>
								{/each}
							</div>
						{/if}
					{/each}
					<button type="button" class="fs-pyramid-toggle" onclick={onPyramidToggle}>
						{pyramidExpanded ? 'Skjul andre nivåer' : 'Vis andre nivåer'}
					</button>
					{#if pyramidExpanded}
						{#each groups as group}
							{#if !group.isActive}
								<p class="fs-pyramid-label">{group.label}</p>
								<div class="fs-multiselect" class:fs-focus-grid={isFocus}>
									{#each group.options as opt (opt.value)}
										{@const sel = Array.isArray(flowData[field.id]) && flowData[field.id].includes(opt.value)}
										<button
											type="button"
											class="fs-ms-opt"
											class:selected={sel}
											class:fs-focus-card={isFocus}
											onclick={() => {
												const cur: string[] = Array.isArray(flowData[field.id]) ? flowData[field.id] : [];
												onFieldChange(field.id, sel ? cur.filter((v) => v !== opt.value) : [...cur, opt.value]);
											}}
										>{opt.label}</button>
									{/each}
								</div>
							{/if}
						{/each}
					{/if}
				{:else}
					{@const msOptions = field.optionsFn ? field.optionsFn(flowData, context) : (field.options ?? [])}
					<div class="fs-multiselect" class:fs-focus-grid={isFocus}>
						{#each msOptions as opt (opt.value)}
							{@const sel = Array.isArray(flowData[field.id]) && flowData[field.id].includes(opt.value)}
							<button
								type="button"
								class="fs-ms-opt"
								class:selected={sel}
								class:fs-focus-card={isFocus}
								onclick={() => {
									const cur: string[] = Array.isArray(flowData[field.id]) ? flowData[field.id] : [];
									onFieldChange(field.id, sel ? cur.filter((v) => v !== opt.value) : [...cur, opt.value]);
								}}
							>{opt.label}</button>
						{/each}
					</div>
				{/if}
			{/if}
		</label>
	{/each}
</div>

<style>
	.fs-form { display: flex; flex-direction: column; gap: 14px; }
	.fs-form-field { display: flex; flex-direction: column; gap: 5px; }
	.fs-form-label { font-size: 0.82rem; font-weight: 500; color: #8899aa; }
	.fs-required { color: hsl(0 60% 60%); margin-left: 2px; }
	.fs-form-input,
	.fs-form-textarea,
	.fs-form-select {
		background: #141414;
		border: 1px solid #1e1e1e;
		border-radius: 10px;
		padding: 10px 12px;
		color: #ddd;
		font-size: 0.88rem;
		font-family: inherit;
		transition: border-color 0.12s;
	}
	.fs-form-input:focus, .fs-form-textarea:focus, .fs-form-select:focus {
		outline: none;
		border-color: #4b6ef5;
	}
	.fs-slider-wrap { display: flex; align-items: center; gap: 12px; }
	.fs-slider {
		flex: 1;
		height: 6px;
		border-radius: 3px;
		background: #1e1e1e;
		-webkit-appearance: none;
		appearance: none;
	}
	.fs-slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 18px; height: 18px;
		border-radius: 50%;
		background: #4b6ef5;
		cursor: pointer;
	}
	.fs-slider-val { font-size: 0.9rem; font-weight: 600; color: #8ba0f5; min-width: 36px; text-align: right; }
	.fs-slider-helper { margin: 4px 0 8px; font-size: 0.85rem; color: #94a3b8; font-style: italic; }
	.fs-multiselect { display: flex; flex-wrap: wrap; gap: 7px; }
	.fs-ms-opt {
		background: #141414;
		border: 1px solid #1e1e1e;
		color: #666;
		padding: 7px 13px;
		border-radius: 8px;
		font-size: 0.82rem;
		cursor: pointer;
		transition: all 0.1s;
	}
	.fs-ms-opt.selected { background: #0d1828; border-color: #2a4080; color: #c8d4ef; }

	/* Focus-mode slider */
	.fs-focus-slider-display {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 3rem;
		margin-bottom: 20px;
	}
	.fs-focus-slider-label {
		font-size: 1.5rem;
		font-weight: 700;
		color: #e8ecf4;
		line-height: 1.2;
		text-align: center;
	}
	.fs-focus-slider-track {
		position: relative;
		width: 100%;
		height: 44px;
		border-radius: 22px;
		background: rgba(255, 255, 255, 0.06);
		overflow: hidden;
	}
	.fs-focus-slider-fill {
		position: absolute;
		top: 0;
		left: 0;
		height: 100%;
		background: linear-gradient(90deg, #1a1a2e, #4b6ef5);
		border-radius: 22px;
		transition: width 0.08s ease-out;
		pointer-events: none;
	}
	.fs-focus-slider {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		-webkit-appearance: none;
		appearance: none;
		background: transparent;
		cursor: pointer;
		margin: 0;
	}
	.fs-focus-slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: #fff;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
		cursor: grab;
	}
	.fs-focus-slider::-moz-range-thumb {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: #fff;
		border: none;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
		cursor: grab;
	}

	/* Focus-mode multiselect grid */
	.fs-focus-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 10px;
		width: 100%;
	}
	.fs-ms-opt.fs-focus-card {
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 14px;
		padding: 16px 8px;
		font-size: 0.85rem;
		font-weight: 500;
		color: #94a3b8;
		display: flex;
		align-items: center;
		justify-content: center;
		text-align: center;
		min-height: 56px;
		transition: all 0.15s ease;
	}
	.fs-ms-opt.fs-focus-card:hover {
		background: rgba(255, 255, 255, 0.07);
		border-color: rgba(255, 255, 255, 0.15);
	}
	.fs-ms-opt.fs-focus-card.selected {
		background: rgba(75, 110, 245, 0.12);
		border-color: rgba(75, 110, 245, 0.4);
		color: #c8d4ef;
	}

	/* Focus-mode form */
	.fs-focus-form {
		gap: 24px;
		align-items: center;
		width: 100%;
		max-width: 360px;
	}
	.fs-focus-field {
		align-items: center;
		width: 100%;
	}

	/* Focus-mode textarea */
	.fs-focus-form .fs-form-textarea {
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 14px;
		padding: 16px;
		font-size: 1rem;
		color: #ddd;
		text-align: left;
		width: 100%;
		min-height: 120px;
	}
	.fs-focus-form .fs-form-textarea:focus {
		border-color: rgba(75, 110, 245, 0.4);
	}
	.fs-focus-form .fs-form-textarea::placeholder {
		color: #475569;
	}

	/* Pyramid group labels */
	.fs-pyramid-label {
		font-size: 0.72rem;
		font-weight: 600;
		color: #475569;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin: 12px 0 6px;
		text-align: left;
		width: 100%;
	}
	.fs-pyramid-active {
		color: #8ba0f5;
	}
	.fs-pyramid-toggle {
		background: none;
		border: none;
		color: #475569;
		font-size: 0.8rem;
		cursor: pointer;
		padding: 8px 0;
		width: 100%;
		text-align: center;
		transition: color 0.15s;
	}
	.fs-pyramid-toggle:hover {
		color: #8ba0f5;
	}
</style>
