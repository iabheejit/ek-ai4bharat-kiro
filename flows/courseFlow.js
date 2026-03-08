/**
 * courseFlow.js — Flow engine for the WhatsApp learning bot.
 *
 * 3 flows converge into one:
 *
 * ONBOARDING (new/unknown users):
 *   new_user → onboarding_welcome → onboarding_learn → onboarding_topic → awaiting_start
 *
 * AI GENERATION:
 *   generate_topic → generate_waiting → awaiting_start
 *
 * COURSE DELIVERY:
 *   awaiting_start → awaiting_next → awaiting_doubt_answer / doubt_mode → course_complete
 *
 * Global overrides: "restart", "hi/hello", "generate/create/ai"
 */

const Student = require('../models/Student');
const CourseContent = require('../models/CourseContent');
const ConversationLog = require('../models/ConversationLog');
const WA = require('../twilio_whatsapp');
const { solveUserQuery, generateForStudent } = require('../llama');
const { createLogger } = require('../utils/logger');
const { getOrCreateCertificate } = require('../utils/certificateStore');
const { markdownToWhatsApp } = require('../utils/whatsappFormatter');
const FlowTemplate = require('../models/FlowTemplate');

const logger = createLogger('flow');

// Pre-built topics shown during onboarding. Last option is always "Generate Course".
// Topics with pre-built content in DB. "Generate Course" is always appended as last option.
// Loaded dynamically from DB (templates with isTemplate=true). Refreshed every 5 minutes.
let AVAILABLE_TOPICS = ['JavaScript', 'Entrepreneurship']; // fallback defaults
let _topicsLastFetched = 0;
const TOPICS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function refreshAvailableTopics() {
    try {
        const topics = await CourseContent.distinct('topic', { isTemplate: true });
        if (topics.length > 0) {
            AVAILABLE_TOPICS = topics;
            logger.info('Refreshed available topics from DB', { topics });
        }
        _topicsLastFetched = Date.now();
    } catch (err) {
        logger.error('Failed to refresh topics from DB', { error: err.message });
    }
}

async function getAvailableTopics() {
    if (Date.now() - _topicsLastFetched > TOPICS_CACHE_TTL) {
        await refreshAvailableTopics();
    }
    return AVAILABLE_TOPICS;
}

// ═══════════════════════════════════════════════════════════
// FLOW TEMPLATE DB READER — reads messages from FlowTemplate collection
// ═══════════════════════════════════════════════════════════
const _flowCache = new Map();
const FLOW_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get a flow template's messages by stepName.
 * Returns the messages array, or null if not found / inactive.
 * Uses in-memory cache with 5-minute TTL.
 * @param {string} stepName
 * @returns {Promise<Array|null>}
 */
async function getFlowMessages(stepName) {
    const cached = _flowCache.get(stepName);
    if (cached && Date.now() - cached.ts < FLOW_CACHE_TTL) return cached.data;

    try {
        const tmpl = await FlowTemplate.findOne({ stepName, isActive: true }).lean();
        const data = tmpl?.messages || null;
        _flowCache.set(stepName, { data, ts: Date.now() });
        return data;
    } catch (err) {
        logger.error('Failed to read flow template', { stepName, error: err.message });
        return null;
    }
}

/**
 * Replace {{variable}} placeholders in a template message text.
 * @param {string} text
 * @param {Object} vars - key/value pairs
 * @returns {string}
 */
function interpolate(text, vars) {
    if (!text || !vars) return text || '';
    return text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] !== undefined ? vars[key] : `{{${key}}}`);
}

/**
 * Send a flow template's messages via WhatsApp.
 * Falls back to a callback function if no DB template exists.
 * @param {string} stepName
 * @param {string} phone
 * @param {Object} vars - variable substitutions
 * @param {Function} [fallback] - function to call if no template in DB
 */
async function sendFlowMessages(stepName, phone, vars = {}, fallback = null) {
    const messages = await getFlowMessages(stepName);
    if (!messages || messages.length === 0) {
        if (fallback) return fallback();
        return;
    }

    for (const msg of messages) {
        const text = interpolate(msg.text, vars);
        if (msg.delay > 0) await delay(msg.delay);

        switch (msg.type) {
            case 'interactive':
                await WA.sendInteractiveButtonsMessage(
                    interpolate(msg.header || '', vars),
                    text,
                    msg.buttons?.[0] || 'OK',
                    phone
                );
                break;
            case 'dual_interactive':
                await WA.sendInteractiveDualButtonsMessage(
                    interpolate(msg.header || '', vars),
                    text,
                    msg.buttons?.[0] || 'Yes',
                    msg.buttons?.[1] || 'No',
                    phone
                );
                break;
            case 'dynamic_interactive':
                await WA.sendDynamicInteractiveMsg(
                    (msg.buttons || []).map(b => ({ text: b })),
                    text,
                    phone
                );
                break;
            default:
                await WA.sendText(text, phone);
        }
    }
}

// Varied greetings so 9 modules don't all say the same thing
const MODULE_GREETINGS = [
    "Let's dive in! 🚀",
    "Here we go! 💪",
    "Ready? Let's learn! 📖",
    "Time to level up! ⚡",
    "Let's get into it! 🎯",
    "Knowledge time! 🧠",
    "Here's your next lesson! 📝",
    "Let's keep the momentum! 🔥",
    "Onward! 🌟",
];

