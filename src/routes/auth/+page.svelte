<script lang="ts">
	let { data } = $props();
</script>

<svelte:head>
	<title>Logg inn | Resonans</title>
</svelte:head>

<div class="auth-shell">
	<div class="auth-card">
		<p class="eyebrow">Invite-only</p>
		<h1>Logg inn i Resonans</h1>
		<p>
			Bruk Google-kontoen din for å få tilgang. Bare inviterte e-postadresser slipper inn.
		</p>

		{#if data.errorMessage}
			<p class="auth-error">{data.errorMessage}</p>
		{/if}

		<form method="POST" action="/auth/signin/google">
			<input type="hidden" name="callbackUrl" value={data.next} />
			<button class="auth-submit" type="submit">Fortsett med Google</button>
		</form>
	</div>
</div>

<style>
	.auth-shell {
		min-height: 100vh;
		display: grid;
		place-items: center;
		padding: 2rem;
		background: linear-gradient(160deg, #f7f3eb 0%, #dfe7e2 100%);
	}

	.auth-card {
		width: min(100%, 28rem);
		padding: 2rem;
		border-radius: 1.5rem;
		background: rgba(255, 255, 255, 0.9);
		box-shadow: 0 24px 80px rgba(15, 23, 42, 0.12);
	}

	.eyebrow {
		margin: 0 0 0.5rem;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		font-size: 0.75rem;
		color: #4b5563;
	}

	h1 {
		margin: 0 0 0.75rem;
		font-size: 2rem;
	}

	p {
		color: #334155;
		line-height: 1.5;
	}

	.auth-error {
		padding: 0.85rem 1rem;
		border-radius: 0.85rem;
		background: #fee2e2;
		color: #991b1b;
	}

	.auth-submit {
		margin-top: 1rem;
		width: 100%;
		border: 0;
		border-radius: 999px;
		padding: 0.9rem 1rem;
		background: #111827;
		color: white;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
</style>
