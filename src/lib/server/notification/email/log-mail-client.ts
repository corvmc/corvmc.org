import type { Models, ServerClient } from 'postmark';

type Accepted = Models.MessageSendingResponse;

function accepted(to: string | undefined): Accepted {
	return {
		To: to,
		SubmittedAt: new Date().toISOString(),
		MessageID: `log-${crypto.randomUUID()}`,
		ErrorCode: 0,
		Message: 'Logged, not sent (MAIL_DRIVER=log)'
	};
}

function log(msg: {
	To?: string;
	TemplateAlias?: string | null;
	TemplateModel?: object;
	Subject?: string;
}) {
	console.info('[mail:log]', {
		to: msg.To,
		template: msg.TemplateAlias ?? null,
		subject: msg.Subject ?? null,
		model: msg.TemplateModel ?? null
	});
}

/**
 * The mail driver for every environment but production: it logs the template,
 * model and recipient and answers as Postmark would, so a local walk exercises
 * the whole send path without a token and without reaching a real inbox.
 */
export function createLogMailClient(): Pick<
	ServerClient,
	'sendEmailWithTemplate' | 'sendEmailBatch' | 'sendEmailBatchWithTemplates'
> {
	return {
		async sendEmailWithTemplate(msg) {
			log(msg);
			return accepted(msg.To);
		},
		async sendEmailBatch(msgs) {
			msgs.forEach(log);
			return msgs.map((m) => accepted(m.To));
		},
		async sendEmailBatchWithTemplates(msgs) {
			msgs.forEach(log);
			return msgs.map((m) => accepted(m.To));
		}
	};
}
