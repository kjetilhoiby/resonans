<script lang="ts">
	import { AppPage, PageSection, PageHeader, SectionCard } from '$lib/components/ui';
	import {
		KavalkadeStats,
		Ordsky,
		MonthTimeline,
		GreetingsList,
		InterviewAnswerList
	} from '$lib/components/domain/kavalkade';
	import {
		kavalkadeCurrentYearMock,
		kavalkadePreviousYearMock,
		kavalkadeOrdskyMock,
		kavalkadeTimelineMock,
		kavalkadeGreetingsMock,
		kavalkadeInterviewAnswersMock
	} from '../mocks';

	// UTKAST: «Festskinn» for kavalkade-siden — klare, mettede farger tar over
	// som bakgrunn (Wrapped-plakat), i stedet for duse hint på nær sort.
	// Implementert som rene token-overrides per plakat (--card-*, --text-*,
	// --kv-*) — komponentene er appens faktiske, uendret. Mock-data, ikke i
	// visuell regresjon. Tas skinnet i bruk flyttes overridene til /kavalkade.
</script>

<svelte:head>
	<title>Design — kavalkade festskinn</title>
</svelte:head>

<AppPage>
	<PageSection>
		<div class="fest-page">
			<PageHeader title="Festskinn (utkast)" titleHref="/design" emoji="🎉" />
			<p class="fest-intro">
				Kavalkade-kortene der fargen ER flaten. Samme komponenter som på /kavalkade —
				bare token-overrides per plakat.
			</p>

			<div class="poster" style="--fh: 258;">
				<SectionCard title="Året i tall" meta="18. juni 2025 – 17. juni 2026">
					<KavalkadeStats current={kavalkadeCurrentYearMock} previous={kavalkadePreviousYearMock} />
				</SectionCard>
			</div>

			<div class="poster" style="--fh: 12;">
				<SectionCard title="Året i ord" description="Det du faktisk skrev på oppgavelistene dine">
					<Ordsky words={kavalkadeOrdskyMock} />
				</SectionCard>
			</div>

			<div class="poster" style="--fh: 152;">
				<SectionCard title="Måned for måned">
					<MonthTimeline months={kavalkadeTimelineMock} />
				</SectionCard>
			</div>

			<div class="poster" style="--fh: 320;">
				<SectionCard title="Hilsner fra bokhylla">
					<GreetingsList greetings={kavalkadeGreetingsMock} />
				</SectionCard>
			</div>

			<div class="poster" style="--fh: 205;">
				<SectionCard title="Hvem er du i år?" meta="2026">
					<InterviewAnswerList answers={kavalkadeInterviewAnswersMock} />
				</SectionCard>
			</div>
		</div>
	</PageSection>
</AppPage>

<style>
	.fest-page {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding-bottom: 110px;
	}

	.fest-intro {
		margin: 0;
		color: var(--text-secondary);
		font-size: var(--font-size-body);
	}

	/* Plakat-skinnet: én mettet kulør per kort, hvit typografi.
	   Alt settes som token-overrides — ingen komponent-forks. */
	.poster {
		--card-bg: linear-gradient(160deg, hsl(var(--fh) 86% 56%) 0%, hsl(calc(var(--fh) + 28) 84% 46%) 100%);
		--card-bg-subtle: hsl(var(--fh) 84% 52%);
		--card-bg-inset: hsl(var(--fh) 75% 38% / 0.5);
		--card-border: transparent;
		--text-primary: #fff;
		--text-secondary: hsl(var(--fh) 100% 90%);
		--text-tertiary: hsl(var(--fh) 100% 86% / 0.85);
		--section-label-color: hsl(var(--fh) 100% 90%);
		--kv-stat-bg: hsl(var(--fh) 75% 38% / 0.45);
		--kv-stat-edge: rgb(255 255 255 / 0.65);
		--kv-stat-value-color: #fff;
		--kv-ord-color: #fff;
		--kv-greeting-edge: rgb(255 255 255 / 0.75);
	}
</style>
