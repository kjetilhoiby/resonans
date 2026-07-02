/**
 * Konverterer markdown til ren tekst uten å miste selve innholdet. Brukes som et
 * tynt sikkerhetsnett på tekst som lagres i plan-felt (månedsnotat, refleksjon osv.)
 * som vises som rene textarea-er. Fjerner inline-støy (**fet**, #overskrift, lenker),
 * men BEHOLDER listestruktur — punktlister normaliseres til «- » og nummererte lister
 * beholdes, siden de leser fint som ren tekst og ofte er ønsket innhold.
 */
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
