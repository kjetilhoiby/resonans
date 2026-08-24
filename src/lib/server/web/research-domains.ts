/**
 * research-domains — kuraterte kildesett og intent-deteksjon for websøk.
 *
 * Speiler mønsteret fra NORWEGIAN_CRITIC_DOMAINS / NORWEGIAN_FILM_CRITIC_DOMAINS,
 * men for det generelle web_search-verktøyet: gir «foretrukne» og «LLM-vennlige»
 * kilder ved å styre Tavily sine include_domains / exclude_domains, og velger
 * topic/tidsvindu ut fra hva spørsmålet handler om.
 *
 * Alt her er rene funksjoner (ingen I/O) — testet i research-domains.test.ts.
 */

/** Reise- og lokalinfo: offisielle reiselivssider + etablerte guider. */
export const TRAVEL_DOMAINS = [
	'visitnorway.no',
	'visitdenmark.no',
	'visitsweden.com',
	'lonelyplanet.com',
	'tripadvisor.com',
	'tripadvisor.no',
	'wikivoyage.org',
	'wikipedia.org',
	'atlasobscura.com',
	'timeout.com',
	'getyourguide.com'
];

/** Ferske hendelser / nyheter: norske og internasjonale nyhetskilder. */
export const NEWS_DOMAINS = [
	'nrk.no',
	'vg.no',
	'aftenposten.no',
	'dagbladet.no',
	'e24.no',
	'reuters.com',
	'apnews.com',
	'bbc.com'
];

/**
 * «LLM-fiendtlige» kilder som gir dårlig ekstraksjon eller lav signalverdi:
 * innholdsfarmer, Q&A-spam, pins og sosiale medier uten brødtekst. Ekskluderes
 * som standard fra generelle søk.
 */
export const LOW_QUALITY_DOMAINS = [
	'pinterest.com',
	'pinterest.no',
	'quora.com',
	'facebook.com',
	'instagram.com',
	'tiktok.com',
	'reddit.com',
	'answers.com',
	'ehow.com'
];

export type ResearchTopic = 'general' | 'travel' | 'news';

export interface ResearchScope {
	topic: ResearchTopic;
	/** Tavily topic-parameter (news → tidsvindu). */
	tavilyTopic: 'general' | 'news';
	days?: number;
	includeDomains?: string[];
	excludeDomains: string[];
}

export interface ThemeResearchDomains {
	include?: string[];
	exclude?: string[];
}

// Norske + engelske utløsere for reise/steds-research.
const TRAVEL_RE =
	/\b(hva kan (jeg|man|vi) (gjøre|se|oppleve)|ting å gjøre|severdigheter|attraksjoner|aktiviteter|utflukt|restaurant(er)?|spisesteder|hotell|overnatting|reisetips|reiseguide|things to do|what to do|sightseeing|itinerary)\b/i;

// Ferske/tidsavhengige utløsere.
//
// NB: RENE TIDSORD HØRER IKKE HIT. «i dag», «denne uka», «aktuelt» og «oppdatering»
// sto her fram til august 2026, og da var «hvor mye har jeg sovet denne uka?» et
// nyhetsspørsmål: søket ble låst til NEWS_DOMAINS (nrk.no, vg.no) og svaret hentet
// fra aviser i stedet for fra brukerens egne netter. Et tidsord sier NÅR, ikke at
// svaret finnes ute på nettet — brukerens egne data er også ferske.
//
// «konflikt» er ute av samme grunn: bar, uten geografi, gjorde den «vi har en
// konflikt hjemme» til et nyhetssøk. «krig» krever nå «i/mellom» etter seg.
//
// NB2: `\b` er ASCII i JS, så den virker IKKE etter «å»/«ø»/«æ» («været nå\b»
// matcher aldri). Grensene står derfor per alternativ, ikke som en felles hale.
const NEWS_RE =
	/\bnyhet(er)?\b|\bsiste nytt|\bhva skjer i\b|\bkrig(en)?\s+(i|mellom)\b|\bvalget\b|\bvalgkamp|\bbørs(en)?\b|\bstreik(en)?\b|\bværet (i dag|nå|i morgen)/i;

/** Rydder en domeneliste: trimmer, fjerner protokoll/www/sti, dropper tomme. Ren. */
export function normalizeDomains(input: string[] | undefined | null): string[] {
	if (!input) return [];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of input) {
		if (typeof raw !== 'string') continue;
		const cleaned = raw
			.trim()
			.toLowerCase()
			.replace(/^https?:\/\//, '')
			.replace(/^www\./, '')
			.replace(/\/.*$/, '');
		if (cleaned && !seen.has(cleaned)) {
			seen.add(cleaned);
			out.push(cleaned);
		}
	}
	return out;
}

/** Klassifiser hva et søk handler om. Ren funksjon. */
export function classifyResearchTopic(query: string): ResearchTopic {
	if (TRAVEL_RE.test(query)) return 'travel';
	if (NEWS_RE.test(query)) return 'news';
	return 'general';
}

/**
 * Bestem kilde-omfang for et søk: hvilke domener som prioriteres/ekskluderes,
 * og hvilket Tavily-topic/tidsvindu. Fletter inn temaets egne preferanser:
 *   - tema-include vinner: hvis satt, brukes kun de (pluss kuraterte for topic).
 *   - tema-exclude legges alltid på toppen av standard støyfilter.
 */
export function resolveResearchScope(
	query: string,
	themeDomains?: ThemeResearchDomains | null
): ResearchScope {
	const topic = classifyResearchTopic(query);
	const themeInclude = normalizeDomains(themeDomains?.include);
	const themeExclude = normalizeDomains(themeDomains?.exclude);

	let curatedInclude: string[] | undefined;
	let tavilyTopic: 'general' | 'news' = 'general';
	let days: number | undefined;

	if (topic === 'travel') {
		curatedInclude = TRAVEL_DOMAINS;
	} else if (topic === 'news') {
		curatedInclude = NEWS_DOMAINS;
		tavilyTopic = 'news';
		days = 14;
	}

	// Tema-include overstyrer kuraterte (brukeren vet best for sitt tema), men vi
	// beholder de kuraterte som utfyllende slik at et smalt tema-sett ikke kveler treff.
	const includeSet = new Set<string>([...themeInclude, ...(curatedInclude ?? [])]);
	const includeDomains = includeSet.size > 0 ? Array.from(includeSet) : undefined;

	// Ekskluder alltid støy + temaets egne (men aldri noe som eksplisitt er inkludert).
	const excludeSet = new Set<string>([...LOW_QUALITY_DOMAINS, ...themeExclude]);
	for (const inc of includeSet) excludeSet.delete(inc);

	return {
		topic,
		tavilyTopic,
		days,
		includeDomains,
		excludeDomains: Array.from(excludeSet)
	};
}

/**
 * Vinkle-varianter for dyp research. Kjører flere søk fra ulike innfallsvinkler
 * og fletter treffene. For reise gir det bredere dekning (severdigheter, mat,
 * praktisk); ellers suppleres med bakgrunn/detalj. Ren funksjon.
 */
export function expandResearchQueries(query: string, topic: ResearchTopic): string[] {
	const q = query.trim();
	if (!q) return [];
	if (topic === 'travel') {
		return [q, `${q} severdigheter og attraksjoner`, `${q} restauranter og spisesteder`];
	}
	if (topic === 'news') {
		return [q, `${q} siste utvikling`];
	}
	return [q, `${q} bakgrunn og detaljer`];
}
