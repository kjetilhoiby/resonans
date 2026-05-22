import type { EmailHandler } from './types';
import { workoutHandler } from './handlers/workout';
import { libraryHandler } from './handlers/library';
import { jobbHandler } from './handlers/jobb';

export interface LabelDescriptor {
	label: string;
	description: string;
	handler: EmailHandler;
}

export const EMAIL_LABELS: LabelDescriptor[] = [
	{
		label: workoutHandler.label,
		description: 'GPX/TCX-vedlegg fra treningsklokke. Importerer treningsøkten med rute, puls og høydeprofil.',
		handler: workoutHandler
	},
	{
		label: libraryHandler.label,
		description: 'Purring/lånefrist fra biblioteket. Lager et punkt i sjekklisten "Bibliotek-bøker" med innleveringsfrist.',
		handler: libraryHandler
	},
	{
		label: jobbHandler.label,
		description: 'Jobb-e-post. Lagres som sensor-event og kan brukes til oppgaveoppretting og kontekst i AI-chatten.',
		handler: jobbHandler
	}
];

const HANDLER_BY_LABEL: Record<string, EmailHandler> = Object.fromEntries(
	EMAIL_LABELS.map((entry) => [entry.label, entry.handler])
);

export function routeEmail(label: string): EmailHandler | null {
	return HANDLER_BY_LABEL[label] ?? null;
}

export function listLabels(): string[] {
	return EMAIL_LABELS.map((e) => e.label);
}
