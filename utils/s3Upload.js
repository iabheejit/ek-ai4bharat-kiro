const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { createLogger } = require('./logger');

const logger = createLogger('s3');

const region = process.env.AWS_REGION || 'us-east-1';
const bucketName = process.env.AWS_CERTIFICATES_BUCKET || process.env.AWS_S3_BUCKET;

const client = new S3Client({
    region,
    credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    } : undefined,
});

async function uploadPDFToS3(buffer, filename, folder = 'certificates', expiresIn = 3600) {
    if (!bucketName) {
        throw new Error('Missing AWS_CERTIFICATES_BUCKET or AWS_S3_BUCKET configuration');
    }

    const baseName = String(filename || 'certificate')
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'certificate';
    const key = `${folder}/${baseName}_${Date.now()}.pdf`;

    logger.info('Uploading PDF to S3', { bucket: bucketName, key, size: buffer.length });

    await client.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: buffer,
        ContentType: 'application/pdf',
        ContentDisposition: `attachment; filename="${baseName}.pdf"`,
    }));

    const signedUrl = await getSignedUrl(client, new GetObjectCommand({
        Bucket: bucketName,
        Key: key,
    }), { expiresIn });

    logger.info('Generated certificate download URL', { bucket: bucketName, key, expiresIn });
    return {
        url: signedUrl,
        key,
        bucket: bucketName,
        provider: 's3'
    };
}

async function getPDFDownloadUrl(key, expiresIn = 3600, bucket = bucketName) {
    if (!bucket) {
        throw new Error('Missing AWS_CERTIFICATES_BUCKET or AWS_S3_BUCKET configuration');
    }
    if (!key) {
        throw new Error('Missing S3 object key for certificate');
    }

    const signedUrl = await getSignedUrl(client, new GetObjectCommand({
        Bucket: bucket,
        Key: key,
    }), { expiresIn });

    logger.info('Generated certificate retrieval URL', { bucket, key, expiresIn });
    return signedUrl;
}

module.exports = { uploadPDFToS3, getPDFDownloadUrl };