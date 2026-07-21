/**
 * Direkte klient-opplasting av video til Cloudinary, utenom Vercel-funksjonen
 * (som har ~4,5 MB body-grense). Signaturen hentes fra `/api/cloudinary/sign`;
 * selve fila POSTes rett til Cloudinary. Returnerer publicId + varighet som
 * serveren så bruker til transkripsjon + keyframes.
 *
 * Store filer sendes chunket (Cloudinarys synkrone opplasting har en per-request-
 * grense; chunked upload er den robuste veien for f.eks. 160 MB-klipp).
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

/** Chunk-størrelse (20 MB). Cloudinary krever ≥ 5 MB per chunk (utenom siste). */
const CHUNK_SIZE = 20 * 1024 * 1024;

function randomUploadId(): string {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
	return `up-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function postChunk(
	url: string,
	form: FormData,
	opts: { headers?: Record<string, string>; onLoaded?: (loadedBytes: number) => void } = {}
): Promise<CloudinaryUploadResponse> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open('POST', url);
		xhr.responseType = 'json';
		for (const [k, v] of Object.entries(opts.headers ?? {})) xhr.setRequestHeader(k, v);
		if (opts.onLoaded) {
			xhr.upload.onprogress = (e) => {
				if (e.lengthComputable) opts.onLoaded!(e.loaded);
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

	const uploadUrl = `https://api.cloudinary.com/v1_1/${cloudName}/video/upload`;
	const buildForm = (blob: Blob) => {
		const form = new FormData();
		form.append('file', blob);
		form.append('api_key', apiKey);
		form.append('timestamp', String(timestamp));
		form.append('folder', folder);
		form.append('signature', signature);
		return form;
	};

	const total = file.size;
	let result: CloudinaryUploadResponse;

	if (total <= CHUNK_SIZE) {
		result = await postChunk(uploadUrl, buildForm(file), {
			onLoaded: onProgress ? (loaded) => onProgress(loaded / total) : undefined
		});
	} else {
		const uploadId = randomUploadId();
		let start = 0;
		let last: CloudinaryUploadResponse | null = null;
		while (start < total) {
			const end = Math.min(start + CHUNK_SIZE, total);
			const chunkStart = start;
			last = await postChunk(uploadUrl, buildForm(file.slice(start, end)), {
				headers: {
					'X-Unique-Upload-Id': uploadId,
					'Content-Range': `bytes ${start}-${end - 1}/${total}`
				},
				onLoaded: onProgress ? (loaded) => onProgress((chunkStart + loaded) / total) : undefined
			});
			start = end;
		}
		if (!last) throw new Error('Ingen chunks lastet opp');
		result = last;
	}

	onProgress?.(1);
	return {
		publicId: result.public_id,
		durationSec: typeof result.duration === 'number' ? result.duration : null,
		secureUrl: result.secure_url
	};
}
