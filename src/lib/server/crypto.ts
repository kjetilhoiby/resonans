import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '$env/dynamic/private';

/**
 * Symmetrisk kryptering av hemmeligheter som må lagres "at rest" (f.eks.
 * Strava access/refresh-tokens). Bruker AES-256-GCM med en nøkkel utledet
 * fra `TOKEN_ENCRYPTION_KEY` (fallback til `AUTH_SECRET`, som alltid er satt).
 *
 * Format på output: `v1:<iv-b64>:<authTag-b64>:<ciphertext-b64>`. Versjons-
 * prefikset gjør det mulig å rotere algoritme/nøkkel senere uten å miste
 * eksisterende rader.
 */

const PREFIX = 'v1';

function getKey(): Buffer {
	const secret = env.TOKEN_ENCRYPTION_KEY || env.AUTH_SECRET;
	if (!secret) {
		throw new Error('TOKEN_ENCRYPTION_KEY eller AUTH_SECRET må være satt for token-kryptering');
	}
	// sha256 gir en deterministisk 32-byte nøkkel (AES-256) fra en vilkårlig secret.
	return createHash('sha256').update(secret).digest();
}

export function encryptSecret(plain: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
	const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return `${PREFIX}:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(payload: string): string {
	const parts = payload.split(':');
	if (parts.length !== 4 || parts[0] !== PREFIX) {
		throw new Error('Ugyldig kryptert payload');
	}
	const iv = Buffer.from(parts[1], 'base64');
	const tag = Buffer.from(parts[2], 'base64');
	const data = Buffer.from(parts[3], 'base64');
	const decipher = createDecipheriv('aes-256-gcm', getKey(), iv);
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
