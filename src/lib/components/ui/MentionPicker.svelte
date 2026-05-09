<script lang="ts">
	import type { MentionPerson } from '$lib/utils/mention-input.svelte';

	interface Props {
		visible: boolean;
		persons: MentionPerson[];
		anchorEl: HTMLElement | null;
		onSelect: (person: MentionPerson) => void;
		onClose: () => void;
	}

	let { visible, persons, anchorEl, onSelect, onClose }: Props = $props();

	let selectedIndex = $state(0);

	$effect(() => {
		if (visible) selectedIndex = 0;
	});

	let style = $derived.by(() => {
		if (!visible || !anchorEl) return '';
		const rect = anchorEl.getBoundingClientRect();
		const above = window.innerHeight - rect.top + 6;
		return `bottom:${above}px; left:${Math.max(8, rect.left)}px; max-width:${rect.width}px;`;
	});

	export function handleKeydown(e: KeyboardEvent): boolean {
		if (!visible || persons.length === 0) return false;
		if (e.key === 'ArrowDown') {
			selectedIndex = (selectedIndex + 1) % persons.length;
			e.preventDefault();
			return true;
		}
		if (e.key === 'ArrowUp') {
			selectedIndex = (selectedIndex - 1 + persons.length) % persons.length;
			e.preventDefault();
			return true;
		}
		if (e.key === 'Enter' || e.key === 'Tab') {
			const p = persons[selectedIndex];
			if (p) { onSelect(p); e.preventDefault(); return true; }
		}
		if (e.key === 'Escape') {
			onClose();
			e.preventDefault();
			return true;
		}
		return false;
	}
</script>

{#if visible && persons.length > 0}
	<div class="mention-picker" style={style} role="listbox" aria-label="Velg person">
		{#each persons as person, i (person.id)}
			<button
				class="mention-item"
				class:selected={i === selectedIndex}
				role="option"
				aria-selected={i === selectedIndex}
				onmousedown={(e) => { e.preventDefault(); onSelect(person); }}
				onmousemove={() => { selectedIndex = i; }}
			>
				<span class="emoji">{person.avatarEmoji ?? '👤'}</span>
				<span class="name">{person.name}</span>
			</button>
		{/each}
	</div>
{/if}

<style>
	.mention-picker {
		position: fixed;
		z-index: 1000;
		background: #1a1a2e;
		border: 1px solid #3a3a5c;
		border-radius: 10px;
		padding: 4px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
		min-width: 160px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.mention-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 10px;
		border: none;
		border-radius: 7px;
		background: transparent;
		color: #dde1f0;
		font: inherit;
		font-size: 0.9rem;
		cursor: pointer;
		text-align: left;
		transition: background 0.1s;
		white-space: nowrap;
	}

	.mention-item:hover,
	.mention-item.selected {
		background: #2a2a44;
	}

	.emoji {
		font-size: 1rem;
		flex-shrink: 0;
	}

	.name {
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
