<script lang="ts">
	type StatusTone = 'ok' | 'warn' | 'error' | 'off';

	interface Props {
		tone: StatusTone;
		text?: string;
		dot?: boolean;
	}

	let { tone, text, dot = false }: Props = $props();
</script>

{#if dot}
	<span class="status-dot {tone}" title={text}></span>
{:else if text}
	<p class="status-text {tone}">{text}</p>
{/if}

<style>
	.status-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		display: inline-block;
		flex-shrink: 0;
	}
	.status-dot.ok { background: var(--success-text); }
	.status-dot.warn { background: var(--warning-text); }
	.status-dot.error { background: var(--error-text); }
	.status-dot.off { background: var(--text-muted); }

	.status-text {
		margin: 0.6rem 0 0;
		font-size: 0.9rem;
		font-weight: 500;
	}
	.status-text.ok { color: var(--success-text); }
	.status-text.warn { color: var(--warning-text); }
	.status-text.error { color: var(--error-text); }
	.status-text.off { color: var(--text-muted); }
</style>
