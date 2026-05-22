<script lang="ts">
	interface Props {
		onstart: () => void;
		ondismiss: () => void;
	}

	let { onstart, ondismiss }: Props = $props();
</script>

<div class="focus-banner" role="region" aria-label="Fokustimer tilgjengelig">
	<div class="focus-banner-icon" aria-hidden="true">🎯</div>
	<div class="focus-banner-body">
		<div class="focus-banner-title">Klar for en fokusøkt?</div>
		<div class="focus-banner-text">Sett av tid til konsentrert arbeid.</div>
	</div>
	<div class="focus-banner-actions">
		<button class="focus-btn-primary" onclick={onstart}>Start</button>
		<button class="focus-btn-ghost" onclick={ondismiss}>Ikke nå</button>
	</div>
</div>

<style>
	.focus-banner {
		display: flex;
		gap: 14px;
		align-items: center;
		padding: 12px 14px;
		margin: 0 0 12px;
		border-radius: 14px;
		background: linear-gradient(135deg, rgba(245, 178, 89, 0.18), rgba(245, 139, 89, 0.12));
		border: 1px solid rgba(245, 178, 89, 0.28);
	}
	.focus-banner-icon {
		font-size: 1.6rem;
		line-height: 1;
		flex-shrink: 0;
	}
	.focus-banner-body {
		flex: 1;
		min-width: 0;
	}
	.focus-banner-title {
		font-weight: 600;
		font-size: 0.95rem;
		color: #e2e8f0;
	}
	.focus-banner-text {
		font-size: 0.85rem;
		color: #94a3b8;
		margin-top: 2px;
	}
	.focus-banner-actions {
		display: flex;
		gap: 6px;
		flex-shrink: 0;
	}
	.focus-btn-primary {
		background: #f5b259;
		border: none;
		color: #0b1220;
		padding: 8px 14px;
		border-radius: 10px;
		font-weight: 600;
		font-size: 0.85rem;
		cursor: pointer;
	}
	.focus-btn-primary:hover {
		background: #f7c47a;
	}
	.focus-btn-ghost {
		background: transparent;
		border: 1px solid rgba(255, 255, 255, 0.15);
		color: #cbd5e1;
		padding: 8px 12px;
		border-radius: 10px;
		font-size: 0.85rem;
		cursor: pointer;
	}
	.focus-btn-ghost:hover {
		background: rgba(255, 255, 255, 0.04);
	}
	@media (max-width: 480px) {
		.focus-banner {
			flex-wrap: wrap;
		}
		.focus-banner-actions {
			width: 100%;
			margin-top: 8px;
		}
		.focus-btn-primary,
		.focus-btn-ghost {
			flex: 1;
		}
	}
</style>
