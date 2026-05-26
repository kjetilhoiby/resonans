<!--
  MentionText — renderer en tekst og fremhever @-mentions som styled spans.
  Bruker en enkel regex som matcher @<bokstaver/tall> (inkludert norske tegn).
  Ingen DB-oppslag — vi vet ikke om navnet faktisk matcher en person, men
  det visuelle hintet er nok for å gjøre @-bruk lesbar.
-->
<script lang="ts">
	let { text }: { text: string } = $props();

	type Part = { kind: 'text' | 'mention'; value: string };

	function splitMentions(input: string): Part[] {
		const re = /@([\p{L}\p{N}_]+)/gu;
		const out: Part[] = [];
		let last = 0;
		let match: RegExpExecArray | null;
		while ((match = re.exec(input)) !== null) {
			if (match.index > last) out.push({ kind: 'text', value: input.slice(last, match.index) });
			out.push({ kind: 'mention', value: match[0] });
			last = re.lastIndex;
		}
		if (last < input.length) out.push({ kind: 'text', value: input.slice(last) });
		return out;
	}

	const parts = $derived(splitMentions(text));
</script>

{#each parts as part}
	{#if part.kind === 'mention'}<span class="mention">{part.value}</span>{:else}{part.value}{/if}
{/each}

<style>
	.mention {
		color: var(--accent-primary, #7c8ef5);
		font-weight: 500;
	}
</style>
