<!--
  PagerDots — aktiv side-indikator for paginerte flater (dots under en pager).
  Ren presentasjonskomponent — trukket ut fra HomeWidgetZone, markup og CSS uendret.
  Posisjonering (absolute, sentrert i bunn) følger med fra opprinnelig bruk;
  forelder må være position: relative.
-->
<script lang="ts">
	interface Props {
		count: number;
		active: number;
		onSelect?: (index: number) => void;
		ariaLabel?: string;
	}

	let { count, active, onSelect, ariaLabel = 'Widget-sider' }: Props = $props();
</script>

<div class="widget-pager-dots" aria-label={ariaLabel}>
	{#each Array.from({ length: count }) as _, i (`dot:${i}`)}
		<button
			class="widget-pager-dot"
			class:is-active={i === active}
			onclick={() => onSelect?.(i)}
			aria-label={`Gå til widget-side ${i + 1}`}
			aria-current={i === active ? 'true' : undefined}
		></button>
	{/each}
</div>

<style>
	.widget-pager-dots {
		position: absolute;
		left: 50%;
		bottom: 12px;
		transform: translateX(-50%);
		display: flex;
		gap: 6px;
		z-index: 3;
	}

	.widget-pager-dot {
		width: 7px;
		height: 7px;
		border-radius: 999px;
		border: none;
		background: #353535;
		cursor: pointer;
		padding: 0;
	}

	.widget-pager-dot.is-active {
		background: #7c8ef5;
	}
</style>
