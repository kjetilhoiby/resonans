<script lang="ts">
	import { Button, IconButton } from '$lib/components/ui';
</script>

<!-- ══ KNAPPER ════════════════════════════════════════════════════════════ -->
<section id="knapper" class="section">
	<h2 class="section-heading">Knapper</h2>
	<p class="section-desc">
		<code>&lt;Button variant="…"&gt;</code> fra <code>ui/</code> er standard-API-et — komponenten bygger på de globale
		<code>.btn-*</code>-klassene i <code>app.css</code>, som kan brukes direkte der en komponent ikke passer.
		Ikon-knapper bruker <code>&lt;IconButton icon="…" ariaLabel="…"&gt;</code>.
	</p>
	<div class="variant-grid" style="--min:100px">

		<div class="variant">
			<Button variant="primary">Lagre</Button>
			<span class="vname">Primær<br><code>primary</code></span>
		</div>

		<div class="variant">
			<Button variant="secondary">Avbryt</Button>
			<span class="vname">Sekundær<br><code>secondary</code></span>
		</div>

		<div class="variant">
			<Button variant="ghost">Mer</Button>
			<span class="vname">Ghost<br><code>ghost</code></span>
		</div>

		<div class="variant">
			<Button variant="chip">Trening</Button>
			<span class="vname">Chip<br><code>chip</code></span>
		</div>

		<div class="variant">
			<Button variant="chip" className="active">Søvn</Button>
			<span class="vname">Chip · aktiv<br><code>chip + .active</code></span>
		</div>

		<div class="variant">
			<Button variant="danger">Slett</Button>
			<span class="vname">Destruktiv<br><code>danger</code></span>
		</div>

		<div class="variant">
			<Button variant="warning">Arkiver?</Button>
			<span class="vname">Advarsel<br><code>warning</code></span>
		</div>

		<div class="variant">
			<Button variant="primary" disabled>Lagre</Button>
			<span class="vname">Deaktivert<br><code>disabled</code></span>
		</div>

		<div class="variant">
			<IconButton icon="settings" ariaLabel="Innstillinger" size={16} />
			<span class="vname">Ikon<br><code>IconButton</code></span>
		</div>

		<div class="variant">
			<IconButton icon="close" ariaLabel="Slett" variant="danger" size={14} />
			<span class="vname">Ikon · slett<br><code>variant="danger"</code></span>
		</div>

	</div>
</section>
