const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Prevent MaxListenersExceeded warnings from multiple Winston loggers
// Each createLogger() call would add exception/rejection handlers; we share them instead
process.setMaxListeners(25);

// Create logs directory
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Shared exception/rejection handlers — registered once, shared across loggers
let sharedExceptionHandlersRegistered = false;

// Sensitive fields to redact in logs
const SENSITIVE_FIELDS = [
    'password', 'token', 'api_key', 'secret', 'authorization',
    'PERSONAL_ACCESS_TOKEN', 'API', 'TWILIO_AUTH_TOKEN',
    'AWS_SECRET_ACCESS_KEY', 'AWS_ACCESS_KEY_ID', 'MONGODB_URI'
];

function sanitizeData(data) {
    if (!data || typeof data !== 'object') return data;
    const sanitized = { ...data };
    for (const key of Object.keys(sanitized)) {
        const lowerKey = key.toLowerCase();
        if (SENSITIVE_FIELDS.some(f => lowerKey.includes(f.toLowerCase()))) {
            sanitized[key] = '[REDACTED]';
        } else if (lowerKey === 'phone' || lowerKey === 'waid') {
            const val = String(sanitized[key]);
            sanitized[key] = val.length > 4 ? '***' + val.slice(-4) : '****';
        } else if (typeof sanitized[key] === 'object') {
            sanitized[key] = sanitizeData(sanitized[key]);
        }
    }
    return sanitized;
}

function createLogger(moduleName) {
    const loggerOpts = {
        level: process.env.LOG_LEVEL || 'info',
        format: winston.format.combine(
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            winston.format.errors({ stack: true }),
            winston.format.json()
        ),
        defaultMeta: { module: moduleName },
        transports: [
            new winston.transports.Console({
                format: winston.format.combine(
                    winston.format.colorize(),
                    winston.format.printf(({ timestamp, level, message, module, ...rest }) => {
                        const meta = Object.keys(rest).length ? ` ${JSON.stringify(sanitizeData(rest))}` : '';
                        return `${timestamp} [${module}] ${level}: ${message}${meta}`;
                    })
                )
            }),
            new winston.transports.File({
                filename: path.join(logsDir, 'error.log'),
                level: 'error',
                maxsize: 10 * 1024 * 1024, // 10MB
                maxFiles: 5
            }),
            new winston.transports.File({
                filename: path.join(logsDir, 'app.log'),
                maxsize: 10 * 1024 * 1024,
                maxFiles: 5
            })
        ],
    };

    // Only the first logger registers exception/rejection handlers to avoid listener leaks
    if (!sharedExceptionHandlersRegistered) {
        loggerOpts.exceptionHandlers = [
            new winston.transports.File({ filename: path.join(logsDir, 'exceptions.log') })
        ];
        loggerOpts.rejectionHandlers = [
            new winston.transports.File({ filename: path.join(logsDir, 'rejections.log') })
        ];
        sharedExceptionHandlersRegistered = true;
    }

    const logger = winston.createLogger(loggerOpts);

    return {
        info: (message, meta = {}) => logger.info(message, sanitizeData(meta)),
        error: (message, error = null, meta = {}) => {
            const errorMeta = error ? { error: error.message, stack: error.stack, ...sanitizeData(meta) } : sanitizeData(meta);
            logger.error(message, errorMeta);
        },
        warn: (message, meta = {}) => logger.warn(message, sanitizeData(meta)),
        debug: (message, meta = {}) => logger.debug(message, sanitizeData(meta)),
        apiCall: (service, method, meta = {}) => logger.info(`API Call: ${service} ${method}`, sanitizeData(meta)),
        userAction: (action, phone, meta = {}) => logger.info(`User: ${action}`, { phone: phone ? '***' + String(phone).slice(-4) : 'unknown', ...sanitizeData(meta) }),
    };
}

module.exports = { createLogger };
