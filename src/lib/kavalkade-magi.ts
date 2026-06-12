/**
 * Kavalkade-magi — formater for AI-generert bursdagsinnhold.
 *
 * Bursdagshilsner fra romankarakterer lagres som markdown i reflections
 * (kind 'birthday_greetings') med stabilt `## Karakter — Bok`-format,
 * slik at både server (bygging) og kavalkade-siden (visning) kan bruke det.
 */

export interface CharacterGreeting {
	character: string;
	book: string;
	text: string;
}

export function buildGreetingsMarkdown(greetings: CharacterGreeting[]): string {
	return greetings
		.filter((g) => g.character.trim() && g.text.trim())
		.map((g) => `## ${g.character.trim()} — ${g.book.trim()}\n${g.text.trim()}`)
		.join('\n\n');
}

export function parseGreetingsMarkdown(content: string): CharacterGreeting[] {
	const greetings: CharacterGreeting[] = [];
	for (const block of content.split(/^## /m)) {
		const newlineIdx = block.indexOf('\n');
		if (newlineIdx === -1) continue;
		const heading = block.slice(0, newlineIdx).trim();
		const text = block.slice(newlineIdx + 1).trim();
		if (!heading || !text) continue;
		const [character, ...bookParts] = heading.split(' — ');
		greetings.push({
			character: character.trim(),
			book: bookParts.join(' — ').trim(),
			text
		});
	}
	return greetings;
}
