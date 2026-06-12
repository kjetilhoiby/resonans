<!--
  InterviewAnswerList — bursdagsintervjuets svar, seksjon for seksjon i
  spørsmålsrekkefølgen fra INTERVIEW_SECTIONS. Brukes for både «i år» og «i fjor».
-->
<script lang="ts">
	import { SectionLabel } from '$lib/components/ui';
	import { INTERVIEW_SECTIONS, type InterviewAnswers } from '$lib/flows/birthday-interview';

	interface Props {
		answers: InterviewAnswers;
	}

	let { answers }: Props = $props();
</script>

<div class="kv-answers">
	{#each INTERVIEW_SECTIONS as section (section.id)}
		{#if answers[section.id]}
			<div class="kv-answer">
				<SectionLabel tag="h4">{section.heading}</SectionLabel>
				<p>{answers[section.id]}</p>
			</div>
		{/if}
	{/each}
</div>

<style>
	.kv-answers {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.kv-answer p {
		margin: 4px 0 0;
		font-size: var(--font-size-body);
		color: var(--text-primary);
		white-space: pre-wrap;
	}
</style>
