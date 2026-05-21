import { db } from '$lib/db';
import { shareTokens } from '$lib/db/schema';
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';

export type ShareResourceType = 'checklist' | 'themeList' | 'tripPosition';
export type ShareAccessMode = 'read' | 'write';

export const SHARE_TOKEN_HEADER_NAME = 'x-resonans-share-token';

export interface ShareAuthContext {
	tokenId: string;
	ownerUserId: string;
	resourceType: ShareResourceType;
	resourceId: string;
	accessMode: ShareAccessMode;
	allowedEmail: string | null;
}

export interface ShareTokenListItem {
	id: string;
	token: string;
	resourceType: ShareResourceType;
	resourceId: string;
	accessMode: ShareAccessMode;
	allowedEmail: string | null;
	label: string | null;
	expiresAt: Date | null;
	revokedAt: Date | null;
	lastAccessedAt: Date | null;
	accessCount: number;
	createdAt: Date;
}

export class ShareTokensStorageNotReadyError extends Error {
	constructor(message = 'share_tokens storage is not ready') {
		super(message);
		this.name = 'ShareTokensStorageNotReadyError';
	}
}

function isMissingShareTokensTable(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const msg = error.message.toLowerCase();
	return (
		msg.includes('share_tokens') &&
		(msg.includes('does not exist') || msg.includes('relation') || msg.includes('42p01'))
	);
}

function mapStorageError(error: unknown): never {
	if (isMissingShareTokensTable(error)) {
		throw new ShareTokensStorageNotReadyError(
			'Tabellen share_tokens finnes ikke. Kjør npm run db:push eller db:migrate.'
		);
	}
	throw error;
}

function generateTokenValue(): string {
	return randomBytes(24).toString('base64url');
}

function rowToContext(row: typeof shareTokens.$inferSelect): ShareAuthContext {
	return {
		tokenId: row.id,
		ownerUserId: row.ownerUserId,
		resourceType: row.resourceType as ShareResourceType,
		resourceId: row.resourceId,
		accessMode: row.accessMode as ShareAccessMode,
		allowedEmail: row.allowedEmail
	};
}

function rowToListItem(row: typeof shareTokens.$inferSelect): ShareTokenListItem {
	return {
		id: row.id,
		token: row.token,
		resourceType: row.resourceType as ShareResourceType,
		resourceId: row.resourceId,
		accessMode: row.accessMode as ShareAccessMode,
		allowedEmail: row.allowedEmail,
		label: row.label,
		expiresAt: row.expiresAt,
		revokedAt: row.revokedAt,
		lastAccessedAt: row.lastAccessedAt,
		accessCount: row.accessCount,
		createdAt: row.createdAt
	};
}

export async function resolveShareToken(token: string | null | undefined): Promise<ShareAuthContext | null> {
	if (!token || token.length < 10) return null;

	const now = new Date();
	let found: typeof shareTokens.$inferSelect | undefined;
	try {
		found = await db.query.shareTokens.findFirst({
			where: and(
				eq(shareTokens.token, token),
				isNull(shareTokens.revokedAt),
				or(isNull(shareTokens.expiresAt), gt(shareTokens.expiresAt, now))
			)
		});
	} catch (error) {
		mapStorageError(error);
	}

	if (!found) return null;
	return rowToContext(found);
}

export async function recordShareAccess(tokenId: string): Promise<void> {
	try {
		await db
			.update(shareTokens)
			.set({
				lastAccessedAt: new Date(),
				accessCount: sql`${shareTokens.accessCount} + 1`
			})
			.where(eq(shareTokens.id, tokenId));
	} catch (error) {
		mapStorageError(error);
	}
}

export async function createShareToken(params: {
	ownerUserId: string;
	resourceType: ShareResourceType;
	resourceId: string;
	accessMode?: ShareAccessMode;
	allowedEmail?: string | null;
	label?: string | null;
	expiresAt?: Date | null;
}): Promise<ShareTokenListItem> {
	const tokenValue = generateTokenValue();
	let created: typeof shareTokens.$inferSelect;
	try {
		[created] = await db
			.insert(shareTokens)
			.values({
				ownerUserId: params.ownerUserId,
				resourceType: params.resourceType,
				resourceId: params.resourceId,
				token: tokenValue,
				accessMode: params.accessMode ?? 'read',
				allowedEmail: params.allowedEmail?.trim().toLowerCase() || null,
				label: params.label?.trim() || null,
				expiresAt: params.expiresAt ?? null
			})
			.returning();
	} catch (error) {
		mapStorageError(error);
	}
	return rowToListItem(created);
}

export async function listShareTokensForOwner(
	ownerUserId: string,
	options: { includeRevoked?: boolean } = {}
): Promise<ShareTokenListItem[]> {
	const whereClause = options.includeRevoked
		? eq(shareTokens.ownerUserId, ownerUserId)
		: and(eq(shareTokens.ownerUserId, ownerUserId), isNull(shareTokens.revokedAt));

	let rows: Array<typeof shareTokens.$inferSelect> = [];
	try {
		rows = await db.query.shareTokens.findMany({
			where: whereClause,
			orderBy: (t, { desc }) => [desc(t.createdAt)]
		});
	} catch (error) {
		mapStorageError(error);
	}
	return rows.map(rowToListItem);
}

export async function listShareTokensForResource(
	ownerUserId: string,
	resourceType: ShareResourceType,
	resourceId: string
): Promise<ShareTokenListItem[]> {
	let rows: Array<typeof shareTokens.$inferSelect> = [];
	try {
		rows = await db.query.shareTokens.findMany({
			where: and(
				eq(shareTokens.ownerUserId, ownerUserId),
				eq(shareTokens.resourceType, resourceType),
				eq(shareTokens.resourceId, resourceId),
				isNull(shareTokens.revokedAt)
			),
			orderBy: (t, { desc }) => [desc(t.createdAt)]
		});
	} catch (error) {
		mapStorageError(error);
	}
	return rows.map(rowToListItem);
}

export async function revokeShareToken(ownerUserId: string, tokenId: string): Promise<boolean> {
	let revoked: { id: string } | undefined;
	try {
		[revoked] = await db
			.update(shareTokens)
			.set({ revokedAt: new Date() })
			.where(
				and(
					eq(shareTokens.id, tokenId),
					eq(shareTokens.ownerUserId, ownerUserId),
					isNull(shareTokens.revokedAt)
				)
			)
			.returning({ id: shareTokens.id });
	} catch (error) {
		mapStorageError(error);
	}
	return Boolean(revoked?.id);
}

export function buildShareUrl(origin: string, token: string): string {
	return `${origin.replace(/\/$/, '')}/share/${token}`;
}

export function maskEmail(email: string): string {
	const [local, domain] = email.split('@');
	if (!local || !domain) return email;
	const head = local.slice(0, 1);
	const dot = domain.indexOf('.');
	const dhead = dot > 0 ? domain.slice(0, 1) : domain;
	const dtail = dot > 0 ? domain.slice(dot) : '';
	return `${head}•••@${dhead}••${dtail}`;
}
