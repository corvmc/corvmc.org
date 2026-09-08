import { env } from '$env/dynamic/private';
import { randomInt, randomUUID } from 'crypto';
import { getJson, putJson } from '$lib/server/kv';
import { getConfigsByPrefix } from '$lib/server/site-config/site-config-service';
import { DEFAULT_TIMEZONE } from '$lib/config';
import { formatDateInTz, formatTimeInTz } from '$lib/server/reservation/timezone';

// ---------------------------------------------------------------------------
// Ultraloc API client
// ---------------------------------------------------------------------------
// Wraps the U-tec OpenAPI for managing temporary lock users.
// Uses OAuth2 client credentials flow with token caching.
//
// Credentials are read from site_config (admin UI), falling back to env vars.
// ---------------------------------------------------------------------------

const API_URL = 'https://api.u-tec.com/action';
const TOKEN_URL = 'https://oauth.u-tec.com/token';

const TOKEN_KEY = 'ultraloc:token';

async function getConfig() {
	const dbConfig = await getConfigsByPrefix('integration.utec');

	const clientId = (dbConfig.clientId as string) || env.ULTRALOC_CLIENT_ID;
	const clientSecret = (dbConfig.clientSecret as string) || env.ULTRALOC_CLIENT_SECRET;
	const deviceId = (dbConfig.deviceId as string) || env.ULTRALOC_DEVICE_ID;
	const refreshToken = (dbConfig.refreshToken as string) || env.ULTRALOC_REFRESH_TOKEN;

	if (!clientId || !clientSecret || !deviceId || !refreshToken) {
		throw new Error(
			'Ultraloc credentials not configured — set them in Staff Settings > Integrations or via environment variables'
		);
	}

	return { clientId, clientSecret, deviceId, refreshToken };
}

interface UtecTokenPayload {
	access_token?: string;
	refresh_token?: string;
	expires_in?: number;
}

/**
 * Unwrap U-tec's non-standard token envelope.
 *
 * The token endpoint wraps the OAuth fields under `data`:
 *   { "code": 200, "data": { "access_token": …, "expires_in": …, "refresh_token": … } }
 * rather than returning them at the top level. Accept both shapes (and pass an
 * already-flat response through unchanged).
 */
function unwrapTokenResponse(body: unknown): UtecTokenPayload {
	if (body && typeof body === 'object') {
		if ('access_token' in body) return body as UtecTokenPayload;
		const data = (body as { data?: unknown }).data;
		if (data && typeof data === 'object') return data as UtecTokenPayload;
	}
	return {};
}

async function getAccessToken(): Promise<string> {
	const cached = await getJson<{ accessToken: string; expiresAt: number }>(TOKEN_KEY);
	if (cached && Date.now() < cached.expiresAt - 60_000) {
		return cached.accessToken;
	}

	const { clientId, clientSecret, refreshToken } = await getConfig();

	const res = await fetch(
		`${TOKEN_URL}?grant_type=refresh_token&client_id=${clientId}&client_secret=${clientSecret}&refresh_token=${refreshToken}`
	);

	if (!res.ok) {
		throw new Error(`Ultraloc token refresh failed: ${res.status} ${await res.text()}`);
	}

	const data = unwrapTokenResponse(await res.json());
	if (!data.access_token || !data.expires_in) {
		throw new Error('Ultraloc token refresh returned no access_token');
	}
	const expiresAt = Date.now() + data.expires_in * 1000;
	const ttlSeconds = Math.max(Math.floor(data.expires_in - 60), 60);

	await putJson(TOKEN_KEY, { accessToken: data.access_token, expiresAt }, ttlSeconds);

	return data.access_token;
}

