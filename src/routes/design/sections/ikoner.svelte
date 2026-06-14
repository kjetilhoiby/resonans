<script lang="ts">
	import { Icon } from '$lib/components/ui';
	import { THEME_HUES, type ThemeHueKey } from '$lib/domain/theme-hues';

	type DesignIconToken =
		| 'chat' | 'camera' | 'wave' | 'checkin' | 'file' | 'goals' | 'settings' | 'back'
		| 'forward' | 'search' | 'refresh' | 'close' | 'plus' | 'attach' | 'check' | 'calendar';

	const iconSpecs: Array<{ token: DesignIconToken; label: string; legacy: string }> = [
		{ token: 'chat', label: 'Samtale', legacy: '◈ / 💬' },
		{ token: 'camera', label: 'Kamera', legacy: '◉' },
		{ token: 'wave', label: 'Lyd', legacy: '∿' },
		{ token: 'checkin', label: 'Sjekk inn', legacy: '◐' },
		{ token: 'file', label: 'Fil', legacy: '▣' },
		{ token: 'goals', label: 'Mål', legacy: '◎ / 🎯' },
		{ token: 'settings', label: 'Innstillinger', legacy: '⚙ / ⚙️' },
		{ token: 'back', label: 'Tilbake', legacy: '←' },
		{ token: 'forward', label: 'Frem', legacy: '→' },
		{ token: 'search', label: 'Søk', legacy: 'inline SVG' },
		{ token: 'refresh', label: 'Oppdater', legacy: 'inline SVG' },
		{ token: 'close', label: 'Lukk', legacy: '✕ / ×' },
		{ token: 'plus', label: 'Legg til', legacy: '+' },
		{ token: 'attach', label: 'Vedlegg', legacy: '📎' },
		{ token: 'check', label: 'Bekreft', legacy: '✓' },
		{ token: 'calendar', label: 'Kalender', legacy: '📅' }
	];

	let iconThemeHue = $state(THEME_HUES.default);
	let iconThemeMode = $state<'dark' | 'light'>('dark');
	const iconThemePresets: Array<{ key: ThemeHueKey; name: string; hue: number; note: string }> = [
		{ key: 'default', name: 'Default', hue: THEME_HUES.default, note: 'Base for hele appen' },
		{ key: 'relations', name: 'Relasjoner', hue: THEME_HUES.relations, note: 'Rolig grønn for parforhold' },
		{ key: 'health', name: 'Helse', hue: THEME_HUES.health, note: 'Kjølig grønn-blå' },
		{ key: 'economy', name: 'Økonomi', hue: THEME_HUES.economy, note: 'Strammere amber' },
		{ key: 'literature', name: 'Litteratur', hue: THEME_HUES.literature, note: 'Varm og rolig lesetone' },
		{ key: 'work', name: 'Arbeid', hue: THEME_HUES.work, note: 'Kjølig fokusfarge' }
	];
</script>

<!-- ══ IKONER & TEMA-HUE ══════════════════════════════════════════════════ -->
<section id="ikoner" class="section">
	<h2 class="section-heading">Ikoner & tema-hue</h2>
	<p class="section-desc">
		Appens ikonsett (<code>ui/Icon.svelte</code>, 16 ikoner). Eget ikonsett brukes for handling og navigasjon; emoji beholdes for
		domene, stemning og personlig kontekst.
	</p>
	<p class="section-desc">
		Hue-mekanismen under er den samme som i produksjon: <code>getThemeHueStyle(temanavn)</code> setter
		<code>--theme-hue</code> per tema, og bakgrunn/border/forgrunn avledes som <code>hsl(hue, s, l)</code>-trinn.
		Slideren og light-modus er laboratorium for å teste nye hues og fremtidig re-skinning — appen er alltid mørk.
	</p>

	<div class="icon-theme-lab" class:light-mode={iconThemeMode === 'light'} style={`--icon-hue:${iconThemeHue};`}>
		<div class="icon-theme-controls">
			<div class="icon-hue-row">
				<label for="icon-hue" class="icon-hue-label">Tema-hue</label>
				<input id="icon-hue" type="range" min="0" max="360" step="1" bind:value={iconThemeHue} class="icon-hue-slider" />
				<span class="icon-hue-value">{iconThemeHue}°</span>
			</div>
			<div class="icon-mode-row" role="tablist" aria-label="Visningsmodus">
				<button
					type="button"
					class="icon-mode-btn"
					class:active={iconThemeMode === 'dark'}
					onclick={() => (iconThemeMode = 'dark')}
				>Dark</button>
				<button
					type="button"
					class="icon-mode-btn"
					class:active={iconThemeMode === 'light'}
					onclick={() => (iconThemeMode = 'light')}
				>Light</button>
			</div>
			<div class="icon-preset-row">
				{#each iconThemePresets as preset}
					<button
						type="button"
						class="icon-preset-btn"
						class:active={iconThemeHue === preset.hue}
						onclick={() => (iconThemeHue = preset.hue)}
					>
						<span>{preset.name}</span>
						<small>{preset.note}</small>
					</button>
				{/each}
			</div>
			<div class="icon-token-strip" aria-label="Fargetokens">
				<div class="icon-token-swatch">
					<span class="icon-token-dot icon-token-dot--bg0"></span>
					<span>bg-0</span>
				</div>
				<div class="icon-token-swatch">
					<span class="icon-token-dot icon-token-dot--bg1"></span>
					<span>bg-1</span>
				</div>
				<div class="icon-token-swatch">
					<span class="icon-token-dot icon-token-dot--bg2"></span>
					<span>bg-2</span>
				</div>
				<div class="icon-token-swatch">
					<span class="icon-token-dot icon-token-dot--border"></span>
					<span>border</span>
				</div>
				<div class="icon-token-swatch">
					<span class="icon-token-dot icon-token-dot--fg"></span>
					<span>fg</span>
				</div>
			</div>
		</div>

		<div class="icon-grid">
			{#each iconSpecs as icon}
				<article class="icon-card">
					<div class="icon-preview" aria-hidden="true">
						<Icon name={icon.token} size={24} />
					</div>
					<p class="icon-token">ri-{icon.token}</p>
					<p class="icon-label">{icon.label}</p>
					<p class="icon-legacy">Erstatter: {icon.legacy}</p>
				</article>
			{/each}
		</div>
	</div>
</section>
