import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { userApiSecrets } from '$lib/db/schema';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';

export const API_SECRET_HEADER_NAME = 'x-resonans-api-secret';

export interface ApiSecretAuthContext {
	userId: string;
	secretId: string;
}

export interface UserApiSecretListItem {
	id: string;
	label: string;
	secretPrefix: string;
	maskedSecret: string;
	lastUsedAt: Date | null;
	expiresAt: Date | null;
	createdAt: Date;
	revokedAt: Date | null;
}

export class ApiSecretsStorageNotReadyError extends Error {
	constructor(message = 'API secrets storage is not ready') {
		super(message);
		this.name = 'ApiSecretsStorageNotReadyError';
	}
}

function isMissingUserApiSecretsTable(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const msg = error.message.toLowerCase();
	return (
		msg.includes('user_api_secrets') &&
		(msg.includes('does not exist') || msg.includes('relation') || msg.includes('42p01'))
	);
}

function mapStorageError(error: unknown): never {
	if (isMissingUserApiSecretsTable(error)) {
		throw new ApiSecretsStorageNotReadyError('Table user_api_secrets does not exist yet. Run database migration.');
	}
	throw error;
}

function hashApiSecret(secret: string): string {
	const pepper = env.EXTERNAL_API_SECRET_PEPPER ?? '';
	return createHash('sha256').update(`${pepper}:${secret}`).digest('hex');
}

function generateApiSecretValue(): string {
	return `rsn_${randomBytes(32).toString('base64url')}`;
}

function parseAuthorizationHeader(value: string | null): string | null {
	if (!value) return null;
	const match = value.match(/^Bearer\s+(.+)$/i);
	if (!match) return null;
	const token = match[1]?.trim();
	return token ? token : null;
}

function extractApiSecret(request: Request): string | null {
	const fromBearer = parseAuthorizationHeader(request.headers.get('authorization'));
	if (fromBearer) return fromBearer;
	const fromHeader = request.headers.get(API_SECRET_HEADER_NAME)?.trim();
	return fromHeader || null;
}

function buildMaskedSecret(prefix: string): string {
	return `${prefix}...`;
}

export async function resolveApiSecretAuthFromRequest(request: Request): Promise<ApiSecretAuthContext | null> {
	const secret = extractApiSecret(request);
	if (!secret || secret.length < 20) {
		return null;
	}

	const now = new Date();
	const secretHash = hashApiSecret(secret);
	let found: { id: string; userId: string } | undefined;
	try {
		found = await db.query.userApiSecrets.findFirst({
			where: and(
				eq(userApiSecrets.secretHash, secretHash),
				isNull(userApiSecrets.revokedAt),
				or(isNull(userApiSecrets.expiresAt), gt(userApiSecrets.expiresAt, now))
			),
			columns: {
				id: true,
				userId: true
			}
		});
	} catch (error) {
		mapStorageError(error);
	}

	if (!found) {
		return null;
	}

	try {
		await db
			.update(userApiSecrets)
			.set({ lastUsedAt: now })
			.where(eq(userApiSecrets.id, found.id));
	} catch (error) {
		mapStorageError(error);
	}

	return {
		userId: found.userId,
		secretId: found.id
	};
}

export async function listUserApiSecrets(userId: string, includeRevoked = false): Promise<UserApiSecretListItem[]> {
	const whereClause = includeRevoked
		? eq(userApiSecrets.userId, userId)
		: and(eq(userApiSecrets.userId, userId), isNull(userApiSecrets.revokedAt));

	let rows: Array<typeof userApiSecrets.$inferSelect> = [];
	try {
		rows = await db.query.userApiSecrets.findMany({
			where: whereClause,
			orderBy: (table, { desc }) => [desc(table.createdAt)]
		});
	} catch (error) {
		mapStorageError(error);
	}

	return rows.map((row) => ({
		id: row.id,
		label: row.label,
		secretPrefix: row.secretPrefix,
		maskedSecret: buildMaskedSecret(row.secretPrefix),
		lastUsedAt: row.lastUsedAt,
		expiresAt: row.expiresAt,
		createdAt: row.createdAt,
		revokedAt: row.revokedAt
	}));
}

export async function createUserApiSecret(params: {
	userId: string;
	label?: string;
	expiresAt?: Date | null;
}): Promise<{ plainSecret: string; secret: UserApiSecretListItem }> {
	const plainSecret = generateApiSecretValue();
	const secretPrefix = plainSecret.slice(0, 14);
	const now = new Date();
	const label = params.label?.trim() || `Ekstern app ${now.toLocaleDateString('nb-NO')}`;

	let created: typeof userApiSecrets.$inferSelect;
	try {
		[created] = await db
			.insert(userApiSecrets)
			.values({
				userId: params.userId,
				label,
				secretPrefix,
				secretHash: hashApiSecret(plainSecret),
				expiresAt: params.expiresAt ?? null
			})
			.returning();
	} catch (error) {
		mapStorageError(error);
	}

	return {
		plainSecret,
		secret: {
			id: created.id,
			label: created.label,
			secretPrefix: created.secretPrefix,
			maskedSecret: buildMaskedSecret(created.secretPrefix),
			lastUsedAt: created.lastUsedAt,
			expiresAt: created.expiresAt,
			createdAt: created.createdAt,
			revokedAt: created.revokedAt
		}
	};
}

export async function revokeUserApiSecret(userId: string, secretId: string): Promise<boolean> {
	let revoked: { id: string } | undefined;
	try {
		[revoked] = await db
			.update(userApiSecrets)
			.set({ revokedAt: new Date() })
			.where(and(eq(userApiSecrets.id, secretId), eq(userApiSecrets.userId, userId), isNull(userApiSecrets.revokedAt)))
			.returning({ id: userApiSecrets.id });
	} catch (error) {
		mapStorageError(error);
	}

	return Boolean(revoked?.id);
}
