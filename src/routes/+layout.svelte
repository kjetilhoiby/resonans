<script lang="ts">
	import '../app.css';

	let { data, children } = $props();
</script>

<svelte:head>
	<title>Resonans - Din personlige målcoach</title>
</svelte:head>

{#if data?.session?.user}
	<div class="auth-bar">
		<div>
			<strong>{data.session.user.name || data.session.user.email || 'Innlogget bruker'}</strong>
		</div>
		<form method="POST" action="/signout">
			<button class="auth-button" type="submit">Logg ut</button>
		</form>
	</div>
{/if}

{@render children?.()}

<style>
	.auth-bar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		padding: 0.75rem 1rem;
		background: rgba(255, 255, 255, 0.92);
		border-bottom: 1px solid rgba(15, 23, 42, 0.08);
		position: sticky;
		top: 0;
		z-index: 20;
		backdrop-filter: blur(10px);
	}

	.auth-button {
		border: 0;
		background: #0f172a;
		color: white;
		padding: 0.55rem 0.9rem;
		border-radius: 999px;
		cursor: pointer;
		font: inherit;
	}
</style>

