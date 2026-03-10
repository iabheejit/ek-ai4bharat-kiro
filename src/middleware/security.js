const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { createLogger } = require('../utils/logger');

const logger = createLogger('security');

/**
 * Rate limiters
 */
const rateLimiters = {
    // General API rate limit
    general: rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100,
        message: { error: 'Too many requests, please try again later' },
        standardHeaders: true,
        legacyHeaders: false
    }),

    // Webhook rate limit (higher since WhatsApp sends many events)
    webhook: rateLimit({
        windowMs: 1 * 60 * 1000, // 1 minute
        max: 200,
        message: { error: 'Too many webhook requests' },
        standardHeaders: true,
        legacyHeaders: false
    }),

    // Admin endpoints
    admin: rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 20,
        message: { error: 'Too many admin requests' }
    })
};

/**
 * Twilio webhook signature verification
 */
function verifyTwilioSignature(authToken) {
    const twilio = require('twilio');
    return (req, res, next) => {
        // Skip verification in development
        if (process.env.NODE_ENV === 'development' || process.env.SKIP_WEBHOOK_VERIFY === 'true') {
            return next();
        }

        const signature = req.headers['x-twilio-signature'];
        const url = process.env.WEBHOOK_URL || `${req.protocol}://${req.get('host')}${req.originalUrl}`;

        if (!signature) {
            logger.warn('Missing Twilio signature', { ip: req.ip });
            return res.status(401).json({ error: 'Unauthorized', message: 'Missing signature' });
        }

        const valid = twilio.validateRequest(authToken, signature, url, req.body);
        if (!valid) {
            logger.warn('Invalid Twilio signature', { ip: req.ip });
            return res.status(401).json({ error: 'Unauthorized', message: 'Invalid signature' });
        }

        next();
    };
}

/**
 * Request logging middleware
 */
const requestLogger = (req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        const level = res.statusCode >= 400 ? 'warn' : 'info';
        logger[level](`${req.method} ${req.path}`, {
            statusCode: res.statusCode,
            duration: `${duration}ms`,
            ip: req.ip
        });
    });
    next();
};

/**
 * Security headers middleware
 */
const securityHeaders = (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.removeHeader('X-Powered-By');
    next();
};

module.exports = {
    rateLimiters,
    verifyTwilioSignature,
    requestLogger,
    securityHeaders
};
