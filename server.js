/**
 * server.js — Main Express server for Socrates-EK
 * 
 * Migrated from Airtable + WATI to MongoDB + Twilio WhatsApp.
 * All Airtable SDK/REST calls replaced with Mongoose queries.
 * WATI webhook format replaced with Twilio webhook adapter.
 * Production middleware from TBS-Mindset-v1 integrated.
 */

const path = require('path');
const dotenv = require('dotenv');
if (process.env.NODE_ENV !== 'production') dotenv.config({ path: path.join(__dirname, '.env') });

// Utils and middleware
const { createLogger } = require('./utils/logger');
const { InputValidator } = require('./utils/validation');
const { rateLimiters, requestLogger, securityHeaders, verifyTwilioSignature } = require('./middleware/security');
const { notFoundHandler, globalErrorHandler, gracefulShutdown, ErrorHandler } = require('./middleware/errorHandler');
const { systemMonitor, monitoringMiddleware } = require('./utils/monitoring');

const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { connectDB } = require('./db');
const { createCertificate } = require('./certificate');
const Student = require('./models/Student');
const CourseContent = require('./models/CourseContent');
const WA = require('./twilio_whatsapp');
const { solveUserQuery } = require('./llama');
const course_approval = require('./course_status');
const courseFlow = require('./flows/courseFlow');

const ConversationLog = require('./models/ConversationLog');

const logger = createLogger('server');

const webApp = express();

// ─── Middleware ───
webApp.use(securityHeaders);
webApp.use(cors());
webApp.use(express.json({ limit: '10mb' }));
webApp.use(express.urlencoded({ extended: true, limit: '10mb' }));
webApp.use(requestLogger);
webApp.use(monitoringMiddleware);

// ─── Rate limiting ───
webApp.use(rateLimiters.general);

// ─── Static files (admin dashboard) ───
webApp.use('/public', express.static(path.join(__dirname, 'public')));
webApp.get('/dashboard', (req, res) => res.redirect('/public/dashboard.html'));

// ─── All course delivery logic is now in flows/courseFlow.js ───

/**
 * Send daily reminders to students with pending content.
 * Uses the approved daily_reminder template (works outside 24hr window).
 */
const sendDailyReminders = async () => {
    try {
        const students = await Student.find({
            courseStatus: 'Content Created',
            progress: 'Pending'
        }).lean();

        for (const student of students) {
            const { phone, topic, name, nextDay } = student;
            await WA.sendTemplateMessage(nextDay, topic, 'daily_reminder', phone, name);
            await new Promise(r => setTimeout(r, 500));
        }
        logger.info('Daily reminders sent', { count: students.length });
    } catch (error) {
        logger.error('Failed sending reminders', error);
    }
};

// ─── Webhook adapter: normalize Twilio payload to internal format ───
function normalizeWebhookPayload(body) {
    if (body.waId) return body;

    const from = body.From || '';
    const phone = from.replace('whatsapp:+', '').replace(/\D/g, '');
    let text = body.Body || '';

    const result = {
        waId: phone,
        text: text,
        senderName: body.ProfileName || 'User',
        eventType: 'message',
        type: 'text'
    };

    // Button click from Content Template (quick-reply)
    if (body.ButtonText || body.ButtonPayload) {
        result.type = 'interactive';
        result.buttonReply = { text: body.ButtonText || text, id: body.ButtonPayload || '' };
        result.text = body.ButtonText || text;
        logger.info('Button click detected', { buttonText: body.ButtonText, buttonPayload: body.ButtonPayload });
    } else {
        // Text-matching fallback for typed commands
        const textLower = text.toLowerCase();
        const buttonPatterns = {
            'start day': 'Start Day', 'next module': 'Next', 'next': 'Next',
            'yes': 'Yes', 'no': 'No', 'restart': 'Restart', 'reset': 'Restart',
            "yes, let's do this!": "Yes, Let's do this!",
            'learn with ekatra': 'Learn with ekatra',
            'new topic': 'New Topic',
            'generate course': 'Generate Course'
        };
        const matched = buttonPatterns[textLower];
        if (matched) {
            result.type = 'interactive';
            result.buttonReply = { text: matched };
            result.text = matched;
        }
    }

    return result;
}

