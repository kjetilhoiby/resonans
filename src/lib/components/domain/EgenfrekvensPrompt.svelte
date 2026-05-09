<script lang="ts">
	interface Props {
		onstart: () => void;
		ondismiss: () => void;
	}

	let { onstart, ondismiss }: Props = $props();
</script>

<div class="ef-banner" role="region" aria-label="Egenfrekvens-sjekkin venter">
	<div class="ef-banner-icon" aria-hidden="true">🎚️</div>
	<div class="ef-banner-body">
		<div class="ef-banner-title">Egenfrekvens-sjekkin venter</div>
		<div class="ef-banner-text">Ta 30 sekunder — hvor er du nå?</div>
	</div>
	<div class="ef-banner-actions">
		<button class="ef-btn-primary" onclick={onstart}>Sjekk in</button>
		<button class="ef-btn-ghost" onclick={ondismiss}>Senere</button>
	</div>
</div>

<style>
	.ef-banner {
		display: flex;
		gap: 14px;
		align-items: center;
		padding: 12px 14px;
		margin: 0 0 12px;
		border-radius: 14px;
		background: linear-gradient(135deg, rgba(139, 160, 245, 0.18), rgba(110, 231, 183, 0.12));
		border: 1px solid rgba(139, 160, 245, 0.28);
	}
	.ef-banner-icon {
		font-size: 1.6rem;
		line-height: 1;
		flex-shrink: 0;
	}
	.ef-banner-body {
		flex: 1;
		min-width: 0;
	}
	.ef-banner-title {
		font-weight: 600;
		font-size: 0.95rem;
		color: #e2e8f0;
	}
	.ef-banner-text {
		font-size: 0.85rem;
		color: #94a3b8;
		margin-top: 2px;
	}
	.ef-banner-actions {
		display: flex;
		gap: 6px;
		flex-shrink: 0;
	}
	.ef-btn-primary {
		background: #8ba0f5;
		border: none;
		color: #0b1220;
		padding: 8px 14px;
		border-radius: 10px;
		font-weight: 600;
		font-size: 0.85rem;
		cursor: pointer;
	}
	.ef-btn-primary:hover {
		background: #a3b4f7;
	}
	.ef-btn-ghost {
		background: transparent;
		border: 1px solid rgba(255, 255, 255, 0.15);
		color: #cbd5e1;
		padding: 8px 12px;
		border-radius: 10px;
		font-size: 0.85rem;
		cursor: pointer;
	}
	.ef-btn-ghost:hover {
		background: rgba(255, 255, 255, 0.04);
	}
	@media (max-width: 480px) {
		.ef-banner {
			flex-wrap: wrap;
		}
		.ef-banner-actions {
			width: 100%;
			margin-top: 8px;
		}
		.ef-btn-primary,
		.ef-btn-ghost {
			flex: 1;
		}
	}
</style>
