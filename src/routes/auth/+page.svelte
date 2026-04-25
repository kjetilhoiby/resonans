<script lang="ts">
	import { AppPage } from '$lib/components/ui';

	let { data, form } = $props();
</script>

<svelte:head>
	<title>Logg inn | Resonans</title>
</svelte:head>

<AppPage width="full" padding="none" gap="sm" surface="transparent">
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

		{#if data.isPreview}
			<div class="auth-divider"><span>eller</span></div>

			<form method="POST" action="?/previewLogin">
				<input type="hidden" name="next" value={data.next} />
				<p class="eyebrow">Preview-tilgang</p>

				{#if form?.previewError}
					<p class="auth-error">{form.previewError}</p>
				{/if}

				<input
					class="auth-password-input"
					type="password"
					name="password"
					placeholder="Passord"
					autocomplete="current-password"
				/>
				<button class="auth-submit auth-submit--preview" type="submit">
					Logg inn med passord
				</button>
			</form>
		{/if}
		</div>
	</div>
</AppPage>

<style>
	:global(.auth-shell) {
		min-height: 100vh;
		display: grid;
		place-items: center;
		padding: 2rem;
		background: linear-gradient(160deg, #f7f3eb 0%, #dfe7e2 100%);
	}

	:global(.auth-card) {
		width: min(100%, 28rem);
		padding: 2rem;
		border-radius: 1.5rem;
		background: rgba(255, 255, 255, 0.9);
		box-shadow: 0 24px 80px rgba(15, 23, 42, 0.12);
	}

	:global(.eyebrow) {
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

	:global(.auth-error) {
		padding: 0.85rem 1rem;
		border-radius: 0.85rem;
		background: #fee2e2;
		color: #991b1b;
		margin: 0.5rem 0;
	}

	:global(.auth-submit) {
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

	:global(.auth-submit--preview) {
		background: #374151;
		margin-top: 0.5rem;
	}

	:global(.auth-divider) {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin: 1.25rem 0 1rem;
		color: #9ca3af;
		font-size: 0.8rem;
	}
	:global(.auth-divider)::before,
	:global(.auth-divider)::after {
		content: '';
		flex: 1;
		height: 1px;
		background: #e5e7eb;
	}

	:global(.auth-password-input) {
		display: block;
		width: 100%;
		border: 1px solid #d1d5db;
		border-radius: 0.75rem;
		padding: 0.75rem 1rem;
		font: inherit;
		font-size: max(1rem, 16px);
		color: #111827;
		box-sizing: border-box;
		outline: none;
		transition: border-color 0.15s;
	}
	:global(.auth-password-input):focus {
		border-color: #6b7280;
	}
</style>
