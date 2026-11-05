import twilio from 'twilio';
import { env } from '$env/dynamic/private';

let client: ReturnType<typeof twilio> | null = null;

function getClient() {
	if (client) return client;

	const accountSid = env.TWILIO_ACCOUNT_SID;
	const authToken = env.TWILIO_AUTH_TOKEN;
	if (!accountSid || !authToken) {
		throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be configured');
	}

	client = twilio(accountSid, authToken);
	return client;
}

export function getTwilioPhoneNumber(): string {
	const number = env.TWILIO_PHONE_NUMBER;
	if (!number) throw new Error('TWILIO_PHONE_NUMBER is not configured');
	return number;
}

export async function sendSms(to: string, body: string): Promise<string> {
	const from = getTwilioPhoneNumber();

	try {
		const message = await getClient().messages.create({
			to,
			from,
			body
		});
		return message.sid;
	} catch (err) {
		console.error('[twilio] Failed to send SMS:', { to, error: err });
		throw err;
	}
}

export function validateTwilioSignature(
	url: string,
	params: Record<string, string>,
	signature: string
): boolean {
	// Nothing can verify against an unset token, which is a failed check, not a crash.
	const authToken = env.TWILIO_AUTH_TOKEN;
	if (!authToken) return false;
	return twilio.validateRequest(authToken, signature, url, params);
}
