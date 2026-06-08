import type { FlowContext } from '$lib/flows/types';
import type { GoalReminder } from './types';

interface WeekPlanApiResponse {
	currentWeekKey: string;
	currentWeekNo: number;
	prevWeekKey: string;
	prevWeekNo: number;
	note: string;
	reflection: string;
	uncheckedItems: Array<{ id: string; text: string }>;
	weekGoals: Array<{ title: string; currentValue: number; target: { value: number; unit: string }; trackingMetric: string }>;
	recurringTasks: string[];
}

export async function buildWeekPlanFlowContext(
	dashedKey: string,
	longTermGoals: GoalReminder[]
): Promise<FlowContext | null> {
	const res = await fetch(`/api/week-plan/context?week=${encodeURIComponent(dashedKey)}`);
	if (!res.ok) return null;

	const ctx: WeekPlanApiResponse = await res.json();

	const goalLines = ctx.weekGoals.map((g) => {
		const pct = g.target.value > 0 ? Math.round((g.currentValue / g.target.value) * 100) : null;
		const pctStr = pct !== null ? ` (${pct}%)` : '';
		return `- ${g.title}: ${g.currentValue} av ${g.target.value} ${g.target.unit}${pctStr}`;
	}).join('\n');

	const longTermLines = longTermGoals.map((g) => {
		const deadline = g.targetDate
			? ` (frist: ${new Date(g.targetDate).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' })})`
			: '';
		return `- "${g.title}"${deadline}`;
	}).join('\n');

	const refleksjonPrompt = [
		`Brukeren er klar for å planlegge uke ${ctx.currentWeekNo}.`,
		`\nForrige uke (uke ${ctx.prevWeekNo}):`,
		ctx.note ? `Ukesnotat: "${ctx.note}"` : '',
		ctx.reflection ? `Refleksjon: "${ctx.reflection}"` : '',
		goalLines ? `\nMål:\n${goalLines}` : '',
		'\nGi en kort, varm oppsummering av forrige uke (2-3 setninger). Avslutt med ett åpent spørsmål om hva som gikk bra og hva som var utfordrende.'
	].filter(Boolean).join('\n');

	const maalPrompt = [
		`Du hjelper brukeren å sette ukesmål for uke ${ctx.currentWeekNo}.`,
		goalLines ? `\nForrige ukes mål og fremgang (uke ${ctx.prevWeekNo}):\n${goalLines}` : '\nIngen mål fra forrige uke.',
		longTermLines ? `\nOverordnede mål å forankre i:\n${longTermLines}` : '',
		'\nSkille mellom mål og oppgaver:',
		'- UKESMÅL: kun for ting med målbar fremdrift mot et tall (f.eks. løping i km, antall treningsøkter, vekt i kg). Hold listen kort.',
		'- UKESOPPGAVER: konkrete ting du gjør 1–7 ganger denne uka (handle, planleggingsprat, sjekke noe, møte osv.).',
		'\nGå gjennom forrige ukes mål. Foreslå om hvert bør videreføres eller justeres. Kom gjerne med nye oppgaver basert på refleksjonen.',
		'\nAvslutt alltid med begge listene (utelat seksjoner som ikke passer):',
		'\nUKESMÅL:',
		'- [tittel]: [verdi] [enhet]',
		'\nUKESOPPGAVER:',
		'- [tittel]: [antall] [enhet]'
	].filter(Boolean).join('\n');

	const ukeshistoriePrompt = [
		`Du hjelper brukeren å skrive en kort ukesbeskrivelse for uke ${ctx.currentWeekNo}.`,
		`Spør: "Hva handler uke ${ctx.currentWeekNo} om for deg?"`,
		'Basert på svaret, skriv et kort utkast (1-2 setninger). Vær personlig og konkret.',
		'La brukeren justere utkastet via chat. Avslutt med det endelige notatet.'
	].join('\n');

	return {
		weekKey: ctx.currentWeekKey,
		openItems: ctx.uncheckedItems,
		weekTasks: ctx.recurringTasks,
		prevWeekData: {
			weekNo: ctx.prevWeekNo,
			note: ctx.note,
			reflection: ctx.reflection,
			uncheckedItems: ctx.uncheckedItems,
			weekGoals: ctx.weekGoals,
			recurringTasks: ctx.recurringTasks
		},
		systemPrompts: {
			refleksjon: refleksjonPrompt,
			maal: maalPrompt,
			ukeshistorie: ukeshistoriePrompt
		}
	};
}
