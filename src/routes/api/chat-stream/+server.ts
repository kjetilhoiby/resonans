/**
 * Server-Sent Events (SSE) streaming endpoint for progressive task feedback
 * 
 * Usage from frontend:
 * ```typescript
 * const eventSource = new EventSource(
 *   `/api/chat-stream?conversationId=...&message=...`
 * );
 * eventSource.addEventListener('progress', (e) => {
 *   const { stage, data } = JSON.parse(e.data);
 *   console.log(`Stage: ${stage}`, data);
 * });
 * eventSource.addEventListener('complete', (e) => {
 *   const response = JSON.parse(e.data);
 *   eventSource.close();
 * });
 * eventSource.addEventListener('error', () => eventSource.close());
 * ```
 */

import type { RequestHandler } from './$types';
import { USER_ID_HEADER_NAME } from '$lib/server/request-user';
import { buildModularSystemPrompt } from '$lib/server/prompts';
import { routeChatRequest } from '$lib/server/chat-router';
import { getOrCreateConversation, addMessage, getConversationHistory } from '$lib/server/conversations';
import { findSimilarWidget } from '$lib/skills/widget-creation/service';
import type { WidgetDraft } from '$lib/artifacts/widget-draft';

interface StreamEvent {
	type: 'progress' | 'complete' | 'error';
	stage?: string;
	data: Record<string, any>;
	timestamp: number;
}

// Helper to send SSE message
function sendEvent(event: StreamEvent, encoder: TextEncoder): Uint8Array {
	const eventType = event.type === 'complete' ? 'complete' : event.type === 'error' ? 'error' : 'progress';
	let message = `event: ${eventType}\n`;
	message += `data: ${JSON.stringify(event)}\n\n`;
	return encoder.encode(message);
}

