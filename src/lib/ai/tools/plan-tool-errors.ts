import { PlanError } from '$lib/server/planning/plan-service';

/**
 * Feil fra plan-, agenda-, rutine- og målverktøyene som et svar modellen kan
 * handle på: `code` skiller «finnes ikke» fra «feil argument», og meldingen
 * sier hva den skal gjøre i stedet. Uventede feil kastes videre, så
 * `runAssistantTool` logger dem.
 */
export function asToolError(error: unknown): { error: string; code: string } {
	if (error instanceof PlanError) return { error: error.message, code: error.code };
	throw error;
}
