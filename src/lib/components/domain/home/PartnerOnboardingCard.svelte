<!--
  Partner-onboarding-kort for hjemskjermen.
  Ren presentasjonskomponent: kicker + tittel + brødtekst + handlingsknapper.
  Trukket ut fra HomeThemeZone (variant «theme») og HomeWidgetZone (variant «widget»)
  — markup og CSS uendret. Variantene styrer kun den opprinnelige modifikator-klassen
  (partner-onboarding-card-theme / widget-item-full).
-->
<script lang="ts">
	export interface PartnerOnboardingAction {
		label: string;
		onClick: () => void;
		primary?: boolean;
	}

	interface Props {
		kicker: string;
		title: string;
		body: string;
		actions: PartnerOnboardingAction[];
		variant?: 'theme' | 'widget';
	}

	let { kicker, title, body, actions, variant }: Props = $props();
</script>

<div
	class="partner-onboarding-card"
	class:partner-onboarding-card-theme={variant === 'theme'}
	class:widget-item-full={variant === 'widget'}
>
	<p class="partner-onboarding-kicker">{kicker}</p>
	<h3>{title}</h3>
	<p>{body}</p>
	<div class="partner-onboarding-actions">
		{#each actions as action}
			<button class="partner-onboarding-btn" class:primary={action.primary} onclick={action.onClick}>{action.label}</button>
		{/each}
	</div>
</div>

<style>
	.partner-onboarding-card {
		width: 100%;
		padding: 14px;
		border-radius: 14px;
		background: linear-gradient(155deg, color-mix(in srgb, var(--accent-primary) 24%, transparent), color-mix(in srgb, var(--bg-card) 90%, transparent));
		border: 1px solid var(--info-border);
		box-shadow: var(--shadow-md);
	}

	.partner-onboarding-card-theme {
		margin-bottom: 10px;
	}

	.widget-item-full {
		flex: 0 0 100%;
	}

	.partner-onboarding-kicker {
		margin: 0;
		font-size: 0.68rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--accent-muted);
	}

	.partner-onboarding-card h3 {
		margin: 6px 0 8px;
		font-size: 1rem;
		line-height: 1.3;
		color: var(--text-primary);
	}

	.partner-onboarding-card p {
		margin: 0;
		font-size: 0.82rem;
		line-height: 1.45;
		color: var(--text-secondary);
	}

	.partner-onboarding-actions {
		margin-top: 10px;
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.partner-onboarding-btn {
		border: 1px solid var(--border-color);
		background: color-mix(in srgb, var(--bg-primary) 60%, transparent);
		color: var(--text-primary);
		border-radius: 999px;
		padding: 7px 12px;
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
	}

	.partner-onboarding-btn.primary {
		background: linear-gradient(145deg, var(--accent-primary), var(--accent-hover));
		border-color: transparent;
		color: var(--accent-contrast);
	}
</style>
