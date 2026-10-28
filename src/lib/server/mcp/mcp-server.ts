/**
 * MCP-serveren: Resonans-verktøyene over Streamable HTTP, én bruker per token.
 *
 * Tilstandsløs med vilje — én `Server` og én transport per HTTP-forespørsel, og
 * JSON-svar framfor SSE. Ingen økt-id å holde rede på, ingenting i minnet som
 * forsvinner ved en rullende oppdatering, og to containere kan svare annenhver
 * gang. Ingen av verktøyene strømmer, så SSE ville bare vært innpakning.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { buildTimeContext } from '$lib/server/assistant/assistant';
import { runAssistantTool } from '$lib/server/assistant/tools';
import type { AccessTokenAuth } from '$lib/server/oauth/oauth-store';
import { MCP_TOOLS, toolAnnotations } from './mcp-tools';

const SERVER_INFO = { name: 'resonans', title: 'Resonans', version: '1.0.0' };

function instructions(now: Date): string {
	return [
		'Resonans er brukerens personlige coach og livslogg: helse (trening, vekt, søvn, ernæring),',
		'økonomi, familie, hjem, prosjekter, mål og ukeplan. Verktøyene leser og skriver brukerens',
		'egne data — samme tall som brukeren ser i Resonans-appen.',
		'',
		'- Hent tallene med verktøyene framfor å gjette. Siter dem som de står; ikke regn dem om.',
		'- Tidssonen er Europe/Oslo. ' + buildTimeContext(now),
		'- Verktøybeskrivelsene er på norsk og sier når hvert verktøy skal brukes. Les dem.',
		'- Før du sletter eller endrer noe, bekreft med brukeren hva som skal endres.'
	].join('\n');
}

export function toolList() {
	return MCP_TOOLS.map((tool) => {
		const fn = tool.definition.function;
		const schema = (fn.parameters ?? { type: 'object', properties: {} }) as Record<string, unknown>;
		return {
			name: fn.name,
			description: fn.description ?? fn.name,
			inputSchema: { ...schema, type: 'object' as const },
			annotations: toolAnnotations(fn.name)
		};
	});
}

const EXPOSED = new Set(MCP_TOOLS.map((tool) => tool.definition.function.name));

function buildServer(auth: AccessTokenAuth): Server {
	const server = new Server(SERVER_INFO, {
		capabilities: { tools: {} },
		instructions: instructions(new Date())
	});

	server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolList() }));

	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const { name } = request.params;
		if (!EXPOSED.has(name)) {
			return { content: [{ type: 'text', text: `Ukjent verktøy: ${name}` }], isError: true };
		}
		// `userId` kommer fra tokenet. Et `userId` i argumentene overstyres av
		// adaptSharedTool, som setter det ETTER modellens argumenter.
		const args = (request.params.arguments ?? {}) as Record<string, unknown>;

		const startedAt = Date.now();
		const result = await runAssistantTool(auth.userId, name, args);
		const isError = !!result && typeof result === 'object' && 'error' in result;
		console.info(
			`[mcp] ${name} klient=${auth.clientId} ${isError ? 'feil' : 'ok'} ${Date.now() - startedAt}ms`
		);
		return {
			content: [{ type: 'text', text: JSON.stringify(result ?? null) }],
			isError
		};
	});

	return server;
}

export async function handleMcpRequest(request: Request, auth: AccessTokenAuth): Promise<Response> {
	const server = buildServer(auth);
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true
	});
	await server.connect(transport);
	try {
		return await transport.handleRequest(request, {
			authInfo: {
				token: auth.grantId,
				clientId: auth.clientId,
				scopes: auth.scope.split(' '),
				expiresAt: Math.floor(auth.expiresAt.getTime() / 1000)
			}
		});
	} finally {
		// JSON-modus: svaret er ferdig bygget når handleRequest returnerer.
		await server.close();
	}
}
