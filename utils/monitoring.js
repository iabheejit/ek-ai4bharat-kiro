const os = require('os');
const { createLogger } = require('./logger');
const { getConnectionStatus } = require('../db');

const logger = createLogger('monitoring');

class SystemMonitor {
    constructor() {
        this.requestCount = 0;
        this.errorCount = 0;
        this.startTime = Date.now();
    }

    getSystemMetrics() {
        const memUsage = process.memoryUsage();
        return {
            uptime: process.uptime(),
            memory: {
                heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
                heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
                rss: Math.round(memUsage.rss / 1024 / 1024) + 'MB',
                heapPercent: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100) + '%'
            },
            cpu: os.loadavg(),
            platform: os.platform(),
            nodeVersion: process.version
        };
    }

    getAppMetrics() {
        return {
            requestCount: this.requestCount,
            errorCount: this.errorCount,
            errorRate: this.requestCount > 0
                ? (this.errorCount / this.requestCount * 100).toFixed(2) + '%'
                : '0%',
            uptimeHours: ((Date.now() - this.startTime) / 3600000).toFixed(2)
        };
    }

    async healthCheck() {
        const checks = {};

        // MongoDB check
        try {
            const dbStatus = getConnectionStatus();
            checks.database = {
                status: dbStatus.isConnected ? 'healthy' : 'unhealthy',
                readyState: dbStatus.readyState,
                host: dbStatus.host
            };
        } catch (error) {
            checks.database = { status: 'unhealthy', error: error.message };
        }

        // Memory check
        const memUsage = process.memoryUsage();
        const heapPercent = memUsage.heapUsed / memUsage.heapTotal;
        checks.memory = {
            status: heapPercent < 0.8 ? 'healthy' : 'warning',
            heapPercent: Math.round(heapPercent * 100) + '%'
        };

        // Environment check
        const requiredVars = ['MONGODB_URI'];
        const missingVars = requiredVars.filter(v => !process.env[v]);
        checks.environment = {
            status: missingVars.length === 0 ? 'healthy' : 'warning',
            missingVars: missingVars.length > 0 ? missingVars : undefined
        };

        const overallStatus = Object.values(checks).every(c => c.status !== 'unhealthy')
            ? 'healthy' : 'unhealthy';

        return { status: overallStatus, checks, timestamp: new Date().toISOString() };
    }

    trackRequest() {
        this.requestCount++;
    }

    trackError() {
        this.errorCount++;
    }
}

const systemMonitor = new SystemMonitor();

const monitoringMiddleware = (req, res, next) => {
    systemMonitor.trackRequest();
    res.on('finish', () => {
        if (res.statusCode >= 400) {
            systemMonitor.trackError();
        }
    });
    next();
};

module.exports = { systemMonitor, monitoringMiddleware };
