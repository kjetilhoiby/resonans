<!--
  GreetingsList — bursdagshilsner fra romankarakterer som sitatkort
  med karakter- og bok-attribusjon.
-->
<script lang="ts">
	import type { Greeting } from './types';

	interface Props {
		greetings: Greeting[];
	}

	let { greetings }: Props = $props();
</script>

<div class="kv-greetings">
	{#each greetings as greeting (greeting.character + greeting.book)}
		<blockquote class="kv-greeting">
			<p>{greeting.text}</p>
			<footer>
				— {greeting.character}{greeting.book ? `, «${greeting.book}»` : ''}
			</footer>
		</blockquote>
	{/each}
</div>

<style>
	.kv-greetings {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.kv-greeting {
		margin: 0;
		padding: 10px 12px;
		background: var(--card-bg-inset);
		border-left: 2px solid var(--accent-muted);
		border-radius: var(--radius-md, 10px);
	}

	.kv-greeting p {
		margin: 0;
		font-size: var(--font-size-body);
		font-style: italic;
		color: var(--text-primary);
		white-space: pre-wrap;
	}

	.kv-greeting footer {
		margin-top: 6px;
		font-size: var(--font-size-caption);
		color: var(--text-secondary);
	}
</style>
