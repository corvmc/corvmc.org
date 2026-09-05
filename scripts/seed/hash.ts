import { randomBytes, scrypt } from 'crypto';

// Mirror the app's password hashing (src/lib/server/auth.ts `scryptHash`). We can't
// import that module here — it pulls SvelteKit-only `$env`/`$app` aliases that don't
// resolve under tsx — so the format is reproduced inline. The app's verifier only
// accepts `scrypt:` / `$2` / `pbkdf2:` prefixes; better-auth's bare-hex hashPassword
// is rejected as `unknown_hash_format`, which is why seeded logins must use this.
export const SCRYPT_PARAMS = { N: 16384, r: 16, p: 1, keylen: 64, maxmem: 128 * 16384 * 16 * 2 };

/**
 * `Buffer.toString('hex')` is unavailable here: `@cloudflare/workers-types`
 * declares its own global `Buffer`, whose `toString` takes no arguments. Mirrors
 * `hexEncode` in `src/lib/server/auth.ts`, which this file already reproduces
 * the rest of.
 */
function hexEncode(buf: Uint8Array): string {
	return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function scryptHash(password: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const salt = randomBytes(16);
		const { N, r, p, keylen, maxmem } = SCRYPT_PARAMS;
		scrypt(password.normalize('NFKC'), salt, keylen, { N, r, p, maxmem }, (err, key) =>
			err ? reject(err) : resolve(`scrypt:${N}:${r}:${p}:${hexEncode(salt)}:${hexEncode(key)}`)
		);
	});
}
