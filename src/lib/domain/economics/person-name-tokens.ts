/**
 * Navnetokens til navnematching mot bankdata.
 *
 * Delt fordi `MIN_NAME_TOKEN_LENGTH` er et **kalibreringstall**, og to kopier av et
 * kalibreringstall driver fra hverandre — samme lærdom som `MET_CALIBRATION`, der faktorene
 * lå i to filer og planleggeren dermed lovet noe annet enn skåringen leverte. Her ville
 * konsekvensen vært at overføringsflaten kjente igjen et navn kontovelgeren ikke kjente
 * igjen, uten at noe sa fra.
 *
 * Navnene kommer fra `persons`-tabellen med dens `aliases`, aldri fra en hardkodet liste:
 * en ny husholdning skal virke uten en kodeendring, og repoet skal ikke bære persondata.
 */

/**
 * Ord som er for generiske å matche på. «Ole» treffer «Olerud», og et fornavn på tre
 * bokstaver treffer halve kontoutskriften.
 */
export const MIN_NAME_TOKEN_LENGTH = 4;

export type NamedPerson = {
	name: string;
	fullName?: string | null;
	aliases?: string[] | null;
};

/** Små, unike navnetokens for én person — tomme og for korte ord er ute. */
export function nameTokensFor(person: NamedPerson): string[] {
	const raw = [
		person.name,
		...(person.fullName?.split(/\s+/) ?? []),
		...(person.aliases ?? [])
	];
	return [
		...new Set(
			raw
				.map((token) => token.trim().toLowerCase())
				.filter((token) => token.length >= MIN_NAME_TOKEN_LENGTH)
		)
	];
}

/** Navnetokens for flere personer, flatet og deduplisert. */
export function nameTokensForAll(people: readonly NamedPerson[]): string[] {
	return [...new Set(people.flatMap((person) => nameTokensFor(person)))];
}

/**
 * Bærer teksten navnet til en av personene?
 *
 * Enkel delstreng-match på tokens, som i overføringsflaten. Den er bevisst grov: et
 * kontonavn er kort og skrevet av banken, så en fuzzy match ville gitt flere falske treff
 * enn den løste.
 */
export function textMentionsPerson(text: string, tokens: readonly string[]): boolean {
	if (tokens.length === 0) return false;
	const haystack = text.toLowerCase();
	return tokens.some((token) => haystack.includes(token));
}
