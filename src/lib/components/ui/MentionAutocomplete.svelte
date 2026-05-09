<!--
  MentionAutocomplete — låser seg på et textarea og åpner en popover når
  bruker skriver "@". Søker mot brukerens persons-tabell og setter inn
  "@PersonName " ved valg. Bruker tastatur (↑/↓/Enter/Escape) for å navigere.

  Bruk:
    <MentionAutocomplete textareaEl={textareaRef} value={text} onValueChange={(t) => text = t} />
-->
<script lang="ts">
	import { tick } from 'svelte';

	interface Person {
		id: string;
		name: string;
		nickname: string | null;
		avatarEmoji: string | null;
		kind: string;
		aliases: string[];
	}

	interface Props {
		textareaEl: HTMLTextAreaElement | HTMLInputElement | null;
		value: string;
		onValueChange: (next: string) => void;
		disabled?: boolean;
	}

	let { textareaEl, value, onValueChange, disabled = false }: Props = $props();

	let allPersons = $state<Person[]>([]);
	let loaded = $state(false);
	let loading = $state(false);

	let open = $state(false);
	let query = $state('');
	let triggerStart = $state(-1); // posisjon der "@" står
	let highlightIndex = $state(0);
	let popoverRect = $state<{ top: number; left: number } | null>(null);

	const filtered = $derived.by(() => {
		if (!loaded) return [];
		const q = query.trim().toLowerCase();
		if (!q) return allPersons.slice(0, 6);
		return allPersons
			.filter((p) => {
				if (p.name.toLowerCase().includes(q)) return true;
				if (p.nickname && p.nickname.toLowerCase().includes(q)) return true;
				return p.aliases.some((a) => a.toLowerCase().includes(q));
			})
			.slice(0, 6);
	});

	async function ensureLoaded() {
		if (loaded || loading) return;
		loading = true;
		try {
			const res = await fetch('/api/persons');
			if (res.ok) {
				const body = await res.json();
				allPersons = (body.persons ?? []).map((p: any) => ({
					id: p.id,
					name: p.name,
					nickname: p.nickname,
					avatarEmoji: p.avatarEmoji,
					kind: p.kind,
					aliases: p.aliases ?? []
				}));
				loaded = true;
			}
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (!textareaEl || disabled) return;
		const el = textareaEl;

		const handleInput: EventListener = () => {
			updateTriggerState();
		};
		const handleKey: EventListener = (ev) => {
			const e = ev as KeyboardEvent;
			if (!open) return;
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				highlightIndex = Math.min(highlightIndex + 1, filtered.length - 1);
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				highlightIndex = Math.max(highlightIndex - 1, 0);
			} else if (e.key === 'Enter' || e.key === 'Tab') {
				if (filtered[highlightIndex]) {
					e.preventDefault();
					e.stopPropagation();
					select(filtered[highlightIndex]);
				}
			} else if (e.key === 'Escape') {
				e.preventDefault();
				close();
			}
		};
		const handleBlur: EventListener = () => {
			setTimeout(() => {
				open = false;
			}, 150);
		};

		el.addEventListener('input', handleInput);
		el.addEventListener('keydown', handleKey, { capture: true });
		el.addEventListener('blur', handleBlur);
		return () => {
			el.removeEventListener('input', handleInput);
			el.removeEventListener('keydown', handleKey, { capture: true });
			el.removeEventListener('blur', handleBlur);
		};
	});

	function updateTriggerState() {
		if (!textareaEl) return;
		const cursor = textareaEl.selectionStart ?? 0;
		const text = textareaEl.value;
		// Søk bakover fra cursor for siste '@' eller mellomrom/linjeskift
		let i = cursor - 1;
		let foundAt = -1;
		while (i >= 0) {
			const ch = text[i];
			if (ch === '@') {
				// '@' må enten være ved start eller etter whitespace
				if (i === 0 || /\s/.test(text[i - 1])) {
					foundAt = i;
				}
				break;
			}
			if (/\s/.test(ch)) break;
			i--;
		}
		if (foundAt === -1) {
			open = false;
			return;
		}
		const after = text.slice(foundAt + 1, cursor);
		// Avbryt hvis det er whitespace etter @
		if (/\s/.test(after)) {
			open = false;
			return;
		}
		query = after;
		triggerStart = foundAt;
		highlightIndex = 0;
		void ensureLoaded();
		open = true;
		void tick().then(updatePopoverPosition);
	}

	function updatePopoverPosition() {
		if (!textareaEl) return;
		const r = textareaEl.getBoundingClientRect();
		popoverRect = {
			top: r.bottom + 4,
			left: r.left
		};
	}

	function close() {
		open = false;
	}

	function select(person: Person) {
		if (!textareaEl) return;
		const text = value;
		const cursor = textareaEl.selectionStart ?? text.length;
		const before = text.slice(0, triggerStart);
		const after = text.slice(cursor);
		const insertion = `@${person.name} `;
		const next = before + insertion + after;
		onValueChange(next);
		const newCursor = before.length + insertion.length;
		void tick().then(() => {
			if (textareaEl) {
				textareaEl.focus();
				textareaEl.setSelectionRange(newCursor, newCursor);
			}
		});
		open = false;
	}
</script>

{#if open && popoverRect && filtered.length > 0}
	<ul
		class="mention-popover"
		style:top={`${popoverRect.top}px`}
		style:left={`${popoverRect.left}px`}
		role="listbox"
	>
		{#each filtered as person, idx (person.id)}
			<li>
				<button
					type="button"
					class:active={idx === highlightIndex}
					onmousedown={(e) => {
						e.preventDefault();
						select(person);
					}}
				>
					<span class="emoji">{person.avatarEmoji ?? '👤'}</span>
					<span class="name">{person.name}</span>
					{#if person.nickname}<span class="nick">({person.nickname})</span>{/if}
				</button>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.mention-popover {
		position: fixed;
		z-index: 2000;
		min-width: 220px;
		max-width: 320px;
		background: #fff;
		color: #222;
		border-radius: 12px;
		border: 1px solid #e0e0e3;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
		list-style: none;
		padding: 0.25rem;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	li { margin: 0; }
	.mention-popover button {
		width: 100%;
		text-align: left;
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.4rem 0.55rem;
		border: none;
		background: transparent;
		border-radius: 8px;
		font: inherit;
		cursor: pointer;
		color: inherit;
	}
	.mention-popover button.active,
	.mention-popover button:hover {
		background: rgba(124, 142, 245, 0.16);
	}
	.emoji { font-size: 1rem; }
	.name { font-weight: 500; }
	.nick { font-size: 0.78rem; opacity: 0.65; }
</style>
