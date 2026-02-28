const { createLogger } = require('../utils/logger');
const { ValidationError } = require('../utils/validation');

const logger = createLogger('error-handler');

/**
 * Custom error classes
 */
class AppError extends Error {
    constructor(message, statusCode = 500, isOperational = true) {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        Error.captureStackTrace(this, this.constructor);
    }
}

class DatabaseError extends AppError {
    constructor(message, originalError = null) {
        super(message, 502);
        this.originalError = originalError;
    }
}

class WhatsAppError extends AppError {
    constructor(message, originalError = null) {
        super(message, 502);
        this.originalError = originalError;
    }
}

class RateLimitError extends AppError {
    constructor(message = 'Rate limit exceeded') {
        super(message, 429);
    }
}

/**
 * Error handling utilities
 */
class ErrorHandler {

    static catchAsync(fn) {
        return (req, res, next) => {
            Promise.resolve(fn(req, res, next)).catch(next);
        };
    }

    static handleError(error, req = null) {
        if (error.isOperational) {
            logger.warn('Operational error occurred', {
                message: error.message,
                statusCode: error.statusCode,
                path: req?.path,
                method: req?.method,
                ip: req?.ip
            });
        } else {
            logger.error('Programming error occurred', error, {
                path: req?.path,
                method: req?.method,
                ip: req?.ip
            });
        }
    }

    /**
     * Retry mechanism for external API calls (Twilio, AWS Bedrock, etc.)
     */
    static async withRetry(operation, maxRetries = 3, delay = 1000, backoffFactor = 2) {
        let lastError;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const result = await operation();
                if (attempt > 1) {
                    logger.info('Operation succeeded on retry', { attempt, maxRetries });
                }
                return result;
            } catch (error) {
                lastError = error;
                logger.warn('Operation failed, will retry', {
                    attempt, maxRetries, error: error.message,
                    nextRetryIn: attempt < maxRetries ? delay : null
                });
                if (attempt === maxRetries) break;
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= backoffFactor;
            }
        }
        logger.error('Operation failed after all retries', lastError, { maxRetries });
        throw lastError;
    }

    /**
     * Circuit breaker for external services
     */
    static createCircuitBreaker(name, threshold = 5, timeout = 60000) {
        let failures = 0;
        let lastFailureTime = null;
        let state = 'CLOSED';

        return async (operation) => {
            if (state === 'OPEN') {
                if (Date.now() - lastFailureTime > timeout) {
                    state = 'HALF_OPEN';
                    logger.info('Circuit breaker moving to HALF_OPEN', { name });
                } else {
                    throw new AppError(`Circuit breaker is OPEN for ${name}`, 503);
                }
            }
            try {
                const result = await operation();
                if (state === 'HALF_OPEN') {
                    state = 'CLOSED';
                    failures = 0;
                    logger.info('Circuit breaker reset to CLOSED', { name });
                }
                return result;
            } catch (error) {
                failures++;
                lastFailureTime = Date.now();
                if (failures >= threshold) {
                    state = 'OPEN';
                    logger.error('Circuit breaker opened', error, { name, failures, threshold });
                }
                throw error;
            }
        };
    }
}

// Express middleware
const notFoundHandler = (req, res, next) => {
    const error = new AppError(`Route ${req.originalUrl} not found`, 404);
    next(error);
};

const globalErrorHandler = (error, req, res, next) => {
    let { statusCode = 500, message } = error;

    if (error instanceof ValidationError) { statusCode = 400; message = error.message; }
    else if (error.name === 'CastError') { statusCode = 400; message = 'Invalid data format'; }
    else if (error.code === 'ECONNREFUSED') { statusCode = 503; message = 'External service unavailable'; }
    else if (error.code === 'ENOTFOUND') { statusCode = 503; message = 'External service not found'; }
    else if (error.name === 'TimeoutError') { statusCode = 408; message = 'Request timeout'; }

    ErrorHandler.handleError(error, req);

    const errorResponse = {
        error: true,
        message,
        ...(process.env.NODE_ENV === 'development' && {
            stack: error.stack,
            originalError: error.originalError
        })
    };
    res.status(statusCode).json(errorResponse);
};

const gracefulShutdown = (server) => {
    const { disconnectDB } = require('../db');

    ['SIGTERM', 'SIGINT'].forEach(signal => {
        process.on(signal, async () => {
            logger.info(`Received ${signal}, starting graceful shutdown`);
            server.close(async () => {
                await disconnectDB();
                logger.info('Server closed successfully');
                process.exit(0);
            });
            setTimeout(() => {
                logger.error('Could not close server gracefully, forcing shutdown');
                process.exit(1);
            }, 10000);
        });
    });

    process.on('uncaughtException', (error) => {
        logger.error('Uncaught Exception', error);
        process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
        logger.error('Unhandled Rejection', new Error(String(reason)));
        process.exit(1);
    });
};

module.exports = {
    AppError,
    DatabaseError,
    WhatsAppError,
    RateLimitError,
    ErrorHandler,
    notFoundHandler,
    globalErrorHandler,
    gracefulShutdown
};
