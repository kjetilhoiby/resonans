/**
 * Avgjør om modellen skal tilbys verktøy på det FØRSTE chat-kallet.
 *
 * Samtalende kontekster (bok-/filmchat, reflekterende prat, høykapasitets-modeller)
 * kjører normalt verktøyfritt. Livskompass-coachingen er unntaket: den er samtalende,
 * men må kunne kalle `add_to_week_plan` for å føre tiltak på ukelista — derfor kan en
 * kontekst eksplisitt be om verktøy via `allowToolsInConversation`.
 *
 * Løftet ut av `_runChatRequest` så regelen er navngitt og testbar uten å dra inn
 * hele verktøy-/DB-grafen i endepunktet.
 */
export function shouldOfferToolsInitially(params: {
	isConversationalMode: boolean;
	allowToolsInConversation?: boolean;
}): boolean {
	return !params.isConversationalMode || Boolean(params.allowToolsInConversation);
}