async function apiCall(
	namespace: string,
	name: string,
	payload: Record<string, unknown>
): Promise<unknown> {
	const token = await getAccessToken();

	const res = await fetch(API_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`
		},
		body: JSON.stringify({
			header: {
				namespace,
				name,
				messageId: randomUUID(),
				payloadVersion: '1'
			},
			payload
		})
	});

	if (!res.ok) {
		throw new Error(`Ultraloc API error: ${res.status} ${await res.text()}`);
	}

	const body: { payload: { error?: { code: string; message: string } } & Record<string, unknown> } =
		await res.json();

	if (body.payload?.error) {
		throw new Error(
			`Ultraloc API error: ${body.payload.error.code} — ${body.payload.error.message}`
		);
	}

	return body.payload;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
// Lock users are managed through the `st.lockUser` capability on the
// `Uhome.Device` / `Command` envelope. Reservations get a *temporary* user
// (type 2) carrying a 4-digit keypad passcode and a daterange window. The
// passcode IS the door code shown to the member.

/** How long after a reservation ends the door code keeps working. */
export const LOCK_GRACE_MINUTES = 30;

const USER_TYPE_TEMPORARY = 2;

export interface TempUserParams {
	name: string;
	startTime: Date;
	endTime: Date;
	/** 4–8 digit keypad passcode (the door code). */
	code: number;
}

export interface LockUser {
	id: number;
	name: string;
	type: number;
	daterange?: [string, string];
}

/** Generate a random 4-digit keypad PIN (U-tec passcodes are 4–8 digits). */
export function generateLockCode(): number {
	return randomInt(1000, 10000);
}

/** Format a Date as the lock's local "YYYY-MM-DD HH:mm" daterange string. */
export function lockDateTime(date: Date): string {
	return `${formatDateInTz(date, DEFAULT_TIMEZONE)} ${formatTimeInTz(date, DEFAULT_TIMEZONE)}`;
}

/** Run a single `st.lockUser` command against the configured lock. */
async function lockUserCommand(name: string, args?: Record<string, unknown>): Promise<unknown> {
	const { deviceId } = await getConfig();

	return apiCall('Uhome.Device', 'Command', {
		devices: [
			{
				id: deviceId,
				command: {
					capability: 'st.lockUser',
					name,
					...(args ? { arguments: args } : {})
				}
			}
		]
	});
}

/**
 * Create a temporary lock user for a reservation.
 *
 * The `add` command returns a deferred ack (no user id), so this resolves once
 * the command is accepted. The door code is the caller-supplied `code`.
 */
export async function createTemporaryUser(params: TempUserParams): Promise<void> {
	const graceEnd = new Date(params.endTime.getTime() + LOCK_GRACE_MINUTES * 60_000);

	// A temporary user (type 2) requires the full schedule quartet: U-tec rejects
	// the command with BAD-REQUEST if `weeks`/`timerange`/`limit` are omitted. The
	// `daterange` already pins the exact window, so we leave every weekday and the
	// whole day open and set no open-count limit.
	await lockUserCommand('add', {
		name: params.name,
		type: USER_TYPE_TEMPORARY,
		password: params.code,
		daterange: [lockDateTime(params.startTime), lockDateTime(graceEnd)],
		weeks: [0, 1, 2, 3, 4, 5, 6],
		timerange: ['00:00', '23:59'],
		limit: 0
	});
}

/**
 * Create a plain normal (type 0) lock user — the minimal `add` payload proven to
 * work (name + type + password, no schedule). Used by the self-test to isolate
 * whether the temporary-user schedule fields are what U-tec is rejecting. A
 * normal user has no lock-side expiry, so it stays until explicitly deleted.
 */
export async function createControlUser(name: string, code: number): Promise<void> {
	await lockUserCommand('add', { name, type: 0, password: code });
}

/** Remove a lock user by its lock-assigned id. */
export async function removeTemporaryUser(userId: number): Promise<void> {
	await lockUserCommand('delete', { id: userId });
}

/** List all users currently on the lock. */
export async function listLockUsers(): Promise<LockUser[]> {
	const result = (await lockUserCommand('list')) as
		{ devices?: Array<{ users?: LockUser[] }> } | undefined;
	return result?.devices?.[0]?.users ?? [];
}

// ---------------------------------------------------------------------------
// OAuth authorization-code flow — used by the in-app "Connect to U-tec" flow
// to mint and persist the refresh token (rather than pasting one in by hand).
// ---------------------------------------------------------------------------

const AUTHORIZE_URL = 'https://oauth.u-tec.com/authorize';
const OAUTH_SCOPE = 'openapi';

/** The configured client ID (DB config, falling back to env), or null if unset. */
export async function getUtecClientId(): Promise<string | null> {
	const dbConfig = await getConfigsByPrefix('integration.utec');
	return (dbConfig.clientId as string) || env.ULTRALOC_CLIENT_ID || null;
}

/** Build the U-tec authorization URL that begins the OAuth code flow. */
export function buildAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
	const params = new URLSearchParams({
		response_type: 'code',
		client_id: clientId,
		redirect_uri: redirectUri,
		scope: OAUTH_SCOPE,
		state
	});
	return `${AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Exchange an authorization code for tokens. Returns the refresh token to
 * persist (the access token is short-lived and re-minted on demand). Throws if
 * the client credentials are missing or U-tec returns no refresh token.
 */
export async function exchangeAuthorizationCode(
	code: string,
	redirectUri: string
): Promise<{ refreshToken: string; accessToken: string; expiresIn: number }> {
	const dbConfig = await getConfigsByPrefix('integration.utec');
	const clientId = (dbConfig.clientId as string) || env.ULTRALOC_CLIENT_ID;
	const clientSecret = (dbConfig.clientSecret as string) || env.ULTRALOC_CLIENT_SECRET;

	if (!clientId || !clientSecret) {
		throw new Error('Ultraloc client ID/secret not configured');
	}

	const params = new URLSearchParams({
		grant_type: 'authorization_code',
		client_id: clientId,
		client_secret: clientSecret,
		code,
		redirect_uri: redirectUri
	});

	const res = await fetch(`${TOKEN_URL}?${params.toString()}`);
	if (!res.ok) {
		throw new Error(`Ultraloc code exchange failed: ${res.status} ${await res.text()}`);
	}

	const data = unwrapTokenResponse(await res.json());
	if (!data.refresh_token) {
		throw new Error('Ultraloc code exchange returned no refresh_token');
	}

	return {
		refreshToken: data.refresh_token,
		accessToken: data.access_token ?? '',
		expiresIn: data.expires_in ?? 0
	};
}

// ---------------------------------------------------------------------------
// Connection test — used by the settings page
// ---------------------------------------------------------------------------

export async function testConnection(): Promise<{ ok: boolean; error?: string }> {
	try {
		const { clientId, clientSecret, refreshToken } = await getConfig();

		const res = await fetch(
			`${TOKEN_URL}?grant_type=refresh_token&client_id=${clientId}&client_secret=${clientSecret}&refresh_token=${refreshToken}`
		);

		if (!res.ok) {
			const text = await res.text();
			return { ok: false, error: `Token refresh failed (${res.status}): ${text}` };
		}

		const data = unwrapTokenResponse(await res.json());
		if (!data.access_token) {
			return { ok: false, error: 'No access token in response' };
		}

		return { ok: true };
	} catch (err) {
		return { ok: false, error: (err as Error).message };
	}
}
