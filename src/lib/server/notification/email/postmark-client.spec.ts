import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockEnv, sendEmailWithTemplateMock, sendEmailBatchMock, captureExceptionMock } = vi.hoisted(
	() => ({
		mockEnv: {} as Record<string, string | undefined>,
		sendEmailWithTemplateMock: vi.fn(),
		sendEmailBatchMock: vi.fn(),
		captureExceptionMock: vi.fn()
	})
);

vi.mock('postmark', () => ({
	ServerClient: class {
		sendEmailWithTemplate = sendEmailWithTemplateMock;
		sendEmailBatch = sendEmailBatchMock;
	}
}));

vi.mock('$app/env/private', async () =>
	(await import('#lib/testing/env-mock.js')).envMock(mockEnv)
);
vi.mock('#lib/server/sentry.js', () => ({ captureException: captureExceptionMock }));

import { sendEmailWithTemplate, sendInboxReply, sendBroadcastBatch } from './postmark-client';

beforeEach(() => {
	vi.clearAllMocks();
	for (const key of Object.keys(mockEnv)) delete mockEnv[key];
	mockEnv.POSTMARK_SERVER_TOKEN = 'test-token';
	mockEnv.POSTMARK_TRANSACTIONAL_STREAM = 'test-transactional';
	mockEnv.POSTMARK_BROADCAST_STREAM = 'test-broadcast';
	sendEmailWithTemplateMock.mockResolvedValue({ MessageID: 'msg-1' });
	sendEmailBatchMock.mockResolvedValue([]);
});

describe('message stream configuration', () => {
	it('sends template email on the configured transactional stream', async () => {
		await sendEmailWithTemplate({ to: 'a@example.com', templateAlias: 'notification', model: {} });

		expect(sendEmailWithTemplateMock).toHaveBeenCalledWith(
			expect.objectContaining({ MessageStream: 'test-transactional' })
		);
	});

	it('sends inbox replies on the configured transactional stream', async () => {
		await sendInboxReply({ to: 'a@example.com', model: {} });

		expect(sendEmailWithTemplateMock).toHaveBeenCalledWith(
			expect.objectContaining({ MessageStream: 'test-transactional' })
		);
	});

	it('sends broadcast batches on the configured broadcast stream', async () => {
		await sendBroadcastBatch([{ to: 'a@example.com', subject: 'Hi', htmlBody: '<p>Hi</p>' }]);

		const [batch] = sendEmailBatchMock.mock.calls[0];
		expect(batch[0]).toMatchObject({ MessageStream: 'test-broadcast' });
	});

	it('throws without sending when the transactional stream is unset', async () => {
		delete mockEnv.POSTMARK_TRANSACTIONAL_STREAM;

		await expect(
			sendEmailWithTemplate({ to: 'a@example.com', templateAlias: 'notification', model: {} })
		).rejects.toThrow('POSTMARK_TRANSACTIONAL_STREAM is not configured');
		expect(sendEmailWithTemplateMock).not.toHaveBeenCalled();
	});

	it('throws without sending when the broadcast stream is unset', async () => {
		delete mockEnv.POSTMARK_BROADCAST_STREAM;

		await expect(
			sendBroadcastBatch([{ to: 'a@example.com', subject: 'Hi', htmlBody: '<p>Hi</p>' }])
		).rejects.toThrow('POSTMARK_BROADCAST_STREAM is not configured');
		expect(sendEmailBatchMock).not.toHaveBeenCalled();
	});
});
