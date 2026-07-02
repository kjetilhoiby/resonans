/**
 * Rensing av AI-chat-tekst før den lagres i plan-felt som alltid vises som rene
 * textarea-er (månedsnotat, ukesnotat, refleksjon). Chat-svarene inneholder ofte
 * markdown (**fet**, punktlister, overskrifter) og samtale-innpakning («Her er et
 * utkast:», «Supert. Her er et forslag …:», avsluttende «Vil du at jeg …?»). Feltene
 * rendrer råtekst, så alt dette lekker synlig inn. Her koker vi ned til ren tekst.
 */

// Innledninger som modellen typisk starter med før selve innholdet.
const OPENER =
	/^(supert|flott|klart|helt enig|absolutt|selvsagt|ja[,! ]|jepp|takk|her (er|kommer)|nedenfor|under her|som (du )?ba om|ok[,! ])/i;

/** Konverterer markdown til ren tekst uten å miste selve innholdet. */
export function markdownToPlain(input: string): string {
	if (!input) return '';
	let t = input.replace(/\r\n/g, '\n');

	// Kodeblokker og inline-kode → behold innholdet, fjern fnutter.
	t = t.replace(/```[^\n]*\n([\s\S]*?)```/g, '$1');
	t = t.replace(/`([^`]+)`/g, '$1');

	// Bilder og lenker → behold synlig tekst.
	t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
	t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

	// Fet/kursiv.
	t = t.replace(/\*\*\*([^*]+)\*\*\*/g, '$1');
	t = t.replace(/\*\*([^*]+)\*\*/g, '$1');
	t = t.replace(/\*([^*\n]+)\*/g, '$1');
	t = t.replace(/___([^_]+)___/g, '$1');
	t = t.replace(/__([^_]+)__/g, '$1');
	// Kursiv med understrek — ikke rør snake_case inne i ord.
	t = t.replace(/(^|[^\w])_([^_\n]+)_(?=[^\w]|$)/g, '$1$2');

	// Gjennomstreking.
	t = t.replace(/~~([^~]+)~~/g, '$1');

	// Linje-nivå: overskrifter, sitatblokk, punktmarkører.
	const lines = t.split('\n').map((line) => {
		let l = line.replace(/^\s{0,3}#{1,6}\s+/, ''); // # overskrift
		l = l.replace(/^(\s*)>\s?/, '$1'); // > sitat
		l = l.replace(/^(\s*)[-*+]\s+/, '$1- '); // punktliste → «- »
		return l.replace(/[ \t]+$/, '');
	});

	return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Renser et chat-svar til ren feltverdi: fjerner markdown, en innledende
 * samtale-linje («Her er et utkast:») og et avsluttende meta-spørsmål rettet mot
 * brukeren («Vil du at jeg …?»).
 */
export function cleanPlanField(raw: string): string {
	let t = markdownToPlain(raw ?? '');
	if (!t) return '';

	// Fjern en innledende samtale-linje som avslutter med kolon («Her er et utkast:»,
	// «Supert. Her er et forslag …:») — kun når det finnes reelt innhold etterpå.
	const lines = t.split('\n');
	let first = 0;
	while (first < lines.length && lines[first].trim() === '') first++;
	if (first < lines.length) {
		const line = lines[first].trim();
		if (OPENER.test(line) && line.endsWith(':')) {
			const rest = lines.slice(first + 1).join('\n').trim();
			if (rest) lines.splice(first, 1);
		}
	}
	t = lines.join('\n').replace(/^\n+/, '');

	// Fjern et avsluttende avsnitt som er et spørsmål rettet mot brukeren
	// («Vil du at jeg også skal koke dette ned …?»).
	const paras = t.split(/\n{2,}/);
	if (paras.length > 1) {
		const last = paras[paras.length - 1].trim();
		if (last.endsWith('?') && /\b(du|deg|din|ditt|dine)\b/i.test(last)) {
			paras.pop();
		}
	}

	return paras.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}
