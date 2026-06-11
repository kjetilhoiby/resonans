<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { AppPage, PageSection, PageHeader, SectionCard, Button } from '$lib/components/ui';
	import FlowSheet from '$lib/components/flows/FlowSheet.svelte';
	import { FLOWS } from '$lib/flows/registry';
	import type { InterviewAnswers } from '$lib/flows/birthday-interview';
	import {
		KavalkadeStats,
		Ordsky,
		MonthTimeline,
		GreetingsList,
		InterviewAnswerList,
		timelineHasContent,
		type Greeting,
		type MonthEntry,
		type OrdskyWordView,
		type YearData
	} from '$lib/components/domain/kavalkade';

	interface Props {
		data: {
			birthday: { hasBirthDate: boolean; daysUntil: number | null; turningAge: number | null };
			windowLabels: { current: string; previous: string };
			current: YearData;
			previous: YearData;
			timeline: MonthEntry[];
			ordsky: OrdskyWordView[];
			interview: {
				thisYearKey: string;
				thisYear: InterviewAnswers | null;
				lastYear: InterviewAnswers | null;
				lastYearText: string;
				kavalkadeText: string;
			};
			prophecy: string | null;
			greetings: Greeting[];
		};
	}

	let { data }: Props = $props();

	let interviewOpen = $state(false);
	let magiLoading = $state<'prophecy' | 'greetings' | null>(null);
	let magiError = $state('');

	const introText = $derived.by(() => {
		const { hasBirthDate, daysUntil, turningAge } = data.birthday;
		if (hasBirthDate && daysUntil !== null && turningAge !== null) {
			if (daysUntil === 0) return `Gratulerer med dagen! I dag fyller du ${turningAge} år.`;
			if (daysUntil === 1) return `I morgen fyller du ${turningAge} år. Her er året som har gått.`;
			return `Om ${daysUntil} dager fyller du ${turningAge} år. Her er året som har gått.`;
		}
		return 'De siste tolv månedene i tall — og et intervju med deg selv.';
	});

	const hasBooksForGreetings = $derived(
		data.current.books.length > 0 || data.previous.books.length > 0
	);

	async function runMagi(kind: 'prophecy' | 'greetings') {
		magiLoading = kind;
		magiError = '';
		try {
			const res = await fetch('/api/kavalkade/magi', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ kind })
			});
			if (!res.ok) {
				const err = await res.json().catch(() => null);
				magiError = err?.error ?? 'Noe gikk galt. Prøv igjen.';
				return;
			}
			await invalidateAll();
		} catch {
			magiError = 'Noe gikk galt. Prøv igjen.';
		} finally {
			magiLoading = null;
		}
	}
</script>

<svelte:head>
	<title>Årskavalkade</title>
</svelte:head>

