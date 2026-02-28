/**
 * Input validation utilities
 */

class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ValidationError';
        this.statusCode = 400;
        this.isOperational = true;
    }
}

class InputValidator {
    /**
     * Validate and sanitize phone number
     */
    static validatePhoneNumber(phone) {
        if (!phone) throw new ValidationError('Phone number is required');
        const cleaned = String(phone).replace(/\D/g, '');
        if (cleaned.length < 10 || cleaned.length > 15) {
            throw new ValidationError(`Invalid phone number length: ${cleaned.length}`);
        }
        return cleaned;
    }

    /**
     * Validate text input
     */
    static validateText(text, maxLength = 4096, fieldName = 'text') {
        if (!text || typeof text !== 'string') {
            throw new ValidationError(`${fieldName} is required and must be a string`);
        }
        const sanitized = text.trim();
        if (sanitized.length === 0) {
            throw new ValidationError(`${fieldName} cannot be empty`);
        }
        if (sanitized.length > maxLength) {
            throw new ValidationError(`${fieldName} exceeds max length of ${maxLength}`);
        }
        return sanitized;
    }

    /**
     * Validate Twilio webhook payload
     */
    static validateWebhookPayload(body) {
        if (!body || typeof body !== 'object') {
            throw new ValidationError('Invalid webhook payload');
        }
        // Twilio sends From as "whatsapp:+{number}"
        const from = body.From || '';
        const phone = from.replace('whatsapp:+', '').replace(/\D/g, '');
        
        return {
            waId: phone,
            text: body.Body || '',
            senderName: body.ProfileName || 'User',
            // Map Twilio button/list reply formats
            buttonReply: body.ButtonText ? { text: body.ButtonText } : null,
            listReply: body.ListReply ? JSON.parse(body.ListReply) : null,
            numMedia: parseInt(body.NumMedia || '0', 10),
            mediaUrl: body.MediaUrl0 || null,
            mediaType: body.MediaContentType0 || null
        };
    }

    /**
     * Validate required environment variables
     */
    static validateEnvironment() {
        const required = ['MONGODB_URI'];
        const optional = [
            'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_NUMBER',
            'AWS_REGION', 'AWS_BEDROCK_MODEL_ID'
        ];

        const missing = required.filter(v => !process.env[v]);
        if (missing.length > 0) {
            throw new ValidationError(`Missing required env vars: ${missing.join(', ')}`);
        }

        const missingOptional = optional.filter(v => !process.env[v]);
        if (missingOptional.length > 0) {
            console.warn(`Warning: Missing optional env vars: ${missingOptional.join(', ')}`);
        }
    }

    /**
     * Validate day number (1-30)
     */
    static validateDay(day) {
        const num = Number(day);
        if (isNaN(num) || num < 1 || num > 30) {
            throw new ValidationError(`Invalid day: ${day}. Must be 1-30`);
        }
        return num;
    }

    /**
     * Validate module number (1-5)
     */
    static validateModule(module) {
        const num = Number(module);
        if (isNaN(num) || num < 0 || num > 5) {
            throw new ValidationError(`Invalid module: ${module}. Must be 0-5`);
        }
        return num;
    }

    /**
     * Sanitize data for logging (redact sensitive fields)
     */
    static sanitizeForLogging(obj) {
        if (!obj || typeof obj !== 'object') return obj;
        const sanitized = { ...obj };
        const sensitiveKeys = ['password', 'token', 'api_key', 'secret', 'authorization', 'auth'];
        for (const key of Object.keys(sanitized)) {
            if (sensitiveKeys.some(s => key.toLowerCase().includes(s))) {
                sanitized[key] = '[REDACTED]';
            }
        }
        return sanitized;
    }
}

module.exports = { InputValidator, ValidationError };
