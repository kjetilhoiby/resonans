<script lang="ts">
	import { AppPage, Button, DateInput, Input, PageHeader, PageSection } from '$lib/components/ui';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let copyInviteMessage = $state('');

	const user = $derived(data.user);
	const relationship = $derived(data.relationship);
	const partnerInviteShareUrl = $derived(data.partnerInviteShareUrl);

	// ── Fødselsdato (self-personen — driver kavalkaden og selvangivelse-fristen) ──
	let birthDateValue = $state(data.selfBirthDate ?? '');
	let birthDateState = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');

	async function saveBirthDate() {
		birthDateState = 'saving';
		try {
			const res = await fetch('/api/profile/birthdate', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ birthDate: birthDateValue || null })
			});
			birthDateState = res.ok ? 'saved' : 'error';
		} catch {
			birthDateState = 'error';
		}
		if (birthDateState === 'saved') setTimeout(() => (birthDateState = 'idle'), 1800);
	}

	async function copyPartnerInviteLink() {
		if (!partnerInviteShareUrl) return;

		try {
			await navigator.clipboard.writeText(partnerInviteShareUrl);
			copyInviteMessage = 'Lenken er kopiert.';
		} catch (error) {
			console.error('Failed to copy partner invite link:', error);
			copyInviteMessage = 'Kunne ikke kopiere lenken automatisk.';
		}

		setTimeout(() => {
			copyInviteMessage = '';
		}, 2500);
	}
</script>

<svelte:head>
	<title>Profil – Innstillinger | Resonans</title>
</svelte:head>

