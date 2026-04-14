<script lang="ts">
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const invite = $derived(data.invite);
	const currentUser = $derived(data.currentUser);
	const canRespond = $derived(data.canRespond);
	const meta = $derived(data.meta);

	function statusText(status: string) {
		if (status === 'accepted') return 'Allerede godtatt';
		if (status === 'declined') return 'Avslått';
		if (status === 'cancelled') return 'Trukket tilbake';
		return 'Venter på svar';
	}
</script>

<svelte:head>
	<title>{meta.title}</title>
	<meta name="description" content={meta.description} />
	<meta property="og:title" content={meta.title} />
	<meta property="og:description" content={meta.description} />
	<meta property="og:image" content={meta.imageUrl} />
	<meta property="og:image:alt" content={meta.description} />
	<meta property="og:url" content={meta.url} />
	<meta property="og:site_name" content="Resonans" />
	<meta property="og:type" content="website" />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={meta.title} />
	<meta name="twitter:description" content={meta.description} />
	<meta name="twitter:image" content={meta.imageUrl} />
	<meta name="twitter:image:alt" content={meta.description} />
</svelte:head>

<div class="invite-page">
	<section class="invite-card">
		<p class="eyebrow">Partnerinvitasjon</p>
		{#if invite}
			<h1>{invite.inviterName} inviterer deg til Resonans</h1>
			<p class="lede">
				Koble dere sammen for felles oversikt, refleksjon og små hverdagsnudge i samme app.
			</p>

			<div class="invite-panel">
				<div>
					<span class="label">Invitert av</span>
					<strong>{invite.inviterName}</strong>
					{#if invite.inviterEmail}
						<p>{invite.inviterEmail}</p>
					{/if}
				</div>
				<div>
					<span class="label">Sendt til</span>
					<strong>{invite.inviteeEmail}</strong>
				</div>
				<div>
					<span class="label">Status</span>
					<strong>{statusText(invite.status)}</strong>
				</div>
			</div>

			{#if form?.error}
				<p class="error">{form.error}</p>
			{/if}

			{#if invite.status !== 'pending'}
				<p class="info">Denne invitasjonen er ikke lenger aktiv.</p>
			{:else if !currentUser}
				<div class="cta-group">
					<a class="btn-primary" href={data.signInUrl}>Logg inn for å svare</a>
					<p class="hint">Bruk Google-kontoen med adressen {invite.inviteeEmail}.</p>
				</div>
			{:else if !canRespond}
				<p class="info">
					Du er logget inn som {currentUser.email}. For å svare på invitasjonen må du bruke {invite.inviteeEmail}.
				</p>
				<a class="btn-secondary" href="/signout">Logg ut</a>
			{:else}
				<div class="cta-group cta-row">
					<form method="POST" action="?/accept">
						<button type="submit" class="btn-primary">Godta invitasjonen</button>
					</form>
					<form method="POST" action="?/decline">
						<button type="submit" class="btn-secondary">Avslå</button>
					</form>
				</div>
			{/if}
		{:else}
			<h1>Invitasjonen finnes ikke</h1>
			<p class="lede">Lenken er ugyldig eller invitasjonen er trukket tilbake.</p>
		{/if}
	</section>
</div>

<style>
	.invite-page {
		min-height: 100vh;
		padding: clamp(1.5rem, 4vw, 3rem);
		display: grid;
		place-items: center;
		background:
			radial-gradient(circle at top left, rgba(255, 217, 163, 0.45), transparent 36%),
			linear-gradient(150deg, #fcf7ef 0%, #e6efe8 46%, #d8e5f0 100%);
	}

	.invite-card {
		width: min(100%, 44rem);
		padding: clamp(1.5rem, 4vw, 3rem);
		border-radius: 2rem;
		background: rgba(255, 255, 255, 0.88);
		backdrop-filter: blur(12px);
		box-shadow: 0 26px 80px rgba(15, 23, 42, 0.14);
	}

	.eyebrow {
		margin: 0 0 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.14em;
		font-size: 0.76rem;
		color: #6b7280;
	}

	h1 {
		margin: 0;
		font-size: clamp(2.1rem, 5vw, 3.4rem);
		line-height: 0.98;
		color: #0f172a;
	}

	.lede {
		margin: 1rem 0 0;
		font-size: 1.05rem;
		line-height: 1.65;
		color: #334155;
	}

	.invite-panel {
		margin: 1.5rem 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
		gap: 0.9rem;
	}

	.invite-panel > div {
		padding: 1rem;
		border-radius: 1.1rem;
		background: #f8fafc;
		border: 1px solid rgba(148, 163, 184, 0.25);
	}

	.label {
		display: block;
		margin-bottom: 0.35rem;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #64748b;
	}

	strong {
		display: block;
		font-size: 1rem;
		color: #0f172a;
	}

	p {
		margin: 0.3rem 0 0;
		color: #475569;
	}

	.cta-group {
		margin-top: 1.5rem;
		display: grid;
		gap: 0.9rem;
	}

	.cta-row {
		grid-template-columns: repeat(auto-fit, minmax(12rem, max-content));
		align-items: center;
	}

	.btn-primary,
	.btn-secondary {
		display: inline-flex;
		justify-content: center;
		align-items: center;
		padding: 0.9rem 1.3rem;
		border-radius: 999px;
		font-weight: 600;
		text-decoration: none;
		font: inherit;
		cursor: pointer;
	}

	.btn-primary {
		border: 0;
		background: #0f172a;
		color: #fff;
	}

	.btn-secondary {
		border: 1px solid rgba(15, 23, 42, 0.14);
		background: #fff;
		color: #0f172a;
	}

	.error,
	.info,
	.hint {
		padding: 0.95rem 1rem;
		border-radius: 1rem;
	}

	.error {
		background: #fee2e2;
		color: #991b1b;
	}

	.info {
		background: #eff6ff;
		color: #1d4ed8;
	}

	.hint {
		background: #f8fafc;
		color: #475569;
	}

	@media (max-width: 640px) {
		.invite-card {
			border-radius: 1.5rem;
		}

		.cta-row {
			grid-template-columns: 1fr;
		}
	}
</style>