const delay = (ms) => new Promise(r => setTimeout(r, ms));

// ═══════════════════════════════════════════════════════════
// FUZZY MATCHING — bigram (Dice coefficient) similarity
// ═══════════════════════════════════════════════════════════

function bigrams(str) {
    const s = str.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    const pairs = new Set();
    for (let i = 0; i < s.length - 1; i++) pairs.add(s.slice(i, i + 2));
    return pairs;
}

function fuzzyScore(a, b) {
    const setA = bigrams(a);
    const setB = bigrams(b);
    if (setA.size === 0 && setB.size === 0) return 1;
    if (setA.size === 0 || setB.size === 0) return 0;
    let intersection = 0;
    for (const bg of setA) if (setB.has(bg)) intersection++;
    return (2 * intersection) / (setA.size + setB.size);
}

// Trigger phrases — each has a canonical form and a minimum confidence (0-1)
const TRIGGER_PHRASES = [
    { phrase: 'hello tell me about ekatra', minScore: 0.90, action: 'start_onboarding' },
    { phrase: 'tell me about ekatra', minScore: 0.90, action: 'start_onboarding' },
    { phrase: 'hi tell me about ekatra', minScore: 0.90, action: 'start_onboarding' },
];

function matchTriggerPhrase(input) {
    const cleaned = input.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    for (const tp of TRIGGER_PHRASES) {
        const score = fuzzyScore(cleaned, tp.phrase);
        if (score >= tp.minScore) return { ...tp, score };
    }
    return null;
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

async function transition(student, toStep, trigger, userMessage, extraMeta = {}) {
    const fromStep = student.flowStep || 'new_user';
    logger.info(`Flow: ${fromStep} → ${toStep}`, { phone: student.phone, trigger, day: student.nextDay, module: student.nextModule });
    student.flowStep = toStep;
    student.lastInteractionAt = new Date();
    await Student.findByIdAndUpdate(student._id, { flowStep: toStep, lastInteractionAt: student.lastInteractionAt, lastMsg: (userMessage || '').substring(0, 200) });
    await ConversationLog.create({ studentPhone: student.phone, fromStep, toStep, trigger, day: student.nextDay, module: student.nextModule, userMessage: (userMessage || '').substring(0, 200), metadata: extraMeta });
}

async function getModuleContent(student) {
    const content = await CourseContent.findOne({ studentPhone: student.phone, topic: student.topic, day: student.nextDay }).lean();
    if (!content) return null;
    return content.modules[student.nextModule - 1] || null;
}

async function advanceProgress(student) {
    let nextDay = student.nextDay, nextModule = student.nextModule;
    const completedDay = nextDay, completedModule = nextModule;
    if (nextModule === 3) { nextDay++; nextModule = 1; } else { nextModule++; }
    const progress = nextDay > 3 ? 'Completed' : 'Pending';
    await Student.findByIdAndUpdate(student._id, { nextDay, nextModule, progress, dayCompleted: completedDay, moduleCompleted: completedModule });
    Object.assign(student, { nextDay, nextModule, progress, dayCompleted: completedDay, moduleCompleted: completedModule });
    logger.info('Progress advanced', { phone: student.phone, completedDay, completedModule, nextDay, nextModule, progress });
    return { nextDay, nextModule, progress, completedDay, completedModule };
}

async function deliverModule(student) {
    const mod = await getModuleContent(student);
    if (!mod) { await WA.sendText(`⚠️ Couldn't find content for Day ${student.nextDay}, Module ${student.nextModule}. Type "help" for options.`, student.phone); return false; }
    const greetIdx = ((student.nextDay - 1) * 3 + (student.nextModule - 1)) % MODULE_GREETINGS.length;
    const greeting = MODULE_GREETINGS[greetIdx];
    const modulesDone = (student.nextDay - 1) * 3 + (student.nextModule - 1);
    await WA.sendText(`📚 *Day ${student.nextDay}, Module ${student.nextModule}* — _${student.topic}_\n📊 Progress: ${modulesDone}/9 modules completed\n\n${greeting} ${student.name} 👇`, student.phone);
    await delay(1500);
    await WA.sendText(markdownToWhatsApp(mod.text), student.phone);
    if (mod.files && mod.files.length > 0) { for (const file of mod.files) { if (file.url) { await delay(1000); await WA.sendFileByUrl(file.url, file.filename || 'file', student.phone); } } }
    await delay(2000);
    await WA.sendInteractiveButtonsMessage(`Module ${student.nextModule} delivered ✅`, `Take your time. Tap *Next* when ready!`, 'Next', student.phone);
    logger.info('Module delivered', { phone: student.phone, day: student.nextDay, module: student.nextModule });
    return true;
}

async function copyContentToStudent(student, topic) {
    // Only copy from template content (isTemplate: true), not from other students
    const escaped = topic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const existing = await CourseContent.find({ topic: new RegExp(`^${escaped}$`, 'i'), isTemplate: true }).sort({ day: 1 }).lean();
    if (existing.length === 0) return false;
    await CourseContent.deleteMany({ studentPhone: student.phone, topic });
    for (const doc of existing) { await CourseContent.create({ studentPhone: student.phone, topic, day: doc.day, modules: doc.modules }); }
    logger.info('Copied template content to student', { phone: student.phone, topic, days: existing.length });
    return true;
}

async function sendTopicSelection(phone) {
    const topics = await getAvailableTopics();
    const topicButtons = topics.map(t => ({ text: t }));
    topicButtons.push({ text: 'Generate Course' });
    await WA.sendDynamicInteractiveMsg(topicButtons, `Which of these topics would you like to get started with?`, phone);
}


// ═══════════════════════════════════════════════════════════
// ONBOARDING HANDLERS
// ═══════════════════════════════════════════════════════════

async function handleNewUser(student, event) {
    const name = student.name || event.senderName || 'there';
    if (!student.name && event.senderName && event.senderName !== 'User') {
        await Student.findByIdAndUpdate(student._id, { name: event.senderName });
        student.name = event.senderName;
    }
    await sendFlowMessages('new_user_welcome', student.phone, { name }, async () => {
        // Hardcoded fallback
        await WA.sendText(
            `${name}, Welcome to *ekatra!* 🎓\n\n` +
            `A brand new way of learning! Let's start your learning journey through micro-lessons, ` +
            `shared over WhatsApp! Each 'micro lesson' will focus on specific key learning blocks ` +
            `and help you get the edge in today's fast-paced world.\n\n` +
            `You are part of an exclusive group that has this access!\n\n` +
            `Let's get you started?`, student.phone);
        await delay(1500);
        await WA.sendInteractiveButtonsMessage(`Ready to learn? 🚀`, `Tap below to begin your journey!`, "Yes, Let's do this!", student.phone);
    });
    await transition(student, 'onboarding_welcome', 'text:first_message', event.text);
}

async function handleOnboardingWelcome(student, event) {
    const text = (event.text || '').toLowerCase().trim();
    if (text.includes('yes') || text.includes("let's") || text.includes('do this') || text.includes('start')) {
        await WA.sendText(
            `That's amazing 🤩\n\nNow you can use WhatsApp to learn a new thing everyday!\n\n` +
            `✳️ ekatra is the first unified learning platform, leveraging text, audio and video ` +
            `communication to reach over 1 billion learners in underserved communities worldwide 🌍`, student.phone);
        await delay(2000);
        await WA.sendInteractiveButtonsMessage(`Let's get started! 👇`, `Start your learning journey with ekatra.`, 'Learn with ekatra', student.phone);
        await transition(student, 'onboarding_learn', 'button:Yes', event.text);
    } else {
        await WA.sendInteractiveButtonsMessage(`Ready to learn? 🚀`, `Tap below to begin!`, "Yes, Let's do this!", student.phone);
    }
}

async function handleOnboardingLearn(student, event) {
    const text = (event.text || '').toLowerCase().trim();
    if (text.includes('learn') || text.includes('ekatra') || text.includes('start') || text.includes('next')) {
        await WA.sendText(
            `⭐ Welcome, let's experience the power of micro-learning!\n\n` +
            `You can choose to learn a topic through carefully curated content, spread over a few days.\n\n` +
            `_Once you select a topic, you will need to complete it before you can start the next one!_`, student.phone);
        await delay(1500);
        await sendTopicSelection(student.phone);
        await transition(student, 'onboarding_topic', 'button:Learn', event.text);
    } else {
        await WA.sendInteractiveButtonsMessage(`Let's get started! 👇`, `Tap below to begin.`, 'Learn with ekatra', student.phone);
    }
}

async function handleOnboardingTopic(student, event) {
    const text = (event.text || '').trim();
    const textLower = text.toLowerCase();
    const topics = await getAvailableTopics();

    // Check pre-built topic by name or number
    let selectedTopic = null;
    for (let i = 0; i < topics.length; i++) {
        const t = topics[i];
        if (textLower === t.toLowerCase() || textLower === `option_${i + 1}` || textLower === String(i + 1)) { selectedTopic = t; break; }
    }

    // Also check if they typed "Generate Course" as text (not just button)
    if (!selectedTopic && (textLower.includes('generate') || textLower === `option_${topics.length + 1}` || textLower === String(topics.length + 1))) {
        await WA.sendText(
            `ekatra is excited to introduce *Alfred*, a MetaAI powered learning assistant ` +
            `that helps you create courses on any topic of your choice. 🤖`, student.phone);
        await delay(1500);
        await WA.sendText(`Isn't that impressive? Want to know how you can start learning with Alfred's help?`, student.phone);
        await delay(1000);
        await WA.sendInteractiveButtonsMessage(`Meet Alfred 🤖`, `Tap below to get started!`, 'Yes, Tell me!', student.phone);
        await transition(student, 'alfred_intro', 'button:Generate Course', event.text);
        return;
    }

    if (selectedTopic) {
        await Student.findByIdAndUpdate(student._id, { topic: selectedTopic, courseStatus: 'Content Created', progress: 'Pending', nextDay: 1, nextModule: 1, dayCompleted: 0, moduleCompleted: 0, doubt: 0 });
        Object.assign(student, { topic: selectedTopic, courseStatus: 'Content Created', progress: 'Pending', nextDay: 1, nextModule: 1 });

        const copied = await copyContentToStudent(student, selectedTopic);
        if (copied) {
            await WA.sendText(`🎉 Congratulations on enrolling in *${selectedTopic}*!\n\nYour course is ready — 3 days, 3 modules per day.`, student.phone);
            await delay(1500);
            await WA.sendInteractiveButtonsMessage(`Day 1 is ready! 📚`, `Tap below to start your first lesson.`, 'Start Day', student.phone);
            await transition(student, 'awaiting_start', `button:topic:${selectedTopic}`, event.text);
        } else {
            await WA.sendText(`I don't have pre-built content for *${selectedTopic}* yet, but Alfred can generate it! 🤖`, student.phone);
            await delay(1000);
            await Student.findByIdAndUpdate(student._id, { topic: selectedTopic });
            student.topic = selectedTopic;
            // Skip straight to Alfred goal question since we already have the topic
            await WA.sendText(
                `Could you let Alfred know what do you want to achieve by learning *${selectedTopic}*?\n\n` +
                `Some examples:\n` +
                `1.⁠ ⁠Gain a basic understanding of foundational concepts\n` +
                `2.⁠ ⁠Prepare for a Technical Job Interview\n` +
                `3.⁠ ⁠Learn a new skill\n\n` +
                `What do you want to gain?`, student.phone);
            await transition(student, 'alfred_goal', `button:topic:${selectedTopic}`, event.text);
        }
    } else {
        await sendTopicSelection(student.phone);
    }
}


// ═══════════════════════════════════════════════════════════
// ALFRED AI GENERATION FLOW
// ═══════════════════════════════════════════════════════════

/**
 * ALFRED_INTRO — Sent Alfred intro, awaiting "Yes, Tell me!"
 */
async function handleAlfredIntro(student, event) {
    const text = (event.text || '').toLowerCase().trim();
    if (text.includes('yes') || text.includes('tell me') || text.includes('start')) {
        await WA.sendText(`That's exciting! 🎉`, student.phone);
        await delay(1500);
        await WA.sendText(
            `Let Alfred know the topic you want to learn, keep it very concise and specific.\n\n` +
            `eg.\n` +
            `1.⁠ ⁠Project Management for Engineers\n` +
            `2.⁠ ⁠Roman Art History\n` +
            `3.⁠ ⁠Indian Classical Music\n` +
            `4.⁠ ⁠How to Teach AI\n\n` +
            `What's on your mind?`, student.phone);
        await transition(student, 'alfred_topic', 'button:Yes Tell me', event.text);
    } else {
        await WA.sendInteractiveButtonsMessage(`Curious? 🤖`, `Tap below to learn how Alfred works!`, 'Yes, Tell me!', student.phone);
    }
}

/**
 * ALFRED_TOPIC — Waiting for user to type their topic.
 */
// Known button/command text that should NOT be saved as a topic
const NON_TOPIC_WORDS = ['start lesson', 'start day', 'start', 'next', 'next module', 'restart', 'reset',
    'new topic', 'help', 'menu', 'commands', 'remind later', 'get certificate',
    'yes', 'no', 'casual', 'professional', 'informational', 'english', 'hindi', 'spanish',
    'generate', 'create', 'ai', 'alfred', 'create course', 'generate course',
    'option_1', 'option_2', 'option_3'];

async function handleAlfredTopic(student, event) {
    const text = (event.text || '').trim();
    if (text.length < 2) {
        await WA.sendText(`Please type a topic you'd like to learn (e.g. "Project Management for Engineers"):`, student.phone);
        return;
    }
    // Reject known button/command text — prompt for a real topic
    if (NON_TOPIC_WORDS.includes(text.toLowerCase())) {
        logger.warn('Button/command text rejected as topic', { phone: student.phone, text });
        await WA.sendText(`Hmm, that doesn't look like a topic. 🤔\n\nPlease type the subject you'd like to learn, e.g.:\n• Project Management for Engineers\n• Roman Art History\n• Indian Classical Music`, student.phone);
        return;
    }
    await Student.findByIdAndUpdate(student._id, { topic: text });
    student.topic = text;

    await WA.sendText(
        `That's an interesting topic to learn! 🧠\n\n` +
        `Could you let Alfred know what do you want to achieve by learning this topic? ` +
        `Think for the next 30 seconds and then answer this.\n\n` +
        `Some examples could be:\n` +
        `1.⁠ ⁠Gain a basic understanding of foundational concepts\n` +
        `2.⁠ ⁠Design a Teaching curriculum for Graduate Students\n` +
        `3.⁠ ⁠Prepare for a Technical Job Interview\n` +
        `4.⁠ ⁠Learn a new skill\n\n` +
        `What do you want to gain out of this experience?`, student.phone);
    await transition(student, 'alfred_goal', 'text:topic', event.text);
}

/**
 * ALFRED_GOAL — Waiting for learning goal.
 */
async function handleAlfredGoal(student, event) {
    const text = (event.text || '').trim();
    if (text.length < 2) {
        await WA.sendText(`Please describe what you want to achieve (e.g. "Gain a basic understanding"):`, student.phone);
        return;
    }
    await Student.findByIdAndUpdate(student._id, { goal: text });
    student.goal = text;

    const styleButtons = [
        { text: 'Professional' },
        { text: 'Casual' },
        { text: 'Informational' }
    ];
    await WA.sendText(
        `How would you like to learn this topic?\n\n` +
        `1.⁠ ⁠*Professional*: Formal, industry-focused, skills-oriented learning.\n` +
        `2.⁠ ⁠*Casual*: Relaxed, conversational, enjoyable learning experience.\n` +
        `3.⁠ ⁠*Informational*: Straightforward, fact-focused, academic-style learning.`, student.phone);
    await delay(1000);
    await WA.sendDynamicInteractiveMsg(styleButtons, `Pick your learning style:`, student.phone);
    await transition(student, 'alfred_style', 'text:goal', event.text);
}

/**
 * ALFRED_STYLE — Waiting for learning style pick.
 */
async function handleAlfredStyle(student, event) {
    const text = (event.text || '').toLowerCase().trim();
    const styles = { 'professional': 'Professional', 'casual': 'Casual', 'informational': 'Informational', 'option_1': 'Professional', 'option_2': 'Casual', 'option_3': 'Informational', '1': 'Professional', '2': 'Casual', '3': 'Informational' };
    const style = styles[text];
    if (!style) {
        const styleButtons = [{ text: 'Professional' }, { text: 'Casual' }, { text: 'Informational' }];
        await WA.sendDynamicInteractiveMsg(styleButtons, `Please pick a learning style:`, student.phone);
        return;
    }
    await Student.findByIdAndUpdate(student._id, { style });
    student.style = style;

    await WA.sendText(`Final Question! 🏁\n\nWhat language do you prefer this course in?\n\n_PS - We're adding support for several more soon!_`, student.phone);
    await delay(1000);
    const langButtons = [{ text: 'English' }, { text: 'Hindi' }, { text: 'Spanish' }];
    await WA.sendDynamicInteractiveMsg(langButtons, `Pick your language:`, student.phone);
    await transition(student, 'alfred_language', 'button:style', event.text);
}

/**
 * ALFRED_LANGUAGE — Waiting for language pick.
 */
async function handleAlfredLanguage(student, event) {
    const text = (event.text || '').toLowerCase().trim();
    const langs = { 'english': 'English', 'hindi': 'Hindi', 'spanish': 'Spanish', 'option_1': 'English', 'option_2': 'Hindi', 'option_3': 'Spanish', '1': 'English', '2': 'Hindi', '3': 'Spanish' };
    const language = langs[text];
    if (!language) {
        const langButtons = [{ text: 'English' }, { text: 'Hindi' }, { text: 'Spanish' }];
        await WA.sendDynamicInteractiveMsg(langButtons, `Please pick a language:`, student.phone);
        return;
    }
    await Student.findByIdAndUpdate(student._id, { language });
    student.language = language;

    await WA.sendText(`To allow Alfred to start his work, please type in your *Name* to confirm. ✍️`, student.phone);
    await transition(student, 'alfred_name', 'button:language', event.text);
}

/**
 * ALFRED_NAME — Waiting for name confirmation, then trigger generation.
 */
async function handleAlfredName(student, event) {
    const text = (event.text || '').trim();
    if (text.length < 2) {
        await WA.sendText(`Please type your name to confirm:`, student.phone);
        return;
    }
    await Student.findByIdAndUpdate(student._id, { name: text, courseStatus: 'Approved' });
    student.name = text;

    await WA.sendText(
        `You're done! ✅\n\n` +
        `I'm sure you'll enjoy this experience. Alfred is now creating your personalized course on *${student.topic}*.\n\n` +
        `You'll get the lessons spread across 3 days, in a fun, engaging way.\n\n` +
        `I'm excited, and I hope you are too! 🚀`, student.phone);
    await transition(student, 'alfred_generating', 'text:name_confirmed', event.text);

    // Fire off generation
    await delay(2000);
    await WA.sendText(`⏳ Alfred is now crafting your personalized course... This usually takes about 30–60 seconds. Hang tight!`, student.phone);
    try {
        const success = await generateForStudent(student.phone);
        const updated = await Student.findById(student._id).lean();
        if (success) {
            await WA.sendText(`✅ *Alfred has created your course on "${student.topic}"!*\n\n3 days × 3 modules of personalized content, just for you.`, updated.phone);
            await delay(1500);
            await WA.sendInteractiveButtonsMessage(`Day 1 is ready! 📚`, `Tap below to start your first lesson!`, 'Start Day', updated.phone);
            await ConversationLog.create({ studentPhone: updated.phone, fromStep: 'alfred_generating', toStep: 'awaiting_start', trigger: 'system:generation_complete', day: 1, module: 1 });
        } else {
            await WA.sendText(`😔 Alfred had trouble generating your course. Let's try again.\n\nType a topic:`, updated.phone);
            await Student.findByIdAndUpdate(student._id, { flowStep: 'alfred_topic' });
            await ConversationLog.create({ studentPhone: updated.phone, fromStep: 'alfred_generating', toStep: 'alfred_topic', trigger: 'system:generation_failed', day: 1, module: 1 });
        }
    } catch (err) {
        logger.error('Alfred generation failed', { error: err.message, phone: student.phone });
        await WA.sendText(`😔 Something went wrong. Type a topic to try again:`, student.phone);
        await Student.findByIdAndUpdate(student._id, { flowStep: 'alfred_topic' });
    }
}

/**
 * ALFRED_GENERATING — AI is working. Any message gets a "still working" response.
 */
async function handleAlfredGenerating(student, event) {
    await WA.sendText(`⏳ Alfred is still working on your *${student.topic}* course...\n\nAlmost there! I'll message you when it's ready.`, student.phone);
}


// ═══════════════════════════════════════════════════════════
// COURSE DELIVERY HANDLERS
// ═══════════════════════════════════════════════════════════

async function handleIdle(student, event) {
    const { name, nextDay, nextModule, progress } = student;
    if (progress === 'Completed') {
        await WA.sendText(`Welcome back ${name}! 🎉\n\nYou've completed *${student.topic}*.`, student.phone);
        await delay(1500);
        await WA.sendInteractiveDualButtonsMessage(`What next?`, `Restart this course or pick a new topic?`, 'Restart', 'New Topic', student.phone);
        await transition(student, 'course_complete', `text:${event.text}`, event.text);
    } else if (!student.topic || student.courseStatus !== 'Content Created') {
        await handleOnboardingLearn(student, event);
    } else {
        await WA.sendText(`Hey ${name}! 👋\n\nYou're enrolled in *${student.topic}*.\n📍 *Day ${nextDay}, Module ${nextModule}*.`, student.phone);
        await delay(1500);
        if (nextModule === 1) {
            await WA.sendInteractiveButtonsMessage(`Day ${nextDay} is ready! 📚`, `Tap below to begin.`, 'Start Day', student.phone);
            await transition(student, 'awaiting_start', `text:${event.text}`, event.text);
        } else {
            await WA.sendInteractiveButtonsMessage(`Continue learning ✨`, `Pick up where you left off!`, 'Next', student.phone);
            await transition(student, 'awaiting_next', `text:${event.text}`, event.text);
        }
    }
}

async function handleAwaitingStart(student, event) {
    const text = (event.text || '').toLowerCase().trim();
    if (['start day', 'start', 'start lesson', 'next', 'next module'].includes(text)) {
        const delivered = await deliverModule(student);
        if (delivered) await transition(student, 'awaiting_next', 'button:Start Day', event.text);
    } else {
        await WA.sendInteractiveButtonsMessage(`Day ${student.nextDay} is waiting! 📚`, `I didn't catch that — tap below to start your lesson!`, 'Start Day', student.phone);
    }
}

async function handleAwaitingNext(student, event) {
    const text = (event.text || '').toLowerCase().trim();
    if (!['next', 'next module', 'start day'].includes(text)) {
        await WA.sendInteractiveButtonsMessage(`Day ${student.nextDay}, Module ${student.nextModule} 📖`, `I didn't catch that — tap *Next* when you're ready to continue!`, 'Next', student.phone);
        return;
    }
    const { nextDay, nextModule, progress, completedDay, completedModule } = await advanceProgress(student);
    if (progress === 'Completed') {
        await WA.sendText(`🎉🎊 *Congratulations ${student.name}!*\n\nYou've completed all 9 modules of *${student.topic}*!\n\nPreparing your certificate...`, student.phone);
        try {
            await delay(4000);
            const certificate = await getOrCreateCertificate(student);
            await WA.sendMedia(certificate.url, `${student.name}_${student.topic}`, student.phone, `🏆 Your certificate for *${student.topic}*!`);
        } catch (e) {
            logger.error('Certificate failed', { error: e.message });
            await WA.sendText(`Sorry, I couldn't deliver your certificate right now. Reply *Get Certificate* and I'll try again.`, student.phone);
        }
        await delay(4000); await WA.sendFeedbackSurvey(student.phone, student.topic);
        await delay(4000); await WA.sendInteractiveDualButtonsMessage(`What next? 🎓`, `Start a new course or restart this one?`, 'New Topic', 'Restart', student.phone);
        await transition(student, 'course_complete', 'button:Next', event.text, { completedDay, completedModule });
    } else if (completedModule === 3) {
        const modulesDone = completedDay * 3;
        await WA.sendText(`🌟 *Day ${completedDay} of 3 complete!* (${modulesDone}/9 modules done)\n\nGreat work, ${student.name}! Before we move on — any questions about today's content?`, student.phone);
        await delay(2000); await WA.sendInteractiveDualButtonsMessage(`Questions? 🤔`, `I can help clarify anything from today's lessons.`, 'Yes', 'No', student.phone);
        await transition(student, 'awaiting_doubt_answer', 'button:Next', event.text, { completedDay, completedModule });
    } else {
        const delivered = await deliverModule(student);
        if (delivered) await transition(student, 'awaiting_next', 'button:Next', event.text, { completedDay, completedModule });
    }
}

async function handleAwaitingDoubtAnswer(student, event) {
    const text = (event.text || '').toLowerCase().trim();
    if (text === 'yes') {
        await Student.findByIdAndUpdate(student._id, { doubt: 1 });
        await WA.sendText(`Sure! Type your question and I'll help. 💡`, student.phone);
        await transition(student, 'doubt_mode', 'button:Yes', event.text);
    } else if (text === 'no') {
        await Student.findByIdAndUpdate(student._id, { doubt: 0 });
        if (student.nextDay <= 3) {
            await Student.findByIdAndUpdate(student._id, { dayCompletedAt: new Date() });
            await WA.sendText(`Awesome work today, ${student.name}! 🌟\n\nDay ${student.nextDay} will be unlocked tomorrow at 9 AM. See you then! 👋`, student.phone);
            await transition(student, 'awaiting_next_day', 'button:No', event.text);
        } else { await WA.sendText(`You've completed the course! 🎉`, student.phone); await transition(student, 'course_complete', 'button:No', event.text); }
    } else {
        await WA.sendInteractiveDualButtonsMessage(`Any doubts? 🤔`, `I didn't catch that — just tap one of the buttons below!`, 'Yes', 'No', student.phone);
    }
}

async function handleDoubtMode(student, event) {
    const text = (event.text || '').trim();
    if (!text || text.length < 2) { await WA.sendText(`Type your question! 💡`, student.phone); return; }
    logger.info('Processing doubt', { phone: student.phone, query: text.substring(0, 80) });
    await solveUserQuery(text, student.phone);
    await delay(2000); await WA.sendInteractiveDualButtonsMessage(`Got it! 📝`, `Any other questions?`, 'Yes', 'No', student.phone);
    await transition(student, 'awaiting_doubt_answer', 'text:doubt_query', text);
}

async function handleAwaitingNextDay(student, event) {
    const text = (event.text || '').toLowerCase().trim();
    // Check if a new calendar day has arrived (IST)
    const now = new Date();
    const completedAt = student.dayCompletedAt ? new Date(student.dayCompletedAt) : null;
    const istOffset = 5.5 * 60 * 60 * 1000; // IST = UTC+5:30
    const nowIST = new Date(now.getTime() + istOffset);
    const completedIST = completedAt ? new Date(completedAt.getTime() + istOffset) : null;
    const isNewDay = !completedIST || nowIST.toDateString() !== completedIST.toDateString();

    if (isNewDay) {
        // Unlock — transition to awaiting_start
        await Student.findByIdAndUpdate(student._id, { dayCompletedAt: null });
        await WA.sendText(`Good morning, ${student.name}! ☀️ Day ${student.nextDay} is now unlocked!`, student.phone);
        await delay(1500);
        await WA.sendInteractiveButtonsMessage(`Day ${student.nextDay} is ready! 📚`, `Tap below to begin today's lessons.`, 'Start Day', student.phone);
        await transition(student, 'awaiting_start', 'text:day_unlocked', event.text);
    } else {
        // Still locked
        await WA.sendText(`⏳ Day ${student.nextDay} will be unlocked tomorrow at 9 AM.\n\nTake some time to review today's lessons — see you tomorrow, ${student.name}! 👋`, student.phone);
    }
}

async function handleCourseComplete(student, event) {
    const text = (event.text || '').toLowerCase().trim();
    if (text === 'restart' || text === 'reset') return 'restart';

    // Handle "Get Certificate" button from course_complete template
    if (text === 'get certificate') {
        await WA.sendText(`🏆 Fetching your certificate for *${student.topic}*...`, student.phone);
        try {
            const certificate = await getOrCreateCertificate(student);
            await WA.sendMedia(certificate.url, `${student.name}_${student.topic}`, student.phone, `🏆 Your certificate for *${student.topic}*!`);
        } catch (e) {
            logger.error('Certificate re-generation failed', { error: e.message });
            await WA.sendText(`Sorry, couldn't generate the certificate right now. Try again later.`, student.phone);
        }
        await delay(2000);
        await WA.sendInteractiveDualButtonsMessage(`What next?`, `Start a new course or restart this one?`, 'New Topic', 'Restart', student.phone);
        return;
    }

    await WA.sendText(`You've completed *${student.topic}*! 🎓\n\nWant to learn something new?`, student.phone);
    await delay(1500); await WA.sendInteractiveDualButtonsMessage(`What next?`, `Start a new course or restart this one?`, 'New Topic', 'Restart', student.phone);
}


// ═══════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════

const stepHandlers = {
    new_user: handleNewUser, onboarding_welcome: handleOnboardingWelcome,
    onboarding_learn: handleOnboardingLearn, onboarding_topic: handleOnboardingTopic,
    alfred_intro: handleAlfredIntro, alfred_topic: handleAlfredTopic,
    alfred_goal: handleAlfredGoal, alfred_style: handleAlfredStyle,
    alfred_language: handleAlfredLanguage, alfred_name: handleAlfredName,
    alfred_generating: handleAlfredGenerating,
    idle: handleIdle, awaiting_start: handleAwaitingStart, awaiting_next: handleAwaitingNext,
    awaiting_next_day: handleAwaitingNextDay,
    awaiting_doubt_answer: handleAwaitingDoubtAnswer, doubt_mode: handleDoubtMode,
    course_complete: handleCourseComplete,
};

async function handle(event) {
    const phone = event.waId;
    if (!phone) { logger.warn('No phone in event'); return; }

    let student = await Student.findOne({ phone });
    if (!student) {
        logger.info('New user — auto-enrolling', { phone });
        student = await Student.create({ phone, name: event.senderName !== 'User' ? event.senderName : '', flowStep: 'new_user', courseStatus: '', progress: 'In Progress' });
    }

    const studentId = student._id;
    student = student.toObject ? student.toObject() : { ...student };
    student._id = studentId;

    const text = (event.text || '').toLowerCase().trim();

    // ─── Global overrides ───
    if ((text === 'restart' || text === 'reset') && !['new_user', 'onboarding_welcome', 'onboarding_learn'].includes(student.flowStep)) {
        await Student.findByIdAndUpdate(student._id, { nextDay: 1, nextModule: 1, progress: 'Pending', moduleCompleted: 0, dayCompleted: 0, doubt: 0, flowStep: 'onboarding_topic', topic: '', courseStatus: '', certificate: null });
        Object.assign(student, { nextDay: 1, nextModule: 1, flowStep: 'onboarding_topic', topic: '' });
        await WA.sendText(`🔄 Let's pick a new topic, ${student.name || 'Learner'}!`, phone);
        await delay(1000); await sendTopicSelection(phone);
        await transition(student, 'onboarding_topic', 'text:restart', event.text);
        return;
    }

    if (text === 'new topic' && student.flowStep === 'course_complete') {
        await Student.findByIdAndUpdate(student._id, { nextDay: 1, nextModule: 1, progress: 'Pending', moduleCompleted: 0, dayCompleted: 0, doubt: 0, flowStep: 'onboarding_topic', topic: '', courseStatus: '', certificate: null });
        Object.assign(student, { flowStep: 'onboarding_topic', topic: '' });
        await sendTopicSelection(phone);
        await transition(student, 'onboarding_topic', 'button:New Topic', event.text);
        return;
    }

    if (['hi', 'hello', 'hey', 'start'].includes(text) && !student.flowStep.startsWith('onboarding') && student.flowStep !== 'new_user' && student.flowStep !== 'awaiting_next_day') {
        student.flowStep = 'idle'; await handleIdle(student, event); return;
    }

    // Fuzzy trigger phrase matching (e.g. "Hello, tell me about ekatra" at 90% confidence)
    const triggerMatch = matchTriggerPhrase(text);
    if (triggerMatch && triggerMatch.action === 'start_onboarding') {
        logger.info('Trigger phrase matched', { phone, phrase: triggerMatch.phrase, score: triggerMatch.score.toFixed(2) });
        if (student.flowStep === 'new_user') {
            await handleNewUser(student, event);
        } else if (student.flowStep === 'awaiting_next_day') {
            await handleAwaitingNextDay(student, event);
        } else {
            student.flowStep = 'idle'; await handleIdle(student, event);
        }
        return;
    }

    // Also catch greetings at the start of a longer message
    if (/^(hi|hello|hey)\b/.test(text) && !student.flowStep.startsWith('onboarding') && student.flowStep !== 'new_user' && student.flowStep !== 'awaiting_next_day') {
        student.flowStep = 'idle'; await handleIdle(student, event); return;
    }

    if (text === 'remind later') {
        await WA.sendText(`No problem, ${student.name || 'Learner'}! 👋 I'll remind you later. Type *hi* whenever you're ready to continue.`, phone);
        return;
    }

    if (['help', 'menu', 'commands'].includes(text)) {
        await sendFlowMessages('help_menu', phone, {}, async () => {
            await WA.sendText(
                `📋 *Here's what you can do:*\n\n` +
                `• *next* — continue to the next lesson\n` +
                `• *restart* — start your current course over\n` +
                `• *new topic* — pick a different course\n` +
                `• *alfred* — generate an AI course on any topic\n` +
                `• *help* — show this menu\n\n` +
                `During doubt mode, just type your question and I'll answer! 💡`, phone);
        });
        return;
    }

    if (['generate', 'create', 'ai', 'create course', 'generate course', 'alfred'].includes(text) && ['idle', 'course_complete', 'awaiting_start'].includes(student.flowStep)) {
        await WA.sendText(
            `ekatra is excited to introduce *Alfred*, a MetaAI powered learning assistant ` +
            `that helps you create courses on any topic of your choice. 🤖`, phone);
        await delay(1500);
        await WA.sendText(`Isn't that impressive? Want to know how you can start learning with Alfred's help?`, phone);
        await delay(1000);
        await WA.sendInteractiveButtonsMessage(`Meet Alfred 🤖`, `Tap below to get started!`, 'Yes, Tell me!', phone);
        await transition(student, 'alfred_intro', 'text:generate', event.text);
        return;
    }

    // ─── Route to step handler ───
    const handler = stepHandlers[student.flowStep || 'new_user'];
    if (!handler) { await handleNewUser(student, event); return; }

    const result = await handler(student, event);
    if (result === 'restart') {
        await Student.findByIdAndUpdate(student._id, { nextDay: 1, nextModule: 1, progress: 'Pending', moduleCompleted: 0, dayCompleted: 0, doubt: 0, flowStep: 'awaiting_start', certificate: null });
        Object.assign(student, { nextDay: 1, nextModule: 1 });
        await WA.sendText(`Course reset! 🔄 Let's go again, ${student.name}.`, phone);
        await delay(1500); await WA.sendInteractiveButtonsMessage(`Day 1 is ready! 📚`, `Tap below!`, 'Start Day', phone);
        await transition(student, 'awaiting_start', 'text:restart', event.text);
    }
}

module.exports = { handle, AVAILABLE_TOPICS };
