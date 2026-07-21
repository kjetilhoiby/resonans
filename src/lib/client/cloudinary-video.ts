/**
 * Direkte klient-opplasting av video til Cloudinary, utenom Vercel-funksjonen
 * (som har ~4,5 MB body-grense). Signaturen hentes fra `/api/cloudinary/sign`;
 * selve fila POSTes rett til Cloudinary. Returnerer publicId + varighet som
 * serveren så bruker til transkripsjon + keyframes.
 */

import { browser } from '$app/environment';

export interface CloudinaryVideoUpload {
	publicId: string;
	durationSec: number | null;
	secureUrl: string;
}

interface CloudinaryUploadResponse {
	public_id: string;
	secure_url: string;
	duration?: number;
}

function xhrUpload(
	url: string,
	form: FormData,
	onProgress?: (fraction: number) => void
): Promise<CloudinaryUploadResponse> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open('POST', url);
		xhr.responseType = 'json';
		if (onProgress) {
			xhr.upload.onprogress = (e) => {
				if (e.lengthComputable) onProgress(e.loaded / e.total);
			};
		}
		xhr.onload = () => {
			if (xhr.status >= 200 && xhr.status < 300) {
				resolve(xhr.response as CloudinaryUploadResponse);
			} else {
				reject(new Error(`Cloudinary-opplasting feilet: ${xhr.status}`));
			}
		};
		xhr.onerror = () => reject(new Error('Nettverksfeil under Cloudinary-opplasting'));
		xhr.send(form);
	});
}

export async function uploadVideoToCloudinary(
	file: File,
	onProgress?: (fraction: number) => void
): Promise<CloudinaryVideoUpload> {
	if (!browser) throw new Error('Krever nettleser');

	const signRes = await fetch('/api/cloudinary/sign', { method: 'POST' });
	if (!signRes.ok) throw new Error('Kunne ikke signere opplasting');
	const { signature, timestamp, apiKey, cloudName, folder } = (await signRes.json()) as {
		signature: string;
		timestamp: number;
		apiKey: string;
		cloudName: string;
		folder: string;
	};

	const form = new FormData();
	form.append('file', file);
	form.append('api_key', apiKey);
	form.append('timestamp', String(timestamp));
	form.append('folder', folder);
	form.append('signature', signature);

	const result = await xhrUpload(
		`https://api.cloudinary.com/v1_1/${cloudName}/video/upload`,
		form,
		onProgress
	);

	return {
		publicId: result.public_id,
		durationSec: typeof result.duration === 'number' ? result.duration : null,
		secureUrl: result.secure_url
	};
}
