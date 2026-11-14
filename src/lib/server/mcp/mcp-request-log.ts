/**
 * Én logglinje per MCP-forespørsel, så «henter ChatGPT verktøylista i det hele
 * tatt?» kan besvares fra `/api/admin/logs?grep=[mcp]`.
 *
 * Fram til november 2026 logget serveren bare `tools/call`. Da `query_groceries`
 * ikke dukket opp i ChatGPT, kunne vi ikke se om klienten spurte etter lista.
 * Årsaken viste seg å være ChatGPT: verktøylista lastes bare på nytt med en egen
 * knapp i connectorens innstillinger, ikke ved å koble til på nytt.
 *
 * Bare METODER og klientens navn/versjon fra `initialize` logges — aldri
 * argumenter, som kan bære brukerdata.
 */

interface JsonRpcLike {
	method?: unknown;
	params?: unknown;
}

function clientInfoOf(message: JsonRpcLike): string | null {
	if (message.method !== 'initialize' || !message.params || typeof message.params !== 'object') return null;
	const params = message.params as { clientInfo?: { name?: unknown; version?: unknown }; protocolVersion?: unknown };
	const name = typeof params.clientInfo?.name === 'string' ? params.clientInfo.name.slice(0, 60) : '?';
	const version = typeof params.clientInfo?.version === 'string' ? params.clientInfo.version.slice(0, 30) : '?';
	const protocol = typeof params.protocolVersion === 'string' ? params.protocolVersion.slice(0, 20) : '?';
	return `${name}@${version} protokoll=${protocol}`;
}

/** Metodene i en JSON-RPC-kropp (enkeltmelding eller batch), og klientinfo fra `initialize`. */
export function describeMcpBody(body: unknown): { methods: string[]; client: string | null } {
	const messages = (Array.isArray(body) ? body : [body]).filter(
		(m): m is JsonRpcLike => !!m && typeof m === 'object'
	);
	const methods = messages
		.map((m) => (typeof m.method === 'string' ? m.method.slice(0, 60) : null))
		.filter((m): m is string => m !== null);
	const client = messages.map(clientInfoOf).find((c) => c !== null) ?? null;
	return { methods, client };
}
