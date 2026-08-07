/**
 * Systemprompt for kompislesing.
 *
 * Tre moduser, alle på forespørsel — ingenting skjer uoppfordret. Modusen er
 * eksplisitt UI-tilstand, ikke noe modellen utleder: glir den mellom leser og
 * redaktør, vet man ikke om «denne replikken bærer ikke» er en observasjon eller
 * en instruks, og tilbakemeldingen blir mush. Se
 * docs/changelog/2026-08-07-skriveprosjekt.md.
 *
 * Prompten bygges her, ikke i komponenten, av to grunner. Manuset er større enn
 * en bok-`contextPack` og må hentes selektivt, og modusene trenger ulik bredde:
 * sparring ser hele prosjektet, leser ser bare teksten som deles.
 *
 * FORBUDSLISTA er arvet ordrett fra bok-chatten (BookChatTab.svelte). Den er
 * forskjellen mellom kompislesing og smiger: en modell som alltid finner noe
 * klokt å si om diktet ditt er en smigermaskin.
 */

export const WRITING_CHAT_MODES = ['leser', 'redaktor', 'sparring'] as const;
export type WritingChatMode = (typeof WRITING_CHAT_MODES)[number];

export interface WritingChatModeDef {
	key: WritingChatMode;
	label: string;
	emoji: string;
	/** Kort forklaring i modusvelgeren — brukeren skal vite hva den ber om. */
	hint: string;
	/** Hvor bredt materiale modusen får se. */
	scope: 'tekst' | 'tekst-og-materiale' | 'prosjekt';
}

export const WRITING_CHAT_MODE_DEFS: WritingChatModeDef[] = [
	{
		key: 'leser',
		label: 'Leser',
		emoji: '👀',
		hint: 'Reagerer som en oppmerksom leser. Foreslår ingen omskrivinger.',
		scope: 'tekst'
	},
	{
		key: 'redaktor',
		label: 'Redaktør',
		emoji: '✍️',
		hint: 'Konkrete forbedringsforslag — hva som ikke bærer, og hvor du mister leseren.',
		scope: 'tekst-og-materiale'
	},
	{
		key: 'sparring',
		label: 'Sparring',
		emoji: '🧭',
		hint: 'Samtale om prosjektet som helhet: retning, motivasjon, hva som mangler.',
		scope: 'prosjekt'
	}
];

const MODE_BY_KEY = new Map<string, WritingChatModeDef>(
	WRITING_CHAT_MODE_DEFS.map((d) => [d.key, d])
);

export function isWritingChatMode(value: unknown): value is WritingChatMode {
	return typeof value === 'string' && MODE_BY_KEY.has(value);
}

export function resolveWritingChatMode(value: unknown): WritingChatModeDef {
	return (isWritingChatMode(value) && MODE_BY_KEY.get(value)) || MODE_BY_KEY.get('leser')!;
}

/**
 * Delt for alle tre modusene. Ordlyden er hentet fra bok-chatten fordi den er
 * utprøvd — «sterk historie» og «interessant» er de to formuleringene som gjør
 * tilbakemelding verdiløs.
 */
const SHARED_GUARD = `Unngå:
- generelle formuleringer («sterk historie», «interessant», «godt skrevet»)
- oppsummering av teksten uten nye perspektiver
- ros som ikke peker på noe konkret i teksten

Du skal kunne si at noe ikke fungerer. En leser som alltid finner noe klokt å si
er ubrukelig — brukeren trenger å vite hva som faktisk traff og hva som ikke gjorde det.`;

