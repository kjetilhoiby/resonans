<!--
  ChatImageMenu — liten popup-meny ved langtrykk på et bilde i chat-tråden.
  Fixed-posisjonert ut fra anchor-rect, klikk utenfor lukker. To visninger:
  hovedmeny (Beskriv / Registrer i serie / Fjern) og et beskriv-felt.

  Konsumenten eier persistering + state-oppdatering via callbackene.
-->
<script lang="ts">
	interface Props {
		open: boolean;
		anchor: DOMRect | null;
		initialText?: string;
		/** Kan meldingen redigeres/slettes (har DB-id)? Ellers skjules de handlingene. */
		canPersist?: boolean;
		onClose: () => void;
		onDescribe?: (text: string) => void;
		onRegister?: () => void;
		onRemove?: () => void;
	}

	let {
		open,
		anchor,
		initialText = '',
		canPersist = true,
		onClose,
		onDescribe,
		onRegister,
		onRemove
	}: Props = $props();

	type View = 'main' | 'describe';
	let view = $state<View>('main');
	let draft = $state('');

	$effect(() => {
		if (open) {
			view = 'main';
			draft = initialText;
		}
	});

	const MENU_WIDTH = 220;
	const style = $derived.by(() => {
		if (!anchor) return 'display:none;';
		const margin = 8;
		const vw = typeof window !== 'undefined' ? window.innerWidth : 360;
		const vh = typeof window !== 'undefined' ? window.innerHeight : 640;
		let left = anchor.left + anchor.width / 2 - MENU_WIDTH / 2;
		left = Math.max(margin, Math.min(left, vw - MENU_WIDTH - margin));
		// Under bildet hvis det er plass, ellers over.
		const below = anchor.bottom + margin;
		const placeBelow = below + 160 < vh;
		const top = placeBelow ? below : Math.max(margin, anchor.top - margin - 160);
		return `left:${Math.round(left)}px; top:${Math.round(top)}px; width:${MENU_WIDTH}px;`;
	});

	function save() {
		onDescribe?.(draft.trim());
	}
</script>

{#if open && anchor}
	<button type="button" class="cim-backdrop" aria-label="Lukk meny" onclick={onClose}></button>
	<div class="cim-menu" style={style} role="menu">
		{#if view === 'main'}
			{#if canPersist && onDescribe}
				<button class="cim-item" role="menuitem" onclick={() => (view = 'describe')}>
					<span class="cim-icon">✏️</span> Beskriv / legg til kontekst
				</button>
			{/if}
			{#if onRegister}
				<button class="cim-item" role="menuitem" onclick={() => { onRegister?.(); }}>
					<span class="cim-icon">📊</span> Registrer i serie
				</button>
			{/if}
			{#if canPersist && onRemove}
				<button class="cim-item cim-danger" role="menuitem" onclick={() => { onRemove?.(); }}>
					<span class="cim-icon">🗑️</span> Fjern
				</button>
			{/if}
		{:else}
			<textarea
				class="cim-textarea"
				bind:value={draft}
				rows="3"
				placeholder="Beskriv bildet, f.eks. «barna sover»"
				data-track="dagbok:beskriv-bilde"
			></textarea>
			<div class="cim-row">
				<button class="cim-btn cim-btn-ghost" onclick={onClose}>Avbryt</button>
				<button class="cim-btn cim-btn-primary" onclick={save}>Lagre</button>
			</div>
		{/if}
	</div>
{/if}

<style>
	.cim-backdrop {
		position: fixed;
		inset: 0;
		z-index: 90;
		background: transparent;
		border: none;
		padding: 0;
		cursor: default;
	}
	.cim-menu {
		position: fixed;
		z-index: 91;
		background: #16181f;
		border: 1px solid #2a2d38;
		border-radius: 12px;
		padding: 6px;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.cim-item {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		background: none;
		border: none;
		color: #e2e2e8;
		font: inherit;
		font-size: 0.86rem;
		text-align: left;
		padding: 9px 10px;
		border-radius: 8px;
		cursor: pointer;
	}
	.cim-item:hover {
		background: #202430;
	}
	.cim-danger {
		color: #e08585;
	}
	.cim-icon {
		font-size: 1rem;
		line-height: 1;
		width: 18px;
		text-align: center;
	}
	.cim-textarea {
		width: 100%;
		box-sizing: border-box;
		background: #0f121b;
		border: 1px solid #2a2d38;
		color: #e8e8e8;
		border-radius: 8px;
		padding: 8px;
		font: inherit;
		font-size: 0.86rem;
		resize: vertical;
	}
	.cim-row {
		display: flex;
		justify-content: flex-end;
		gap: 6px;
		margin-top: 6px;
	}
	.cim-btn {
		border-radius: 8px;
		padding: 6px 12px;
		font: inherit;
		font-size: 0.82rem;
		cursor: pointer;
		border: 1px solid transparent;
	}
	.cim-btn-ghost {
		background: transparent;
		border-color: #2a2d38;
		color: #b8b8c0;
	}
	.cim-btn-primary {
		background: #3c4f9f;
		color: #fff;
	}
</style>
