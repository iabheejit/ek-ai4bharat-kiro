const mongoose = require('mongoose');
const { createLogger } = require('./utils/logger');

const logger = createLogger('database');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/socrates';

let isConnected = false;

async function connectDB() {
    if (isConnected) {
        logger.info('Using existing MongoDB connection');
        return;
    }

    try {
        const conn = await mongoose.connect(MONGODB_URI);

        isConnected = true;
        logger.info('MongoDB connected', { host: conn.connection.host, db: conn.connection.name });

        mongoose.connection.on('error', (err) => {
            logger.error('MongoDB connection error', err);
            isConnected = false;
        });

        mongoose.connection.on('disconnected', () => {
            logger.warn('MongoDB disconnected');
            isConnected = false;
        });

        mongoose.connection.on('reconnected', () => {
            logger.info('MongoDB reconnected');
            isConnected = true;
        });

    } catch (error) {
        logger.error('MongoDB connection failed', error);
        // Retry after 5 seconds
        logger.info('Retrying MongoDB connection in 5 seconds...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        return connectDB();
    }
}

async function disconnectDB() {
    if (!isConnected) return;
    await mongoose.disconnect();
    isConnected = false;
    logger.info('MongoDB disconnected gracefully');
}

function getConnectionStatus() {
    return {
        isConnected,
        readyState: mongoose.connection.readyState,
        host: mongoose.connection.host,
        name: mongoose.connection.name
    };
}

module.exports = { connectDB, disconnectDB, getConnectionStatus };