const MODE_INSTRUCTIONS: Record<WritingChatMode, string> = {
	leser: `Du er en oppmerksom og reflektert leser. Du reagerer på teksten — du redigerer den ikke.

Når du leser:
- si hva som traff deg, og hvor
- si hvor du ble usikker, mistet tråden eller måtte lese om igjen
- si hva du lurer på — hva teksten får deg til å ville vite
- vær konkret: referer til setninger, bilder og detaljer i teksten
- tør å formulere hva som er ubehagelig eller uklart

IKKE foreslå omskrivinger, alternative formuleringer eller strykninger. Brukeren
har bedt om en leser, ikke en redaktør. Om du mener noe bør endres, beskriv
virkningen på deg som leser og la brukeren avgjøre hva som skal gjøres.

Avslutt gjerne med ett åpent, konkret spørsmål som bygger på det du faktisk reagerte på.`,

	redaktor: `Du er en redaktør. Brukeren har bedt om konkrete forbedringsforslag.

Når du leser:
- pek på hva som ikke bærer, og si hvorfor
- foreslå konkrete strykninger — hvilke setninger eller avsnitt teksten klarer seg uten
- si hvor rytmen stopper, hvor en replikk faller flatt, hvor du mister leseren
- skill mellom det som er galt og det som bare er annerledes enn du ville gjort

Prioriter: si først det ene som ville gjort størst forskjell, deretter resten.
En liste med tolv småting er lettere å skrive enn å bruke.

Skriv aldri om teksten for brukeren med mindre de ber om det eksplisitt. Vis
gjerne et kort eksempel på en linje, men manuset er deres.`,

	sparring: `Du er en sparringpartner for prosjektet som helhet — ikke for teksten linje for linje.

Snakk om:
- hvor handlingen er på vei, og om den bærer
- karakterenes motivasjon, og om den henger sammen med det de gjør
- hva som mangler: hvilken scene finnes ikke ennå, hvilket spørsmål er ubesvart
- hvor prosjektet står fast, og hva som kunne løsne det

Bygg på materialet du har fått. Er det tynt, spør etter det du mangler framfor
å gjette. Ikke kommenter formuleringer — brukeren har andre moduser for det.`
};

export interface PromptDoc {
	kind: string;
	title: string;
	body: string;
}

export interface BuildPromptInput {
	project: { title: string; genre?: string | null; summary?: string | null };
	mode: WritingChatMode;
	/** Teksten samtalen handler om nå — utelates i sparring. */
	focusDoc?: PromptDoc | null;
	/** Karakterer og steder, brukt av redaktør og sparring. */
	material?: PromptDoc[];
	/** Titler på manusets ordnede deler, i rekkefølge — gir sparring formen. */
	outline?: Array<{ kind: string; title: string; words: number }>;
}

/** Kutter et dokument som er for langt til å bære en prompt alene. */
const MAX_FOCUS_CHARS = 12000;
const MAX_MATERIAL_CHARS = 1200;

function truncate(text: string, limit: number): string {
	const trimmed = text.trim();
	return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit)}\n[…kuttet]`;
}

export function buildWritingChatPrompt(input: BuildPromptInput): string {
	const def = resolveWritingChatMode(input.mode);
	const parts: string[] = [];

	const genre = input.project.genre?.trim();
	parts.push(
		`Du samtaler med forfatteren om skriveprosjektet «${input.project.title}»${genre ? ` (${genre})` : ''}.`
	);

	const summary = input.project.summary?.trim();
	if (summary) parts.push(`Premiss, forfatterens egne ord:\n${summary}`);

	parts.push(MODE_INSTRUCTIONS[def.key]);
	parts.push(SHARED_GUARD);

	// Bredden følger modusen — se scope i WRITING_CHAT_MODE_DEFS.
	if (def.scope !== 'prosjekt' && input.focusDoc) {
		const doc = input.focusDoc;
		parts.push(
			`Teksten samtalen handler om — ${doc.kind}${doc.title ? ` «${doc.title}»` : ''}:\n\n${truncate(doc.body, MAX_FOCUS_CHARS)}`
		);
	}

	if (def.scope === 'tekst-og-materiale' || def.scope === 'prosjekt') {
		const material = input.material ?? [];
		if (material.length > 0) {
			const rendered = material
				.map((m) => `- ${m.kind} «${m.title}»: ${truncate(m.body, MAX_MATERIAL_CHARS)}`)
				.join('\n');
			parts.push(`Materiale fra prosjektet:\n${rendered}`);
		}
	}

	if (def.scope === 'prosjekt') {
		const outline = input.outline ?? [];
		if (outline.length > 0) {
			const rendered = outline
				.map((o, i) => `${i + 1}. ${o.kind} «${o.title}» (${o.words} ord)`)
				.join('\n');
			parts.push(`Manusets deler i rekkefølge:\n${rendered}`);
		} else {
			// Ærlig om tomheten framfor å la modellen anta at manuset finnes.
			parts.push('Manuset har ingen scener eller kapitler ennå.');
		}
	}

	parts.push('Svar på norsk.');

	return parts.join('\n\n');
}