export const GET: RequestHandler = async ({ url, locals }) => {
	const userId = locals.userId || url.searchParams.get('userId');
	if (!userId) {
		return new Response('Unauthorized', { status: 401 });
	}

	const conversationId = url.searchParams.get('conversationId');
	const message = url.searchParams.get('message') || '';
	const includeMessage = url.searchParams.get('includeMessage') !== 'false';

	// Create streaming response with SSE
	const encoder = new TextEncoder();
	let isClosed = false;

	const stream = new ReadableStream({
		async start(controller) {
			try {
				// Stage 1: Initialize
				controller.enqueue(
					sendEvent(
						{
							type: 'progress',
							stage: 'initialize',
							data: { message: 'Starter samtale...', conversationId },
							timestamp: Date.now()
						},
						encoder
					)
				);

				// Get or create conversation
				const conversation = conversationId
					? { id: conversationId }
					: await getOrCreateConversation(userId);

				controller.enqueue(
					sendEvent(
						{
							type: 'progress',
							stage: 'conversation_ready',
							data: { conversationId: conversation.id },
							timestamp: Date.now()
						},
						encoder
					)
				);

				// Stage 2: Route request
				controller.enqueue(
					sendEvent(
						{
							type: 'progress',
							stage: 'routing',
							data: { message: 'Analyserer forespørsel...' },
							timestamp: Date.now()
						},
						encoder
					)
				);

				const routing = await routeChatRequest(message);

				controller.enqueue(
					sendEvent(
						{
							type: 'progress',
							stage: 'routing_complete',
							data: {
								domains: routing.domains,
								skills: routing.skills,
								focusModules: routing.focusModules
							},
							timestamp: Date.now()
						},
						encoder
					)
				);

				// Stage 3: Check for duplicate widgets (if widget skill)
				if (routing.skills.includes('widget_creation')) {
					controller.enqueue(
						sendEvent(
							{
								type: 'progress',
								stage: 'checking_duplicates',
								data: { message: 'Sjekker for eksisterende widgets...' },
								timestamp: Date.now()
							},
							encoder
						)
					);

					// In real implementation, you'd parse widget intent from message
					// This is pseudo-code showing the pattern
					const existingWidgets = await findSimilarWidget(
						userId,
						{
							metricType: 'amount',
							range: 'last30',
							filterCategory: null
						},
						{ pinnedOnly: false }
					);

					controller.enqueue(
						sendEvent(
							{
								type: 'progress',
								stage: 'duplicates_checked',
								data: {
									foundDuplicates: !!existingWidgets,
									count: existingWidgets ? 1 : 0
								},
								timestamp: Date.now()
							},
							encoder
						)
					);
				}

				// Stage 4: Build system prompt
				controller.enqueue(
					sendEvent(
						{
							type: 'progress',
							stage: 'building_prompt',
							data: { message: 'Forbereder modellinstruks...' },
							timestamp: Date.now()
						},
						encoder
					)
				);

				const systemPrompt = buildModularSystemPrompt(routing);

				controller.enqueue(
					sendEvent(
						{
							type: 'progress',
							stage: 'prompt_ready',
							data: {
								promptLength: systemPrompt.length,
								domainCount: routing.domains.length
							},
							timestamp: Date.now()
						},
						encoder
					)
				);

				// Stage 5: Get conversation history
				controller.enqueue(
					sendEvent(
						{
							type: 'progress',
							stage: 'loading_history',
							data: { message: 'Henter samtalehistorie...' },
							timestamp: Date.now()
						},
						encoder
					)
				);

				const messages = await getConversationHistory(conversation.id);

				controller.enqueue(
					sendEvent(
						{
							type: 'progress',
							stage: 'history_loaded',
							data: { messageCount: messages.length },
							timestamp: Date.now()
						},
						encoder
					)
				);

				// Stage 6: Save user message
				if (includeMessage) {
					controller.enqueue(
						sendEvent(
							{
								type: 'progress',
								stage: 'saving_message',
								data: { message: 'Lagrer melding...' },
								timestamp: Date.now()
							},
							encoder
						)
					);

					await addMessage({
						conversationId: conversation.id,
						role: 'user',
						content: message,
						metadata: null
					});

					controller.enqueue(
						sendEvent(
							{
								type: 'progress',
								stage: 'message_saved',
								data: { messageLength: message.length },
								timestamp: Date.now()
							},
							encoder
						)
					);

					// Reload history after saving user message
					const updatedMessages = await getConversationHistory(conversation.id);

					// Stage 7: Signal ready for chat completion
					controller.enqueue(
						sendEvent(
							{
								type: 'progress',
								stage: 'ready_for_completion',
								data: {
									conversationId: conversation.id,
									routing,
									systemPrompt,
									messages: updatedMessages.map((msg) => ({
										role: msg.role as 'user' | 'assistant' | 'system',
										content: msg.content
									})) as Array<{ role: string; content: string }>,
									instruction: 'Frontend can now call streaming chat endpoint with these params'
								},
								timestamp: Date.now()
							},
							encoder
						)
					);
				} else {
					// If not including message, still return current history
					const currentMessages = await getConversationHistory(conversation.id);

					controller.enqueue(
						sendEvent(
							{
								type: 'progress',
								stage: 'ready_for_completion',
								data: {
									conversationId: conversation.id,
									routing,
									systemPrompt,
									messages: currentMessages.map((msg) => ({
										role: msg.role as 'user' | 'assistant' | 'system',
										content: msg.content
									})) as Array<{ role: string; content: string }>,
									instruction: 'Frontend can now call streaming chat endpoint with these params'
								},
								timestamp: Date.now()
							},
							encoder
						)
					);
				}

				// Final: Send completion signal
				controller.enqueue(
					sendEvent(
						{
							type: 'complete',
							data: {
								status: 'ready',
								conversationId: conversation.id,
								nextEndpoint: '/api/chat-stream-messages'
							},
							timestamp: Date.now()
						},
						encoder
					)
				);

				controller.close();
			} catch (error) {
				console.error('Stream error:', error);
				controller.enqueue(
					sendEvent(
						{
							type: 'error',
							data: {
								message: error instanceof Error ? error.message : 'Unknown error',
								stage: 'stream_error'
							},
							timestamp: Date.now()
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
};
