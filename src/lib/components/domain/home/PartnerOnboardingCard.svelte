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
		background: linear-gradient(155deg, rgba(51, 86, 153, 0.24), rgba(25, 29, 40, 0.9));
		border: 1px solid rgba(130, 160, 255, 0.32);
		box-shadow: 0 14px 26px rgba(6, 8, 14, 0.28);
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
		color: #9fb8ff;
	}

	.partner-onboarding-card h3 {
		margin: 6px 0 8px;
		font-size: 1rem;
		line-height: 1.3;
		color: #ecf2ff;
	}

	.partner-onboarding-card p {
		margin: 0;
		font-size: 0.82rem;
		line-height: 1.45;
		color: #d2daee;
	}

	.partner-onboarding-actions {
		margin-top: 10px;
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.partner-onboarding-btn {
		border: 1px solid rgba(180, 198, 240, 0.3);
		background: rgba(13, 16, 26, 0.6);
		color: #dce4f6;
		border-radius: 999px;
		padding: 7px 12px;
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
	}

	.partner-onboarding-btn.primary {
		background: linear-gradient(145deg, #5476ef, #4364d9);
		border-color: transparent;
		color: #fff;
	}
</style>
