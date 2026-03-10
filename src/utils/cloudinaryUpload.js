const cloudinary = require('cloudinary').v2;
const { createLogger } = require('./logger');

const logger = createLogger('cloudinary');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function uploadPDFToCloudinary(buffer, filename, folder = 'ekatra-certificates') {
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
        throw new Error('Missing Cloudinary configuration');
    }

    const baseName = String(filename || 'certificate')
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'certificate';

    logger.info('Uploading PDF to Cloudinary', { filename: baseName, size: buffer.length });

    const result = await cloudinary.uploader.upload(`data:application/pdf;base64,${buffer.toString('base64')}`, {
        resource_type: 'raw',
        folder,
        public_id: baseName,
        overwrite: true,
        invalidate: true,
    });

    logger.info('PDF uploaded to Cloudinary', {
        public_id: result.public_id,
        resource_type: result.resource_type,
        url: result.secure_url,
    });

    return result.secure_url;
}

module.exports = { uploadPDFToCloudinary };