<AppPage className="settings-profile-page">
	<PageSection>
	<PageHeader
		title="Profil"
		titleHref="/settings"
		titleLabel="Tilbake til innstillinger"
	/>

	<main class="content">
		{#if form?.success}
			<div class="alert success">
				✅ {form.message || 'Innstillingene dine ble lagret!'}
			</div>
		{/if}

		{#if form?.error}
			<div class="alert error">
				❌ {form.error}
			</div>
		{/if}

		<section class="settings-card">
			<div class="card-icon">👤</div>
			<h2>Profil</h2>
			<p class="help-text">
				Samle personinfo på ett sted. Navn, e-post og fødselsdato vises her nå; høyde og kjønn kan legges til i neste steg.
			</p>
			<div class="notification-option">
				<div class="option-info">
					<strong>Navn</strong>
					<p>{user?.name || 'Ikke satt'}</p>
				</div>
			</div>
			<div class="notification-option">
				<div class="option-info">
					<strong>E-post</strong>
					<p>{user?.email || 'Ikke satt'}</p>
				</div>
			</div>
			<div class="notification-option">
				<div class="option-info">
					<strong>Fødselsdato</strong>
					<p>Driver årskavalkaden og selvangivelsens frist (midnatt kvelden før bursdagen).</p>
					<div class="birthdate-row">
						<DateInput bind:value={birthDateValue} ariaLabel="Fødselsdato" />
						<Button
							variant="secondary"
							ariaLabel="Lagre fødselsdato"
							disabled={birthDateState === 'saving'}
							onClick={() => void saveBirthDate()}
						>
							{birthDateState === 'saving'
								? 'Lagrer …'
								: birthDateState === 'saved'
									? 'Lagret ✓'
									: birthDateState === 'error'
										? 'Prøv igjen'
										: 'Lagre'}
						</Button>
					</div>
				</div>
			</div>
			<div class="notification-option">
				<div class="option-info">
					<strong>Bilde</strong>
					<p>Hentes fra innloggingsleverandør (kommer som redigerbart felt senere).</p>
				</div>
			</div>
			<div class="notification-option">
				<div class="option-info">
					<strong>Høyde og kjønn</strong>
					<p>Ikke modellert i brukerprofil enda. Kan legges til som neste iterasjon.</p>
				</div>
			</div>
		</section>

		<section class="settings-card">
			<div class="card-icon">💍</div>
			<h2>Partner</h2>
			<p class="help-text">
				Inviter partneren din inn i appen, og la den andre parten bekrefte koblingen.
			</p>

			{#if relationship?.partner}
				<div class="notification-option" style="background: var(--success-bg); border-color: var(--success-border);">
					<div class="option-info">
						<strong style="color: var(--success-text);">✅ Partnerkoblingen er bekreftet</strong>
						<p style="color: var(--success-text);">
							Du er koblet til {relationship.partner.name || relationship.partner.email}.
						</p>
					</div>
				</div>
			{:else}
				{#if relationship?.incomingInvite}
					<div class="notification-option" style="margin-bottom: 1rem;">
						<div class="option-info">
							<strong>Innkommende partnerinvitasjon</strong>
							<p>{relationship.incomingInvite.inviterName} vil koble seg til deg i Resonans.</p>
						</div>
						<div style="display:flex; gap:0.75rem; flex-wrap:wrap; margin-top:0.75rem;">
							<form method="POST" action="?/acceptMarriageInvite">
								<input type="hidden" name="inviteId" value={relationship.incomingInvite.id} />
								<Button type="submit">💞 Godta</Button>
							</form>
							<form method="POST" action="?/declineMarriageInvite">
								<input type="hidden" name="inviteId" value={relationship.incomingInvite.id} />
								<Button type="submit" variant="secondary">Nei takk</Button>
							</form>
						</div>
					</div>
				{/if}

				{#if relationship?.outgoingInvite}
					<div class="notification-option" style="margin-bottom: 1rem;">
						<div class="option-info">
							<strong>Invitasjon sendt</strong>
							<p>
								Venter på svar fra {relationship.outgoingInvite.inviteeEmail}.
							</p>
							{#if partnerInviteShareUrl}
								<div style="margin-top:0.75rem; display:grid; gap:0.5rem;">
									<label for="partnerInviteShareUrl">Delingslenke</label>
									<div style="display:flex; gap:0.5rem; flex-wrap:wrap; align-items:center;">
										<Input
											id="partnerInviteShareUrl"
											className="input partner-invite-share"
											value={partnerInviteShareUrl}
											readonly
										/>
										<Button type="button" variant="secondary" onClick={copyPartnerInviteLink}>Kopier lenke</Button>
									</div>
									{#if copyInviteMessage}
										<small class="hint">{copyInviteMessage}</small>
									{/if}
								</div>
							{/if}
						</div>
						<form method="POST" action="?/cancelMarriageInvite" style="margin-top:0.75rem;">
							<input type="hidden" name="inviteId" value={relationship.outgoingInvite.id} />
							<Button type="submit" variant="secondary">Trekk tilbake invitasjonen</Button>
						</form>
					</div>
				{:else}
					<form method="POST" action="?/invitePartner">
						<div class="form-group">
							<label for="inviteeEmail">Partnerens e-postadresse</label>
							<Input
								type="email"
								id="inviteeEmail"
								name="inviteeEmail"
								placeholder="partner@example.com"
								className="input"
								required
							/>
							<small class="hint">
								Når invitasjonen er sendt, blir e-posten også lagt til i invite-only-listen.
							</small>
						</div>
						<Button type="submit">💌 Send partnerinvitasjon</Button>
					</form>
				{/if}
			{/if}

			{#if relationship?.partner}
				<p class="hint">
					Den daglige parsjekken finner dere på <a href="/tema/familie">Familie-temaet</a>.
				</p>
			{/if}
		</section>
	</main>
	</PageSection>
</AppPage>

<style>
	:global(.settings-profile-page) {
		color: var(--text-secondary);
	}

	.content {
		padding: 1.5rem 1rem;
	}

	.alert {
		padding: 1rem;
		border-radius: 8px;
		margin-bottom: 1.5rem;
		font-size: 0.9rem;
	}

	.alert.success {
		background: var(--success-bg);
		color: var(--success-text);
		border: 1px solid var(--success-border);
	}

	.alert.error {
		background: var(--error-bg);
		color: var(--error-text);
		border: 1px solid var(--error-border);
	}

	.settings-card {
		background: #171717;
		border: none;
		border-radius: 12px;
		padding: 1.5rem;
		margin-bottom: 1.5rem;
	}

	.card-icon {
		font-size: 2rem;
		margin-bottom: 1rem;
		display: inline-block;
	}

	.settings-card h2 {
		margin: 0 0 0.5rem 0;
		color: var(--text-primary);
		font-size: 1.25rem;
		font-weight: 600;
	}

	.help-text {
		color: var(--text-secondary);
		margin-bottom: 1.5rem;
		line-height: 1.6;
	}

	.form-group {
		margin-bottom: 1.5rem;
	}

	label {
		display: block;
		font-weight: 600;
		margin-bottom: 0.5rem;
		color: var(--text-primary);
		font-size: 0.9rem;
	}

	:global(.input) {
		width: 100%;
		padding: 0.75rem;
		border: 1px solid var(--border-color);
		border-radius: 8px;
		font-size: 0.95rem;
		transition: all 0.2s;
		background: var(--bg-input);
		color: var(--text-primary);
	}

	:global(.input:focus) {
		outline: none;
		border-color: var(--accent-primary);
		box-shadow: 0 0 0 3px var(--info-bg);
	}

	.hint {
		display: block;
		margin-top: 0.5rem;
		color: var(--text-tertiary);
		font-size: 0.85rem;
	}

	.notification-option {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem;
		background: #111;
		border: none;
		border-radius: 8px;
		margin-bottom: 1rem;
	}

	.birthdate-row {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 0.5rem;
	}

	.option-info strong {
		display: block;
		margin-bottom: 0.25rem;
		color: var(--text-primary);
		font-weight: 600;
	}

	.option-info p {
		margin: 0;
		color: var(--text-secondary);
		font-size: 0.875rem;
	}

	:global(.partner-invite-share) {
		flex: 1 1 20rem;
	}

	.hint a {
		color: var(--accent-primary);
	}
</style>
