/**
 * Streaming chat hook — manages progressive feedback + token streaming
 * 
 * Usage:
 * ```svelte
 * <script>
 *   import { streamingChat } from '$lib/client/streaming-chat';
 *   
 *   let isStreaming = false;
 *   let currentMessage = '';
 *   let progressStages: any[] = [];
 *   
 *   async function handleSendMessage(msg: string) {
 *     isStreaming = true;
 *     
 *     await streamingChat({
 *       message: msg,
 *       conversationId: null,
 *       onProgress: (stage, data) => {
 *         progressStages = [...progressStages, { stage, data }];
 *       },
 *       onToken: (token) => {
 *         currentMessage += token;
 *       },
 *       onComplete: (final) => {
 *         isStreaming = false;
 *       },
 *       onError: (error) => {
 *         isStreaming = false;
 *         console.error(error);
 *       }
 *     });
 *   }
 * </script>
 * ```
 */

interface StreamingChatOptions {
	message: string;
	conversationId?: string | null;
	onProgress?: (stage: string, data: Record<string, any>) => void;
	onBuildingPrompt?: () => void;
	onRerouting?: () => void;
	onLoadingContext?: () => void;
	onToken?: (token: string) => void;
	onComplete?: (result: Record<string, any>) => void;
	onError?: (error: string) => void;
}

/**
 * Execute streaming chat with progressive feedback + token-streaming
 */
export async function streamingChat({
	message,
	conversationId = null,
	onProgress,
	onBuildingPrompt,
	onRerouting,
	onLoadingContext,
	onToken,
	onComplete,
	onError
}: StreamingChatOptions): Promise<void> {
	try {
		const baseUrl = '/api/chat-stream';
		const params = new URLSearchParams({
			conversationId: conversationId || '',
			message,
			includeMessage: 'true'
		});

		const url = `${baseUrl}?${params.toString()}`;

		// Phase 1: Setup stream (progress events)
		const setupEventSource = new EventSource(url);
		let setupConversationId = conversationId;
		let routing: any = null;
		let systemPrompt = '';
		let messages: any[] = [];

		await new Promise<void>((resolve, reject) => {
			setupEventSource.addEventListener('progress', (event) => {
				try {
					const streamEvent = JSON.parse(event.data);
					onProgress?.(streamEvent.stage, streamEvent.data);

					if (streamEvent.stage === 'routing_complete') {
						routing = streamEvent.data;
						onRerouting?.();
					}

					if (streamEvent.stage === 'history_loaded') {
						onLoadingContext?.();
					}

					if (streamEvent.stage === 'building_prompt') {
						onBuildingPrompt?.();
					}

					if (streamEvent.stage === 'ready_for_completion') {
						setupConversationId = streamEvent.data.conversationId;
						systemPrompt = streamEvent.data.systemPrompt || '';
						messages = streamEvent.data.messages || [];
					}
				} catch (e) {
					console.error('Failed to parse progress event:', e);
				}
			});

			setupEventSource.addEventListener('complete', (event) => {
				setupEventSource.close();
				resolve();
			});

			setupEventSource.addEventListener('error', (error) => {
				setupEventSource.close();
				reject(new Error('Setup stream failed'));
			});
		});

		// Phase 2: Stream chat messages
		const response = await fetch('/api/chat-stream-messages', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				conversationId: setupConversationId,
				routing,
				systemPrompt,
				messages
			})
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.error || 'Failed to stream messages');
		}

		const reader = response.body!.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		let completeMessage = '';

		while (true) {
			const { done, value } = await reader.read();

			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');

			// Process all complete lines
			for (let i = 0; i < lines.length - 1; i++) {
				const line = lines[i].trim();

				if (line.startsWith('data: ')) {
					try {
						const event = JSON.parse(line.slice(6));

						if (event.type === 'token') {
							onToken?.(event.data.token);
							completeMessage += event.data.token;
						} else if (event.type === 'complete') {
							onComplete?.(event.data);
						} else if (event.type === 'error') {
							throw new Error(event.data.message);
						} else if (event.type === 'stream_start') {
							onProgress?.('streaming_start', event.data);
						}
					} catch (e) {
						console.error('Failed to parse stream event:', e);
					}
				}
			}

			// Keep incomplete line in buffer
			buffer = lines[lines.length - 1];
		}

		// Process remaining buffer
		if (buffer.trim().startsWith('data: ')) {
			try {
				const event = JSON.parse(buffer.trim().slice(6));
				if (event.type === 'complete') {
					onComplete?.(event.data);
				}
			} catch (e) {
				console.error('Failed to parse final event:', e);
			}
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		console.error('Streaming chat error:', errorMessage);
		onError?.(errorMessage);
		throw error;
	}
}

/**
 * Simpler hook for just token streaming (if you already have routing/setup)
 */
export async function streamChatMessages(
	conversationId: string,
	routing: any,
	systemPrompt: string,
	messages: any[],
	{
		onToken,
		onComplete,
		onError
	}: {
		onToken?: (token: string) => void;
		onComplete?: (result: any) => void;
		onError?: (error: string) => void;
	}
): Promise<void> {
	try {
		const response = await fetch('/api/chat-stream-messages', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ conversationId, routing, systemPrompt, messages })
		});

		if (!response.ok) {
			throw new Error('Failed to stream messages');
		}

		const reader = response.body!.getReader();
		const decoder = new TextDecoder();
		let buffer = '';

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');

			for (let i = 0; i < lines.length - 1; i++) {
				const line = lines[i].trim();
				if (line.startsWith('data: ')) {
					const event = JSON.parse(line.slice(6));
					if (event.type === 'token') {
						onToken?.(event.data.token);
					} else if (event.type === 'complete') {
						onComplete?.(event.data);
					} else if (event.type === 'error') {
						throw new Error(event.data.message);
					}
				}
			}

			buffer = lines[lines.length - 1];
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		onError?.(errorMessage);
		throw error;
	}
}
