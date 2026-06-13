/**
 * Last opp et bilde til Cloudinary via /api/upload-image og få tilbake
 * sikker URL + publicId. Samme kontrakt som PersonEditSheet bruker inline.
 */
export async function uploadImage(file: File): Promise<{ url: string; publicId: string }> {
	const fd = new FormData();
	fd.append('image', file);
	const res = await fetch('/api/upload-image', { method: 'POST', body: fd });
	const body = (await res.json().catch(() => ({}))) as {
		success?: boolean;
		url?: string;
		publicId?: string;
		error?: string;
	};
	if (!res.ok || !body.success || !body.url) {
		throw new Error(body.error ?? 'Opplasting feilet');
	}
	return { url: body.url, publicId: body.publicId ?? '' };
}
