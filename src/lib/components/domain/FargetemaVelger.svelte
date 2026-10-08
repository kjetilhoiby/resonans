<script lang="ts">
	import { browser } from '$app/environment';
	import {
		FARGETEMA_ETIKETTER,
		FARGETEMA_VALG,
		fargetemaCookie,
		type Fargetema
	} from '$lib/domain/fargetema';

	/**
	 * Velger for fargetemaet (lyst, mørkt, følg telefonen). Skriver cookien
	 * serveren leser, og setter attributtet på <html> med det samme, så valget
	 * synes uten en ny sidelast. Se $lib/domain/fargetema.ts.
	 */
	interface Props {
		valgt: Fargetema;
	}

	let { valgt }: Props = $props();
	let current = $state<Fargetema>('system');

	$effect.pre(() => {
		current = valgt;
	});

	function velg(neste: Fargetema) {
		current = neste;
		if (!browser) return;
		document.cookie = fargetemaCookie(neste);
		document.documentElement.dataset.fargetema = neste;
	}
</script>

<fieldset class="fargetema">
	<legend class="sr-only">Fargetema</legend>
	{#each FARGETEMA_VALG as valg (valg)}
		<label class="option" class:active={current === valg}>
			<input
				type="radio"
				name="fargetema"
				value={valg}
				checked={current === valg}
				onchange={() => velg(valg)}
				data-track="innstillinger:fargetema-{valg}"
			/>
			{FARGETEMA_ETIKETTER[valg]}
		</label>
	{/each}
</fieldset>

<style>
	.fargetema {
		display: flex;
		gap: 4px;
		margin: 0.65rem 0 0;
		padding: 4px;
		border: 1px solid var(--border-color);
		border-radius: 999px;
		background: var(--bg-input);
	}

	.option {
		flex: 1 1 0;
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 36px;
		padding: 0 0.5rem;
		border-radius: 999px;
		font-size: 0.82rem;
		color: var(--text-secondary);
		cursor: pointer;
		text-align: center;
	}

	.option.active {
		background: var(--text-primary);
		color: var(--bg-primary);
		font-weight: 600;
	}

	.option:has(input:focus-visible) {
		outline: 2px solid var(--accent-primary);
		outline-offset: 2px;
	}

	.option input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
</style>
