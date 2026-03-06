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

// Prevent MaxListenersExceeded warnings (multiple Winston loggers + graceful shutdown)
process.setMaxListeners(25);

// Utils and middleware
const { createLogger } = require('./utils/logger');
const { InputValidator } = require('./utils/validation');
const { rateLimiters, requestLogger, securityHeaders, verifyTwilioSignature } = require('./middleware/security');
const { notFoundHandler, globalErrorHandler, gracefulShutdown, ErrorHandler } = require('./middleware/errorHandler');
const { systemMonitor, monitoringMiddleware } = require('./utils/monitoring');

const express = require('express');
const cors = require('cors');
const cron = require('node-cron');

// ─── Mandatory env checks ───
if (!process.env.ADMIN_API_KEY || process.env.ADMIN_API_KEY.trim() === '') {
    console.error('FATAL: ADMIN_API_KEY environment variable is required. Set it in .env or environment.');
    process.exit(1);
}

const { connectDB } = require('./db');
const { createCertificate } = require('./certificate');
const Student = require('./models/Student');
const CourseContent = require('./models/CourseContent');
const WA = require('./twilio_whatsapp');
const { solveUserQuery, generateForStudent } = require('./llama');
const course_approval = require('./course_status');
const courseFlow = require('./flows/courseFlow');

const ConversationLog = require('./models/ConversationLog');
const FlowTemplate = require('./models/FlowTemplate');

const logger = createLogger('server');

const webApp = express();

