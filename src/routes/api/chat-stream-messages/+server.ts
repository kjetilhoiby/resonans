/**
 * Streaming chat messages endpoint — streams OpenAI responses token-by-token
 * 
 * Usage from frontend:
 * ```typescript
 * const response = await fetch('/api/chat-stream-messages', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({
 *     conversationId: 'xxx',
 *     routing: { domains: [...], skills: [...] },
 *     systemPrompt: 'xxx'
 *   })
 * });
 * 
 * const reader = response.body!.getReader();
 * const decoder = new TextDecoder();
 * 
 * while (true) {
 *   const { done, value } = await reader.read();
 *   if (done) break;
 *   
 *   const chunk = decoder.decode(value);
 *   const lines = chunk.split('\n');
 *   
 *   for (const line of lines) {
 *     if (line.startsWith('data: ')) {
 *       const event = JSON.parse(line.slice(6));
 *       if (event.type === 'token') {
 *         appendToMessageDisplay(event.token);
 *       } else if (event.type === 'complete') {
 *         finalizeChatMessage(event.data);
 *       }
 *     }
 *   }
 * }
 * ```
 */

import { openai } from '$lib/server/openai';
import type { RequestHandler } from './$types';
import { addMessage } from '$lib/server/conversations';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { _ChatRequestError, _runChatRequest } from '../chat/+server';

interface StreamRequest {
	conversationId: string;
	message?: string;
	mode?: 'direct' | 'proxy';
	imageUrl?: string;
	attachment?: unknown;
	preferredModel?: string;
	forceNewConversation?: boolean;
	routing: any;
	systemPrompt: string;
	messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
}

function sendStreamEvent(type: string, data: any, encoder: TextEncoder): Uint8Array {
	const message = `data: ${JSON.stringify({ type, data, timestamp: Date.now() })}\n\n`;
	return encoder.encode(message);
}

export const POST: RequestHandler = async ({ request, locals, fetch, url }) => {
	const userId = locals.userId;

	if (!userId) {
		return new Response('Unauthorized', { status: 401 });
	}

	try {
		const body = (await request.json()) as StreamRequest;
		const {
			conversationId,
			routing,
			systemPrompt,
			messages,
			mode = 'direct',
			message = '',
			imageUrl,
			attachment,
			preferredModel,
			forceNewConversation
		} = body;

		const encoder = new TextEncoder();
		let fullMessage = '';
		const assistantMetadata: Record<string, any> = {
			routing,
			streamedAt: new Date().toISOString()
		};

		const stream = new ReadableStream({
			async start(controller) {
				try {
					if (mode === 'proxy') {
						controller.enqueue(
							sendStreamEvent('stream_start', { message: 'Starter strømming...' }, encoder)
						);

						try {
							const payload = await _runChatRequest({
								body: {
									message,
									conversationId,
									imageUrl,
									attachment
								},
								userId,
								requestUrl: `${url.origin}/api/chat`,
								requestFetch: fetch,							preferredModel: preferredModel || undefined,								systemPromptPrefix: systemPrompt || undefined,
								onProgress: async (event) => {
									// Routing events must be forwarded with their real type so the client can handle them
									const routingEventTypes = ['book_routed', 'theme_routed', 'theme_suggested', 'routing_complete'];
									if (routingEventTypes.includes(event.stage)) {
										controller.enqueue(
											sendStreamEvent(event.stage, event.detail ?? { message: event.message }, encoder)
										);
									} else {
										controller.enqueue(
											sendStreamEvent('status', { stage: event.stage, message: event.message, detail: event.detail }, encoder)
										);
									}
								}
							});

							const responseText = String(payload.message ?? '');

							// If this was a book/theme routing redirect, close stream without streaming tokens
							if ((payload as any).bookRouted) {
								controller.enqueue(
									sendStreamEvent('complete', { ...payload, fullMessage: responseText }, encoder)
								);
								controller.close();
								return;
							}

							controller.enqueue(
								sendStreamEvent('status', { stage: 'rendering', message: 'Skriver svar...' }, encoder)
							);

							for (const ch of responseText) {
								fullMessage += ch;
								controller.enqueue(sendStreamEvent('token', { token: ch }, encoder));
								await new Promise((resolve) => setTimeout(resolve, 4));
							}

							controller.enqueue(
								sendStreamEvent('complete', { ...payload, fullMessage: responseText }, encoder)
							);
							controller.close();
							return;
						} catch (error) {
							const message = error instanceof _ChatRequestError ? error.message : error instanceof Error ? error.message : 'Unknown error';
							controller.enqueue(sendStreamEvent('error', { message, type: 'ChatRequestError' }, encoder));
							controller.close();
							return;
						}
					}

					// Signal streaming start
					controller.enqueue(
						sendStreamEvent('stream_start', { message: 'Starter chat streaming...' }, encoder)
					);

					// Convert messages to OpenAI format
					const openaiMessages: ChatCompletionMessageParam[] = [
						{ role: 'system', content: systemPrompt },
						...messages.map(msg => ({
							role: msg.role as 'user' | 'assistant' | 'system',
							content: msg.content
						}))
					];

					// Create OpenAI streaming request
					const completion = await openai.chat.completions.create({
						model: 'gpt-4o-mini',
						messages: openaiMessages,
						temperature: 0.7,
						stream: true,
						tools: [] // Tools would be passed here in real implementation
					});

					// Stream tokens as they arrive
					for await (const chunk of completion) {
						if (chunk.choices[0]?.delta?.content) {
							const token = chunk.choices[0].delta.content;
							fullMessage += token;

							// Send individual token
							controller.enqueue(
								sendStreamEvent('token', { token }, encoder)
							);
						}
					}

					// Save to database
					await addMessage({
						conversationId,
						role: 'assistant',
						content: fullMessage,
						metadata: assistantMetadata
					});

					// Send completion event with metadata
					controller.enqueue(
						sendStreamEvent(
							'complete',
							{
								fullMessage,
								messageLength: fullMessage.length,
								tokensStreamed: Math.ceil(fullMessage.length / 4), // Rough estimate
								metadata: assistantMetadata
							},
							encoder
						)
					);

					controller.close();
				} catch (error) {
					console.error('Stream error:', error);
					controller.enqueue(
						sendStreamEvent(
							'error',
							{
								message: error instanceof Error ? error.message : 'Unknown error',
								type: error instanceof Error ? error.name : 'Error'
							},
							encoder
						)
					);
					controller.close();
				}
			}
		});

		return new Response(stream, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				'Connection': 'keep-alive',
				'Access-Control-Allow-Origin': '*'
			}
		});
	} catch (error) {
		console.error('POST error:', error);
		return new Response(
			JSON.stringify({
				error: error instanceof Error ? error.message : 'Unknown error'
			}),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}
};
