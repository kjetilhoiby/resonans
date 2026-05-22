// Jobb Domain — Prosjekter, oppgaver, prioritering, fokustimer og karriereutvikling.

export type JobbProjectType = 'project' | 'initiative' | 'learning';

export const JOBB_PROJECT_TYPES: Record<JobbProjectType, { label: string; emoji: string }> = {
	project: { label: 'Prosjekt', emoji: '📋' },
	initiative: { label: 'Initiativ', emoji: '🚀' },
	learning: { label: 'Læring', emoji: '📚' }
};

export const JOBB_PROJECT_TYPE_TRIGGERS: Record<JobbProjectType, RegExp> = {
	project: /prosjekt|project|leveranse|sprint|feature/i,
	initiative: /initiativ|initiative|satsing|strategi/i,
	learning: /lær|kurs|course|sertifiser|workshop|kompetanse|skill/i
};

export const JOBB_DOMAIN_TRIGGER =
	/\bjobb(?:e[nrt]?)?\b|karriere|arbeid(?:s|et|e)?\b|prosjekt(?!plan\b)|oppgave|deadline|leveranse|sprint|standup|stand-up|kolleg|teamet?\b|presentasjon|rapport|kunde|klient|oppdrag|backlog/i;

export const JOBB_DOMAIN_PROMPT = `
**JOBB & KARRIERE:**
- Bruker fokuserer på jobb, prosjekter, oppgaver eller karriere
- Bruk query_home for å hente aktive jobb-prosjekter
- Bruk manage_project (domain='jobb', type='project'|'initiative'|'learning') for opprett/oppdater/avslutt
- Bruk create_task for konkrete oppgaver knyttet til prosjekter eller mål
- Hjelp med å bryte ned store oppgaver i konkrete steg og prioritere
- Foreslå widget for prosjekt-fremdrift og deadline-tracking
- Tone: praktisk, fokusert på resultater og fremgang
`;

export function isValidJobbProjectType(value: string): value is JobbProjectType {
	return value in JOBB_PROJECT_TYPES;
}

export function detectJobbProjectType(input: string): JobbProjectType | null {
	for (const [type, pattern] of Object.entries(JOBB_PROJECT_TYPE_TRIGGERS)) {
		if (pattern.test(input)) return type as JobbProjectType;
	}
	return null;
}

export const ALL_JOBB_PROJECT_TYPES = Object.keys(JOBB_PROJECT_TYPES) as JobbProjectType[];
