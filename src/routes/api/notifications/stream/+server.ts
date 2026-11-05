import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { addConnection, removeConnection, type SSEWriter } from '#lib/server/notification/sse.js';
import { getUnreadCount } from '#lib/server/notification/in-app-service.js';

// ---------------------------------------------------------------------------
// SSE endpoint for real-time notification delivery
// ---------------------------------------------------------------------------
// Authenticated members connect via EventSource. On connect, sends the
// current unread count as an initial event. Subsequent notifications are
// pushed by the notification dispatcher via pushToUser().
// ---------------------------------------------------------------------------

export const GET: RequestHandler = async ({ locals, request }) => {
	const user = locals.user;
	if (!user) {
		error(401, 'Not authenticated');
	}

	const userId = user.id;
	const encoder = new TextEncoder();

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const writer: SSEWriter = {
				write(chunk: Uint8Array) {
					try {
						controller.enqueue(chunk);
						return Promise.resolve();
					} catch {
						cleanup();
						return Promise.reject(new Error('Stream closed'));
					}
				}
			};

			// Keep-alive interval
			const keepAlive = setInterval(() => {
				writer.write(encoder.encode(': keepalive\n\n')).catch(() => cleanup());
			}, 30_000);

			function cleanup() {
				clearInterval(keepAlive);
				removeConnection(userId, writer);
			}

			// Register connection
			addConnection(userId, writer);

			// Send initial unread count
			const unreadCount = await getUnreadCount(userId);
			writer
				.write(encoder.encode(`event: init\ndata: ${JSON.stringify({ unreadCount })}\n\n`))
				.catch(() => {});

			// Clean up when client disconnects
			request.signal.addEventListener('abort', () => {
				cleanup();
				try {
					controller.close();
				} catch {
					/* already closed */
				}
			});
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};
