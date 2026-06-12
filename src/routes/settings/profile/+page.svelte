<script lang="ts">
	import { AppPage, Button, DateInput, Input, PageHeader, PageSection, Radio, Textarea } from '$lib/components/ui';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let copyInviteMessage = $state('');

	const user = $derived(data.user);
	const relationship = $derived(data.relationship);
	const relationshipCheckin = $derived((form as any)?.relationshipCheckinStatus || data.relationshipCheckinStatus);
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

			{#if relationship?.partner && relationshipCheckin?.hasPartner}
				<div class="checkin-card">
					<h3>Daglig parsjekk</h3>
					<p class="checkin-help">
						Svar fra 1 til 7 på hvordan dere har det i dag. Svarene vises når begge har sendt inn.
					</p>

					<form method="POST" action="?/submitRelationshipCheckin" class="checkin-form">
						<input type="hidden" name="day" value={relationshipCheckin.day} />
						<fieldset class="score-grid">
							<legend>Hvordan kjennes dagen i dag?</legend>
							{#each [1, 2, 3, 4, 5, 6, 7] as score}
								<label class="score-option">
									<Radio
										name="score"
										value={String(score)}
										group={relationshipCheckin.myScore ? String(relationshipCheckin.myScore) : undefined}
										required
									/>
									<span>{score}</span>
								</label>
							{/each}
						</fieldset>

						<div class="form-group" style="margin-bottom:1rem;">
							<label for="relationshipCheckinNote">Kort notat (valgfritt)</label>
							<Textarea
								id="relationshipCheckinNote"
								name="note"
								rows={3}
								className="input"
								placeholder="Hva var bra eller krevende i dag?"
								value={relationshipCheckin.myNote || ''}
							></Textarea>
						</div>

						<Button type="submit">Lagre parsjekk</Button>
					</form>

					{#if relationshipCheckin.submitted && !relationshipCheckin.revealed}
						<div class="checkin-status waiting">
							Du har sendt inn for {relationshipCheckin.day}. Vi viser resultatet når partneren din også har svart.
						</div>
					{/if}

					{#if relationshipCheckin.revealed}
						<div class="checkin-status revealed">
							<div>
								<strong>Din score:</strong> {relationshipCheckin.myScore}
							</div>
							<div>
								<strong>Partners score:</strong> {relationshipCheckin.partnerScore}
							</div>
							{#if relationshipCheckin.partnerNote}
								<p class="checkin-note">Partnernotat: {relationshipCheckin.partnerNote}</p>
							{/if}
							{#if relationshipCheckin.followUpRecommended}
								<p class="checkin-followup">
									Forslag: ta en kort prat i kveld mens dette fortsatt er ferskt.
								</p>
							{/if}
						</div>
					{/if}
				</div>
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

	.checkin-card {
		margin-top: 1rem;
		padding: 1rem;
		border-radius: 10px;
		border: none;
		background: #111;
	}

	:global(textarea.input) {
		margin: 0 0 0.45rem;
		font-size: 1rem;
		color: var(--text-primary);
	}

	:global(.partner-invite-share) {
		flex: 1 1 20rem;
	}

	.checkin-help {
		margin: 0 0 0.85rem;
		font-size: 0.9rem;
		color: var(--text-secondary);
	}

	.checkin-form {
		display: grid;
		gap: 0.75rem;
	}

	.score-grid {
		margin: 0;
		padding: 0;
		border: 0;
	}

	.score-grid legend {
		margin-bottom: 0.45rem;
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	.score-option {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		margin-right: 0.35rem;
		margin-bottom: 0.35rem;
		min-width: 2rem;
		padding: 0.35rem 0.45rem;
		border-radius: 999px;
		border: 1px solid var(--border-color);
		background: var(--bg-input);
		cursor: pointer;
	}

	.score-option :global(.ds-radio) {
		margin-right: 0.25rem;
	}

	.checkin-status {
		margin-top: 0.75rem;
		padding: 0.75rem;
		border-radius: 8px;
		font-size: 0.9rem;
	}

	.checkin-status.waiting {
		background: var(--info-bg);
		border: 1px solid var(--info-border);
		color: var(--text-primary);
	}

	.checkin-status.revealed {
		background: color-mix(in srgb, var(--success-bg) 80%, transparent);
		border: 1px solid var(--success-border);
		color: var(--text-primary);
		display: grid;
		gap: 0.35rem;
	}

	.checkin-note {
		margin: 0.15rem 0 0;
		color: var(--text-secondary);
	}

	.checkin-followup {
		margin: 0.2rem 0 0;
		color: #f9d980;
		font-weight: 600;
	}
</style>