// ─── Admin API key middleware ───
const requireAdminKey = (req, res, next) => {
    const key = req.headers['x-admin-key'] || req.query.key;
    const adminKey = process.env.ADMIN_API_KEY;
    if (!adminKey || adminKey === '') return next();
    if (key !== adminKey) {
        logger.warn('Unauthorized admin access attempt', { ip: req.ip, path: req.path });
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};

// ─── Routes ───

webApp.get('/nextday', rateLimiters.admin, requireAdminKey, ErrorHandler.catchAsync(async (req, res) => {
    await sendDailyReminders();
    res.json({ status: 'ok', message: 'Reminders sent' });
}));

/**
 * Main WhatsApp webhook — thin dispatcher.
 * All conversation logic lives in flows/courseFlow.js
 */
webApp.post('/cop', rateLimiters.webhook, verifyTwilioSignature(process.env.TWILIO_AUTH_TOKEN), ErrorHandler.catchAsync(async (req, res) => {
    const event = normalizeWebhookPayload(req.body);
    logger.userAction('webhook received', event.waId, { text: event.text?.substring(0, 50) });

    // Delegate to flow engine (non-blocking — respond to Twilio immediately)
    courseFlow.handle(event).catch(err => {
        logger.error('Flow handler error', { error: err.message, phone: event.waId, stack: err.stack });
    });

    // Return empty TwiML immediately so Twilio doesn't timeout or send "OK"
    res.set('Content-Type', 'text/xml');
    res.send('<Response></Response>');
}));

webApp.get("/ping", rateLimiters.admin, requireAdminKey, ErrorHandler.catchAsync(async (req, res) => {
    logger.info("Ping received — triggering course approval");
    course_approval.course_approval();
    res.json({ status: 'ok', message: 'AI Engine triggered' });
}));

// Health check endpoint
webApp.get("/health", async (req, res) => {
    const health = await systemMonitor.healthCheck();
    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
});

// Metrics endpoint
webApp.get("/metrics", (req, res) => {
    res.json({
        system: systemMonitor.getSystemMetrics(),
        app: systemMonitor.getAppMetrics()
    });
});

// ═══════════════════════════════════════════════════════════
// ADMIN API — used by the dashboard
// ═══════════════════════════════════════════════════════════

// ─── Students CRUD ───
webApp.get('/api/students', ErrorHandler.catchAsync(async (req, res) => {
    const students = await Student.find().sort({ createdAt: -1 }).lean();
    res.json(students);
}));

webApp.post('/api/students', ErrorHandler.catchAsync(async (req, res) => {
    const { phone, name, topic } = req.body;
    if (!phone || !name || !topic) {
        return res.status(400).json({ error: 'phone, name, and topic are required' });
    }
    const cleaned = String(phone).replace(/\D/g, '');
    const existing = await Student.findOne({ phone: cleaned });
    if (existing) {
        return res.status(409).json({ error: 'Student with this phone already exists', student: existing });
    }
    const student = await Student.create({
        phone: cleaned, name, topic,
        courseStatus: 'Content Created',
        progress: 'Pending',
        flowStep: 'idle',
        nextDay: 1, nextModule: 1
    });
    logger.info('Student created via dashboard', { phone: cleaned, name, topic });
    res.status(201).json(student);
}));

webApp.delete('/api/students/:id', ErrorHandler.catchAsync(async (req, res) => {
    const student = await Student.findById(req.params.id);
    if (student) {
        await CourseContent.deleteMany({ studentPhone: student.phone });
        await ConversationLog.deleteMany({ studentPhone: student.phone });
        await Student.findByIdAndDelete(req.params.id);
    }
    res.json({ ok: true });
}));

// ─── Course Content CRUD ───
webApp.get('/api/courses/:phone', ErrorHandler.catchAsync(async (req, res) => {
    const content = await CourseContent.find({ studentPhone: req.params.phone }).sort({ day: 1 }).lean();
    res.json(content);
}));

webApp.post('/api/courses', ErrorHandler.catchAsync(async (req, res) => {
    const { studentPhone, topic, days } = req.body;
    if (!studentPhone || !topic || !days || !Array.isArray(days)) {
        return res.status(400).json({ error: 'studentPhone, topic, and days[] are required' });
    }

    // Delete existing content for this student+topic
    await CourseContent.deleteMany({ studentPhone, topic });

    const created = [];
    for (const dayData of days) {
        const doc = await CourseContent.create({
            studentPhone,
            topic,
            day: dayData.day,
            modules: dayData.modules.map(m => ({
                text: m.text || '',
                files: (m.files || []).map(f => ({ filename: f.filename || '', url: f.url || '' })),
                question: m.question || '',
                answer: m.answer || ''
            }))
        });
        created.push(doc);
    }
    logger.info('Course content created via dashboard', { studentPhone, topic, days: created.length });
    res.status(201).json(created);
}));

// ─── Send first template (trigger) ───
webApp.post('/api/send-welcome', ErrorHandler.catchAsync(async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone is required' });

    const student = await Student.findOne({ phone: String(phone).replace(/\D/g, '') });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    await WA.sendTemplateMessage(
        student.nextDay, student.topic, 'daily_reminder',
        student.phone, student.name
    );
    logger.info('Welcome template sent via dashboard', { phone: student.phone });
    res.json({ ok: true, message: `Template sent to ${student.name} (${student.phone})` });
}));

// ─── Conversation logs ───
webApp.get('/api/logs/:phone', ErrorHandler.catchAsync(async (req, res) => {
    const logs = await ConversationLog.find({ studentPhone: req.params.phone })
        .sort({ timestamp: 1 }).lean();
    res.json(logs);
}));

// Error handling
webApp.use(notFoundHandler);
webApp.use(globalErrorHandler);

// ─── Start server ───
const startServer = async () => {
    try {
        // Connect to MongoDB first
        await connectDB();
        logger.info('MongoDB connected');

        const port = process.env.PORT || process.env.port || 3000;
        const server = webApp.listen(port, () => {
            logger.info(`Server is up and running at ${port}`);
        });

        // ─── Cron: Daily reminders at 9:00 AM IST ───
        cron.schedule('0 9 * * *', async () => {
            logger.info('Cron: Sending daily reminders');
            try {
                await sendDailyReminders();
            } catch (err) {
                logger.error('Cron: Failed to send daily reminders', err);
            }
        }, { timezone: 'Asia/Kolkata' });
        logger.info('Cron scheduled: daily reminders at 9:00 AM IST');

        // Graceful shutdown handling
        gracefulShutdown(server);

    } catch (error) {
        logger.error('Failed to start server', error);
        process.exit(1);
    }
};

startServer();
