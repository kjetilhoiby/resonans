import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { v2 as cloudinary } from 'cloudinary';
import { env } from '$env/dynamic/private';

// Configure Cloudinary
cloudinary.config({
	cloud_name: env.CLOUDINARY_CLOUD_NAME,
	api_key: env.CLOUDINARY_API_KEY,
	api_secret: env.CLOUDINARY_API_SECRET
});

export const POST: RequestHandler = async ({ request }) => {
	try {
		const formData = await request.formData();
		const file = formData.get('image') as File;

		if (!file) {
			return json({ error: 'No image provided' }, { status: 400 });
		}

		// Convert file to base64 for Cloudinary upload
		const arrayBuffer = await file.arrayBuffer();
		const bytes = new Uint8Array(arrayBuffer);
		let binary = '';
		for (let i = 0; i < bytes.byteLength; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		const base64 = btoa(binary);
		const dataURI = `data:${file.type};base64,${base64}`;

		// Upload to Cloudinary
		const result = await cloudinary.uploader.upload(dataURI, {
			folder: 'resonans',
			resource_type: 'auto',
			// Optimize images automatically
			transformation: [
				{ width: 1024, height: 1024, crop: 'limit' },
				{ quality: 'auto:good' },
				{ fetch_format: 'auto' }
			]
		});

		return json({
			success: true,
			url: result.secure_url,
			publicId: result.public_id
		});
	} catch (error) {
		console.error('Image upload failed:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Upload failed'
			},
			{ status: 500 }
		);
	}
};
