const Student = require('../models/Student');
const { createCertificate } = require('../certificate');
const { uploadPDFToS3, getPDFDownloadUrl } = require('./s3Upload');
const { uploadPDFToCloudinary } = require('./cloudinaryUpload');
const { createLogger } = require('./logger');

const logger = createLogger('certificate-store');

function sanitizeFilename(value) {
    return String(value || 'certificate')
        .trim()
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'certificate';
}

function hasReusableCertificate(student) {
    return Boolean(
        (student?.certificate?.objectKey || student?.certificate?.url) &&
        student.certificate.courseName === student.topic &&
        student.certificate.recipientName === student.name
    );
}

async function hydrateCertificateUrl(certificate) {
    if (!certificate) return null;
    if (certificate.provider === 's3' && certificate.objectKey) {
        return {
            ...certificate,
            url: await getPDFDownloadUrl(certificate.objectKey, 3600, certificate.bucket)
        };
    }
    return certificate;
}

async function getOrCreateCertificate(student, { forceRegenerate = false } = {}) {
    if (!forceRegenerate && hasReusableCertificate(student)) {
        return hydrateCertificateUrl(student.certificate);
    }

    const pdf = await createCertificate(student.name, student.topic);
    const filename = sanitizeFilename(`${student.name}_${student.topic}`);
    let certificate;

    try {
        const upload = await uploadPDFToS3(pdf, filename);
        certificate = {
            url: upload.url,
            objectKey: upload.key,
            bucket: upload.bucket,
            provider: upload.provider,
            courseName: student.topic,
            recipientName: student.name,
            generatedAt: new Date()
        };
    } catch (s3Error) {
        logger.warn('S3 certificate persistence failed, falling back to Cloudinary', { phone: student.phone, error: s3Error.message });
        const url = await uploadPDFToCloudinary(pdf, filename);
        certificate = {
            url,
            objectKey: '',
            bucket: '',
            provider: 'cloudinary',
            courseName: student.topic,
            recipientName: student.name,
            generatedAt: new Date()
        };
    }

    await Student.findByIdAndUpdate(student._id, { certificate });
    student.certificate = certificate;
    logger.info('Certificate persisted', { phone: student.phone, provider: certificate.provider, course: student.topic });
    return certificate;
}

module.exports = { getOrCreateCertificate };