import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { v2 as cloudinary } from 'cloudinary';
import { env } from '$env/dynamic/private';

/**
 * Signerer en direkte klient-opplasting til Cloudinary. Store videoer lastes opp
 * rett til Cloudinary (utenom appserveren → ingen `BODY_SIZE_LIMIT` å treffe);
 * bare signaturen genereres her. api_secret forlater aldri serveren — api_key er
 * ikke hemmelig og sendes med til klienten.
 */
export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.userId) {
		return json({ error: 'Ikke autentisert' }, { status: 401 });
	}

	const cloudName = env.CLOUDINARY_CLOUD_NAME;
	const apiKey = env.CLOUDINARY_API_KEY;
	const apiSecret = env.CLOUDINARY_API_SECRET;
	if (!cloudName || !apiKey || !apiSecret) {
		return json({ error: 'Cloudinary not configured' }, { status: 500 });
	}

	const timestamp = Math.round(Date.now() / 1000);
	const folder = 'resonans';
	// Kun params som sendes til upload (utenom file/api_key/resource_type) signeres.
	const signature = cloudinary.utils.api_sign_request({ folder, timestamp }, apiSecret);

	return json({ signature, timestamp, apiKey, cloudName, folder });
};
