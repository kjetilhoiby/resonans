import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { v2 as cloudinary } from 'cloudinary';
import { env } from '$env/dynamic/private';

// @ts-ignore - Buffer is available in Node.js runtime
const BufferGlobal = Buffer;

// Configure Cloudinary
cloudinary.config({
	cloud_name: env.CLOUDINARY_CLOUD_NAME,
	api_key: env.CLOUDINARY_API_KEY,
	api_secret: env.CLOUDINARY_API_SECRET
});

export const POST: RequestHandler = async ({ request }) => {
	try {
		// Debug: Check if credentials are loaded
		if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
			console.error('Missing Cloudinary credentials:', {
				cloud_name: !!env.CLOUDINARY_CLOUD_NAME,
				api_key: !!env.CLOUDINARY_API_KEY,
				api_secret: !!env.CLOUDINARY_API_SECRET
			});
			return json({ error: 'Cloudinary not configured' }, { status: 500 });
		}

		const formData = await request.formData();
		const file = formData.get('image') as File;

		if (!file) {
			return json({ error: 'No image provided' }, { status: 400 });
		}

		console.log('Uploading file:', file.name, file.type, file.size, 'bytes');

		// Convert file to base64 for Cloudinary upload
		const arrayBuffer = await file.arrayBuffer();
		const buffer = BufferGlobal.from(arrayBuffer);
		const base64 = buffer.toString('base64');
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
		console.error('Error details:', error instanceof Error ? error.stack : error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Upload failed'
			},
			{ status: 500 }
		);
	}
};
