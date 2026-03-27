<script lang="ts">
	let { children } = $props();
</script>

<div class="legacy-bar">
	<span class="legacy-label">⚠ Legacy-frontend · <a href="/">Ny app</a></span>
</div>

{@render children()}

<style>
	.legacy-bar {
		position: sticky;
		top: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		padding: 6px 16px;
		background: #1a1200;
		border-bottom: 1px solid #3a2800;
	}

	.legacy-label {
		font-size: 0.72rem;
		color: #a08040;
		font-weight: 500;
	}

	.legacy-label a {
		color: #f0b429;
		text-decoration: none;
	}

	.legacy-label a:hover {
		text-decoration: underline;
	}
</style>