<AppPage>
	<PageSection>
		<div class="kavalkade-page">
			<PageHeader title="Årskavalkade" titleHref="/" emoji="🎂" />
			<p class="kv-intro">{introText}</p>

			<div class="kv-show-cta">
				<Button href="/kavalkade/show">▶&nbsp; Spill av året</Button>
			</div>

			<SectionCard title="Året i tall" meta={data.windowLabels.current}>
				<KavalkadeStats current={data.current} previous={data.previous} />
			</SectionCard>

			{#if data.ordsky.length > 0}
				<SectionCard title="Året i ord" description="Det du faktisk skrev på oppgavelistene dine">
					<Ordsky words={data.ordsky} />
				</SectionCard>
			{/if}

			{#if timelineHasContent(data.timeline)}
				<SectionCard title="Måned for måned">
					<MonthTimeline months={data.timeline} />
				</SectionCard>
			{/if}

			{#if data.current.books.length > 0}
				<SectionCard title="Lest i år" meta={`${data.current.books.length} bøker`}>
					<ul class="kv-books">
						{#each data.current.books as book (book.title)}
							<li>{book.title}{book.author ? ` — ${book.author}` : ''}</li>
						{/each}
					</ul>
				</SectionCard>
			{/if}

			<SectionCard
				title="Spådommen"
				description={data.prophecy
					? undefined
					: 'La kavalkaden, intervjuet og trendene dine spå året frem til neste bursdag.'}
			>
				{#if data.prophecy}
					<div class="kv-prophecy">
						{#each data.prophecy.split(/\n{2,}/) as paragraph}
							<p>{paragraph}</p>
						{/each}
					</div>
				{/if}
				<div class="kv-cta">
					<Button
						variant={data.prophecy ? 'secondary' : 'primary'}
						disabled={magiLoading !== null}
						onClick={() => void runMagi('prophecy')}
					>
						{magiLoading === 'prophecy'
							? 'Ser i krystallkulen …'
							: data.prophecy
								? 'Spå på nytt'
								: 'Spå året som kommer'}
					</Button>
				</div>
			</SectionCard>

			{#if data.interview.thisYear}
				<SectionCard title="Hvem er du i år?" meta={data.interview.thisYearKey}>
					<InterviewAnswerList answers={data.interview.thisYear} />
					<div class="kv-cta">
						<Button variant="secondary" onClick={() => (interviewOpen = true)}>
							Gjør intervjuet på nytt
						</Button>
					</div>
				</SectionCard>
			{:else}
				<SectionCard
					title="Bursdagsintervjuet"
					description="Hvem er du i år — og hvem var du i fjor? Ti spørsmål om endringer, minner og årets beste. Svarene lagres, så neste år kan du se deg selv i speilet."
				>
					<div class="kv-cta">
						<Button onClick={() => (interviewOpen = true)}>Start bursdagsintervjuet</Button>
					</div>
				</SectionCard>
			{/if}

			{#if hasBooksForGreetings}
				<SectionCard
					title="Hilsner fra bokhylla"
					description={data.greetings.length > 0
						? undefined
						: 'Romankarakterene du har tilbrakt året med vil gjerne gratulere deg.'}
				>
					{#if data.greetings.length > 0}
						<GreetingsList greetings={data.greetings} />
					{/if}
					<div class="kv-cta">
						<Button
							variant={data.greetings.length > 0 ? 'secondary' : 'primary'}
							disabled={magiLoading !== null}
							onClick={() => void runMagi('greetings')}
						>
							{magiLoading === 'greetings'
								? 'Vekker karakterene …'
								: data.greetings.length > 0
									? 'Hent nye hilsner'
									: 'Hent bursdagshilsner'}
						</Button>
					</div>
				</SectionCard>
			{/if}

			{#if magiError}
				<p class="kv-error">{magiError}</p>
			{/if}

			{#if data.interview.lastYear}
				<SectionCard title="Hvem var du i fjor?" meta={String(Number(data.interview.thisYearKey) - 1)}>
					<InterviewAnswerList answers={data.interview.lastYear} />
				</SectionCard>
			{/if}
		</div>
	</PageSection>
</AppPage>

<FlowSheet
	flow={interviewOpen ? FLOWS.birthday_interview : null}
	context={{
		initialData: {
			_lastYearAnswers: data.interview.lastYearText,
			_kavalkadeSummary: data.interview.kavalkadeText
		}
	}}
	onclose={() => (interviewOpen = false)}
	oncomplete={async () => {
		interviewOpen = false;
		await invalidateAll();
	}}
/>

<style>
	.kavalkade-page {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding-bottom: 110px;
	}

	.kv-intro {
		margin: 0;
		color: var(--text-secondary);
		font-size: var(--font-size-body);
	}

	.kv-show-cta {
		display: flex;
	}

	.kv-books {
		margin: 0;
		padding-left: 18px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: var(--font-size-body);
		color: var(--text-primary);
	}

	.kv-prophecy p {
		margin: 0 0 10px;
		font-size: var(--font-size-body);
		color: var(--text-primary);
	}

	.kv-prophecy p:last-child {
		margin-bottom: 0;
	}

	.kv-error {
		margin: 0;
		font-size: var(--font-size-caption);
		color: var(--error-text);
	}

	.kv-cta {
		margin-top: 12px;
	}
</style>
