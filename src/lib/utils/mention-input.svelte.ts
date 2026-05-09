/**
 * Composable for @mention-triggering i textarea/input.
 * Bruk createMentionState() i script-blokken til et Svelte 5-komponent.
 */

export interface MentionPerson {
	id: string;
	name: string;
	avatarEmoji: string | null;
	kind: string;
}

export function createMentionState() {
	let query   = $state('');
	let visible = $state(false);
	let triggerIndex = $state(-1);

	let _persons: MentionPerson[] = [];
	let _fetched = false;

	async function ensurePersons() {
		if (_fetched) return;
		_fetched = true;
		try {
			const res = await fetch('/api/persons');
			if (res.ok) {
				const data = await res.json() as { persons?: MentionPerson[] };
				_persons = data.persons ?? [];
			}
		} catch {
			// still works, just no suggestions
		}
	}

	function scan(value: string, cursorPos: number) {
		const before = value.slice(0, cursorPos);
		// Matcher @ etterfulgt av norske tegn/bokstaver (ingen mellomrom)
		const match = before.match(/@([\p{L}\p{N}_-]*)$/u);
		if (match) {
			query = match[1];
			triggerIndex = cursorPos - match[0].length;
			visible = true;
			void ensurePersons();
		} else {
			visible = false;
			query = '';
			triggerIndex = -1;
		}
	}

	function insert(
		personName: string,
		getValue: () => string,
		getCursor: () => number,
		setValue: (v: string) => void,
		afterInsert?: (newCursor: number) => void
	) {
		const value = getValue();
		const cursorPos = getCursor();
		const before = value.slice(0, triggerIndex);
		const after  = value.slice(cursorPos);
		const token  = `@${personName} `;
		setValue(before + token + after);
		const newCursor = triggerIndex + token.length;
		afterInsert?.(newCursor);
		visible = false;
		query = '';
		triggerIndex = -1;
	}

	function close() {
		visible = false;
		query = '';
		triggerIndex = -1;
	}

	function getFiltered(): MentionPerson[] {
		if (!query) return _persons.slice(0, 8);
		const q = query.toLowerCase();
		return _persons
			.filter(p => p.name.toLowerCase().includes(q))
			.slice(0, 6);
	}

	return {
		get query()        { return query; },
		get visible()      { return visible; },
		set visible(v: boolean) { visible = v; },
		get triggerIndex() { return triggerIndex; },
		get filtered()     { return getFiltered(); },
		scan,
		insert,
		close
	};
}