// ─── Middleware ───
webApp.use(securityHeaders);
webApp.use(cors({
    origin: (origin, cb) => {
        // Allow: no origin (same-origin / curl / Twilio), localhost, Cloudflare Pages, EC2 direct
        if (!origin) return cb(null, true);
        const allowed = [
            'http://localhost:3000', 'http://localhost:8080',
            'http://[EC2_IP]:3000',
            'http://ec2-[EC2_IP].compute-1.amazonaws.com:3000'
        ];
        if (allowed.includes(origin) || /\.pages\.dev$/.test(origin) || /\.workers\.dev$/.test(origin)) return cb(null, true);
        logger.warn('CORS blocked', { origin });
        cb(null, false);
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Admin-Key'],
    credentials: false
}));
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
        // 1. Unlock students waiting for next day (awaiting_next_day → awaiting_start)
        const lockedStudents = await Student.find({
            flowStep: 'awaiting_next_day',
            courseStatus: 'Content Created',
            progress: 'Pending'
        });
        for (const student of lockedStudents) {
            const { phone, topic, name, nextDay } = student;
            await Student.findByIdAndUpdate(student._id, { flowStep: 'awaiting_start', dayCompletedAt: null });
            logger.info('Day unlocked by cron', { phone, nextDay });
            await WA.sendText(`Good morning, ${name}! ☀️ Day ${nextDay} of *${topic}* is now unlocked!`, phone);
            await new Promise(r => setTimeout(r, 500));
            await WA.sendInteractiveButtonsMessage(`Day ${nextDay} is ready! 📚`, `Tap below to start today's lessons.`, 'Start Day', phone);
            await new Promise(r => setTimeout(r, 500));
        }
        logger.info('Day-locked students unlocked', { count: lockedStudents.length });

        // 2. Send reminders only to idle students (not newly unlocked ones)
        const students = await Student.find({
            courseStatus: 'Content Created',
            progress: 'Pending',
            flowStep: 'idle',
            lastInteractionAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) }
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
            'start day': 'Start Day', 'start lesson': 'Start Day',
            'next module': 'Next', 'next': 'Next',
            'yes': 'Yes', 'no': 'No', 'restart': 'Restart', 'reset': 'Restart',
            "yes, let's do this!": "Yes, Let's do this!",
            'learn with ekatra': 'Learn with ekatra',
            'new topic': 'New Topic',
            'generate course': 'Generate Course',
            'get certificate': 'Get Certificate',
            'remind later': 'Remind Later'
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
    if (key !== process.env.ADMIN_API_KEY) {
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

// Protect all /api/* routes with admin key
webApp.use('/api', requireAdminKey);

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

webApp.patch('/api/students/:id', ErrorHandler.catchAsync(async (req, res) => {
    const allowedFields = ['name', 'topic', 'flowStep', 'progress', 'courseStatus', 'nextDay', 'nextModule', 'style', 'language', 'goal'];
    const updates = {};
    for (const key of allowedFields) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
    }
    const student = await Student.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!student) return res.status(404).json({ error: 'Student not found' });
    logger.info('Student updated via dashboard', { phone: student.phone, updates: Object.keys(updates) });
    res.json(student);
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

// ─── AI Generation trigger from dashboard ───
webApp.post('/api/generate/:phone', ErrorHandler.catchAsync(async (req, res) => {
    const phone = String(req.params.phone).replace(/\D/g, '');
    const student = await Student.findOne({ phone });
    if (!student) return res.status(404).json({ error: 'Student not found' });
    if (!student.topic) return res.status(400).json({ error: 'No topic set for this student' });

    // Set student to Approved for generation
    await Student.findByIdAndUpdate(student._id, { courseStatus: 'Approved' });
    logger.info('AI generation triggered from dashboard', { phone, topic: student.topic });

    // Run generation (this takes 30-60s)
    const success = await generateForStudent(phone);
    if (success) {
        const updated = await Student.findOne({ phone }).lean();
        res.json({ ok: true, message: `Course generated for ${student.name} on "${student.topic}"`, student: updated });
    } else {
        res.status(500).json({ error: `Generation failed for "${student.topic}". Check server logs.` });
    }
}));

// ─── Conversation logs ───
webApp.get('/api/logs/:phone', ErrorHandler.catchAsync(async (req, res) => {
    const logs = await ConversationLog.find({ studentPhone: req.params.phone })
        .sort({ timestamp: 1 }).lean();
    res.json(logs);
}));

// ═══════════════════════════════════════════════════════════
// COURSE TEMPLATES API
// ═══════════════════════════════════════════════════════════

// List all template topics (distinct topics where isTemplate=true)
webApp.get('/api/course-templates', ErrorHandler.catchAsync(async (req, res) => {
    const topics = await CourseContent.distinct('topic', { isTemplate: true });
    // Return full template data grouped by topic
    const templates = [];
    for (const topic of topics) {
        const days = await CourseContent.find({ isTemplate: true, topic }).sort({ day: 1 }).lean();
        templates.push({ topic, days });
    }
    res.json(templates);
}));

// Get template content for a specific topic
webApp.get('/api/course-templates/:topic', ErrorHandler.catchAsync(async (req, res) => {
    const topic = decodeURIComponent(req.params.topic);
    const days = await CourseContent.find({ isTemplate: true, topic }).sort({ day: 1 }).lean();
    if (days.length === 0) return res.status(404).json({ error: 'Template not found' });
    res.json({ topic, days });
}));

// Create / update a course template
webApp.post('/api/course-templates', ErrorHandler.catchAsync(async (req, res) => {
    const { topic, days } = req.body;
    if (!topic || !days || !Array.isArray(days)) {
        return res.status(400).json({ error: 'topic and days[] are required' });
    }
    // Delete existing template for this topic
    await CourseContent.deleteMany({ isTemplate: true, topic });

    const created = [];
    for (const dayData of days) {
        const doc = await CourseContent.create({
            studentPhone: '__template__',
            topic,
            day: dayData.day,
            isTemplate: true,
            modules: dayData.modules.map(m => ({
                text: m.text || '',
                files: (m.files || []).map(f => ({ filename: f.filename || '', url: f.url || '' })),
                question: m.question || '',
                answer: m.answer || ''
            }))
        });
        created.push(doc);
    }
    logger.info('Course template created/updated', { topic, days: created.length });
    res.status(201).json(created);
}));

// Delete a course template
webApp.delete('/api/course-templates/:topic', ErrorHandler.catchAsync(async (req, res) => {
    const topic = decodeURIComponent(req.params.topic);
    const result = await CourseContent.deleteMany({ isTemplate: true, topic });
    logger.info('Course template deleted', { topic, deleted: result.deletedCount });
    res.json({ ok: true, deleted: result.deletedCount });
}));

// ═══════════════════════════════════════════════════════════
// FLOW TEMPLATES API
// ═══════════════════════════════════════════════════════════

// List all flow templates
webApp.get('/api/flow-templates', ErrorHandler.catchAsync(async (req, res) => {
    const templates = await FlowTemplate.find().sort({ category: 1, order: 1 }).lean();
    res.json(templates);
}));

// Update a flow template
webApp.patch('/api/flow-templates/:id', ErrorHandler.catchAsync(async (req, res) => {
    const allowedFields = ['displayName', 'messages', 'variables', 'isActive', 'order', 'category'];
    const updates = {};
    for (const key of allowedFields) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
    }
    const template = await FlowTemplate.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!template) return res.status(404).json({ error: 'Flow template not found' });
    logger.info('Flow template updated', { stepName: template.stepName, updates: Object.keys(updates) });
    res.json(template);
}));

// Create a flow template
webApp.post('/api/flow-templates', ErrorHandler.catchAsync(async (req, res) => {
    const { stepName, displayName, category, order, messages, variables } = req.body;
    if (!stepName || !displayName || !category) {
        return res.status(400).json({ error: 'stepName, displayName, and category are required' });
    }
    const existing = await FlowTemplate.findOne({ stepName });
    if (existing) {
        // Update existing
        Object.assign(existing, { displayName, category, order, messages, variables });
        await existing.save();
        res.json(existing);
    } else {
        const template = await FlowTemplate.create({ stepName, displayName, category, order, messages, variables });
        res.status(201).json(template);
    }
}));

// Seed default flow templates from hardcoded messages
webApp.post('/api/flow-templates/seed', ErrorHandler.catchAsync(async (req, res) => {
    const defaults = getDefaultFlowTemplates();
    let created = 0, updated = 0;
    for (const tmpl of defaults) {
        const existing = await FlowTemplate.findOne({ stepName: tmpl.stepName });
        if (existing) {
            // Don't overwrite user edits — only seed if force=true
            if (req.body.force) {
                Object.assign(existing, tmpl);
                await existing.save();
                updated++;
            }
        } else {
            await FlowTemplate.create(tmpl);
            created++;
        }
    }
    logger.info('Flow templates seeded', { created, updated, total: defaults.length });
    res.json({ ok: true, created, updated, total: defaults.length });
}));

/**
 * Default flow templates extracted from hardcoded courseFlow.js messages.
 * Variables use {{varName}} syntax for runtime substitution.
 */
function getDefaultFlowTemplates() {
    return [
        {
            stepName: 'new_user_welcome',
            displayName: 'New User Welcome',
            category: 'onboarding',
            order: 1,
            variables: ['name'],
            messages: [
                { text: '{{name}}, Welcome to *ekatra!* 🎓\n\nA brand new way of learning! Let\'s start your learning journey through micro-lessons, shared over WhatsApp! Each \'micro lesson\' will focus on specific key learning blocks and help you get the edge in today\'s fast-paced world.\n\nYou are part of an exclusive group that has this access!\n\nLet\'s get you started?', type: 'text', delay: 0 },
                { text: 'Tap below to begin your journey!', type: 'interactive', delay: 1500, header: 'Ready to learn? 🚀', buttons: ["Yes, Let's do this!"] }
            ]
        },
        {
            stepName: 'onboarding_welcome_response',
            displayName: 'Onboarding Welcome Response',
            category: 'onboarding',
            order: 2,
            variables: [],
            messages: [
                { text: 'That\'s amazing 🤩\n\nNow you can use WhatsApp to learn a new thing everyday!\n\n✳️ ekatra is the first unified learning platform, leveraging text, audio and video communication to reach over 1 billion learners in underserved communities worldwide 🌍', type: 'text', delay: 0 },
                { text: 'Start your learning journey with ekatra.', type: 'interactive', delay: 2000, header: "Let's get started! 👇", buttons: ['Learn with ekatra'] }
            ]
        },
        {
            stepName: 'onboarding_learn_response',
            displayName: 'Onboarding Learn Response',
            category: 'onboarding',
            order: 3,
            variables: [],
            messages: [
                { text: '⭐ Welcome, let\'s experience the power of micro-learning!\n\nYou can choose to learn a topic through carefully curated content, spread over a few days.\n\n_Once you select a topic, you will need to complete it before you can start the next one!_', type: 'text', delay: 0 }
            ]
        },
        {
            stepName: 'topic_enrolled',
            displayName: 'Topic Enrolled Success',
            category: 'onboarding',
            order: 4,
            variables: ['topic'],
            messages: [
                { text: '🎉 Congratulations on enrolling in *{{topic}}*!\n\nYour course is ready — 3 days, 3 modules per day.', type: 'text', delay: 0 },
                { text: 'Tap below to start your first lesson.', type: 'interactive', delay: 1500, header: 'Day 1 is ready! 📚', buttons: ['Start Day'] }
            ]
        },
        {
            stepName: 'topic_not_available',
            displayName: 'Topic Not Available (Alfred Redirect)',
            category: 'onboarding',
            order: 5,
            variables: ['topic'],
            messages: [
                { text: 'I don\'t have pre-built content for *{{topic}}* yet, but Alfred can generate it! 🤖', type: 'text', delay: 0 },
                { text: 'Could you let Alfred know what do you want to achieve by learning *{{topic}}*?\n\nSome examples:\n1.⁠ ⁠Gain a basic understanding of foundational concepts\n2.⁠ ⁠Prepare for a Technical Job Interview\n3.⁠ ⁠Learn a new skill\n\nWhat do you want to gain?', type: 'text', delay: 1000 }
            ]
        },
        {
            stepName: 'alfred_intro_message',
            displayName: 'Alfred Introduction',
            category: 'alfred',
            order: 10,
            variables: [],
            messages: [
                { text: 'ekatra is excited to introduce *Alfred*, a MetaAI powered learning assistant that helps you create courses on any topic of your choice. 🤖', type: 'text', delay: 0 },
                { text: 'Isn\'t that impressive? Want to know how you can start learning with Alfred\'s help?', type: 'text', delay: 1500 },
                { text: 'Tap below to get started!', type: 'interactive', delay: 1000, header: 'Meet Alfred 🤖', buttons: ['Yes, Tell me!'] }
            ]
        },
        {
            stepName: 'alfred_topic_prompt',
            displayName: 'Alfred Topic Prompt',
            category: 'alfred',
            order: 11,
            variables: [],
            messages: [
                { text: 'That\'s exciting! 🎉', type: 'text', delay: 0 },
                { text: 'Let Alfred know the topic you want to learn, keep it very concise and specific.\n\neg.\n1.⁠ ⁠Project Management for Engineers\n2.⁠ ⁠Roman Art History\n3.⁠ ⁠Indian Classical Music\n4.⁠ ⁠How to Teach AI\n\nWhat\'s on your mind?', type: 'text', delay: 1500 }
            ]
        },
        {
            stepName: 'alfred_goal_prompt',
            displayName: 'Alfred Goal Prompt',
            category: 'alfred',
            order: 12,
            variables: [],
            messages: [
                { text: 'That\'s an interesting topic to learn! 🧠\n\nCould you let Alfred know what do you want to achieve by learning this topic? Think for the next 30 seconds and then answer this.\n\nSome examples could be:\n1.⁠ ⁠Gain a basic understanding of foundational concepts\n2.⁠ ⁠Design a Teaching curriculum for Graduate Students\n3.⁠ ⁠Prepare for a Technical Job Interview\n4.⁠ ⁠Learn a new skill\n\nWhat do you want to gain out of this experience?', type: 'text', delay: 0 }
            ]
        },
        {
            stepName: 'alfred_style_prompt',
            displayName: 'Alfred Style Prompt',
            category: 'alfred',
            order: 13,
            variables: [],
            messages: [
                { text: 'How would you like to learn this topic?\n\n1.⁠ ⁠*Professional*: Formal, industry-focused, skills-oriented learning.\n2.⁠ ⁠*Casual*: Relaxed, conversational, enjoyable learning experience.\n3.⁠ ⁠*Informational*: Straightforward, fact-focused, academic-style learning.', type: 'text', delay: 0 },
                { text: 'Pick your learning style:', type: 'dynamic_interactive', delay: 1000, buttons: ['Professional', 'Casual', 'Informational'] }
            ]
        },
        {
            stepName: 'alfred_language_prompt',
            displayName: 'Alfred Language Prompt',
            category: 'alfred',
            order: 14,
            variables: [],
            messages: [
                { text: 'Final Question! 🏁\n\nWhat language do you prefer this course in?\n\n_PS - We\'re adding support for several more soon!_', type: 'text', delay: 0 },
                { text: 'Pick your language:', type: 'dynamic_interactive', delay: 1000, buttons: ['English', 'Hindi', 'Spanish'] }
            ]
        },
        {
            stepName: 'alfred_name_prompt',
            displayName: 'Alfred Name Confirmation',
            category: 'alfred',
            order: 15,
            variables: [],
            messages: [
                { text: 'To allow Alfred to start his work, please type in your *Name* to confirm. ✍️', type: 'text', delay: 0 }
            ]
        },
        {
            stepName: 'alfred_generating_start',
            displayName: 'Alfred Generation Started',
            category: 'alfred',
            order: 16,
            variables: ['topic'],
            messages: [
                { text: 'You\'re done! ✅\n\nI\'m sure you\'ll enjoy this experience. Alfred is now creating your personalized course on *{{topic}}*.\n\nYou\'ll get the lessons spread across 3 days, in a fun, engaging way.\n\nI\'m excited, and I hope you are too! 🚀', type: 'text', delay: 0 },
                { text: '⏳ Alfred is now crafting your personalized course... This usually takes about 30–60 seconds. Hang tight!', type: 'text', delay: 2000 }
            ]
        },
        {
            stepName: 'alfred_generation_success',
            displayName: 'Alfred Generation Success',
            category: 'alfred',
            order: 17,
            variables: ['topic'],
            messages: [
                { text: '✅ *Alfred has created your course on "{{topic}}"!*\n\n3 days × 3 modules of personalized content, just for you.', type: 'text', delay: 0 },
                { text: 'Tap below to start your first lesson!', type: 'interactive', delay: 1500, header: 'Day 1 is ready! 📚', buttons: ['Start Day'] }
            ]
        },
        {
            stepName: 'day_complete',
            displayName: 'Day Complete',
            category: 'delivery',
            order: 20,
            variables: ['completedDay', 'modulesDone', 'name'],
            messages: [
                { text: '🌟 *Day {{completedDay}} of 3 complete!* ({{modulesDone}}/9 modules done)\n\nGreat work, {{name}}! Before we move on — any questions about today\'s content?', type: 'text', delay: 0 },
                { text: 'I can help clarify anything from today\'s lessons.', type: 'dual_interactive', delay: 2000, header: 'Questions? 🤔', buttons: ['Yes', 'No'] }
            ]
        },
        {
            stepName: 'course_complete',
            displayName: 'Course Complete',
            category: 'delivery',
            order: 21,
            variables: ['name', 'topic'],
            messages: [
                { text: '🎉🎊 *Congratulations {{name}}!*\n\nYou\'ve completed all 9 modules of *{{topic}}*!\n\nPreparing your certificate...', type: 'text', delay: 0 }
            ]
        },
        {
            stepName: 'help_menu',
            displayName: 'Help Menu',
            category: 'global',
            order: 30,
            variables: [],
            messages: [
                { text: '📋 *Here\'s what you can do:*\n\n• *next* — continue to the next lesson\n• *restart* — start your current course over\n• *new topic* — pick a different course\n• *alfred* — generate an AI course on any topic\n• *help* — show this menu\n\nDuring doubt mode, just type your question and I\'ll answer! 💡', type: 'text', delay: 0 }
            ]
        },
        {
            stepName: 'restart_message',
            displayName: 'Course Restart',
            category: 'global',
            order: 31,
            variables: ['name'],
            messages: [
                { text: '🔄 Let\'s pick a new topic, {{name}}!', type: 'text', delay: 0 }
            ]
        },
        {
            stepName: 'doubt_prompt',
            displayName: 'Doubt Mode Prompt',
            category: 'doubt',
            order: 40,
            variables: [],
            messages: [
                { text: 'Sure! Type your question and I\'ll help. 💡', type: 'text', delay: 0 }
            ]
        }
    ];
}

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
