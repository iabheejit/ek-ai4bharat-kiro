/**
 * twilio_whatsapp.js — Twilio WhatsApp messaging layer
 * 
 * Uses pre-approved Twilio Content API templates (HX... SIDs) for:
 *   - Daily reminders (works outside 24hr window)
 *   - Course completion notifications
 *   - Student registration flows
 *   - Course feedback surveys
 * 
 * For in-session messages (within 24hr window):
 *   - Quick-reply buttons created via Content API and cached in memory
 *   - Plain text fallback if Content API fails
 * 
 * Max 3 quick-reply buttons per WhatsApp message.
 */

require('dotenv').config();
const twilio = require('twilio');
const https = require('https');
const { createLogger } = require('./utils/logger');
const { uploadPDFToS3 } = require('./utils/s3Upload');
const { uploadPDFToCloudinary } = require('./utils/cloudinaryUpload');

const logger = createLogger('whatsapp');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const rawFromNumber = process.env.TWILIO_WHATSAPP_NUMBER || '+14155238886';
const fromNumber = rawFromNumber.startsWith('whatsapp:') ? rawFromNumber : `whatsapp:${rawFromNumber}`;
const authHeader = 'Basic ' + Buffer.from(accountSid + ':' + authToken).toString('base64');

let client;
try {
    client = twilio(accountSid, authToken);
    logger.info('Twilio client initialized', { from: fromNumber });
} catch (e) {
    logger.warn('Twilio client not initialized — running in mock mode');
    client = null;
}

// ─── Pre-approved Content Template SIDs ───
// These are approved by WhatsApp and can be sent OUTSIDE the 24hr session window.
// Manage at: https://content.twilio.com or via wa-test.js status
const APPROVED_TEMPLATES = {
    daily_reminder:       'HX3097cf97f11eae20a76ee987c9bf0cff',  // vars: {1: name, 2: day, 3: course}
    course_complete:      'HXf0db8c84b5e931318c0519d8fd86c90f',  // quick-reply buttons
    student_registration: 'HXf882e3f42af1389ad24d9905ff509238',  // flow/form
    course_feedback:      'HX7fe79d524e43344bbb94918a1d133179',  // vars: {1: course_name}
    course_feedback_v2:   'HXc0b170a47c6da5de5756b288e502b2a9',  // updated version
};

// ─── In-memory cache for dynamically created quick-reply templates ───
// Key: sorted button titles joined by '|', Value: contentSid
const templateCache = new Map();

function formatPhone(phone) {
    // Ensure phone is in whatsapp:+{number} format
    const cleaned = String(phone).replace(/\D/g, '');
    return `whatsapp:+${cleaned}`;
}

/**
 * Send a plain text message via WhatsApp
 * Only works within the 24hr session window.
 */
const sendText = async (msg, senderID) => {
    logger.info('Sending text', { phone: senderID });
    try {
        if (!client) {
            logger.info('[MOCK] Text message', { phone: senderID, body: msg.substring(0, 80) });
            return;
        }
        const message = await client.messages.create({
            body: msg,
            from: fromNumber,
            to: formatPhone(senderID)
        });
        logger.info('Text sent', { sid: message.sid, phone: senderID });
    } catch (error) {
        logger.error('Failed to send text', { error: error.message, phone: senderID });
    }
};

/**
 * Send a media file (PDF, image) via WhatsApp
 * Twilio requires a publicly accessible URL, so buffers are uploaded first.
 */
const sendMedia = async (bufferOrUrl, filename, senderID, caption) => {
    logger.info('Sending media', { phone: senderID, filename });
    try {
        if (!client) {
            logger.info('[MOCK] Media message', { phone: senderID, filename });
            return;
        }

        const msgParams = {
            body: caption || filename,
            from: fromNumber,
            to: formatPhone(senderID)
        };

        if (typeof bufferOrUrl === 'string' && bufferOrUrl.startsWith('http')) {
            msgParams.mediaUrl = [bufferOrUrl];
        } else if (Buffer.isBuffer(bufferOrUrl)) {
            const safeFilename = String(filename || 'certificate')
                .trim()
                .replace(/\.[^.]+$/, '')
                .replace(/[^a-zA-Z0-9_-]+/g, '_')
                .replace(/^_+|_+$/g, '') || 'certificate';
            let mediaUrl;
            try {
                mediaUrl = await uploadPDFToS3(bufferOrUrl, safeFilename);
            } catch (s3Error) {
                logger.warn('S3 upload failed, falling back to Cloudinary', { error: s3Error.message, phone: senderID });
                mediaUrl = await uploadPDFToCloudinary(bufferOrUrl, safeFilename);
            }
            msgParams.mediaUrl = [mediaUrl];
        } else {
            throw new Error('Unsupported media payload; expected URL or Buffer');
        }

        const message = await client.messages.create(msgParams);
        logger.info('Media sent', { sid: message.sid, phone: senderID });
    } catch (error) {
        logger.error('Failed to send media', { error: error.message, phone: senderID });
        throw error;
    }
};

/**
 * Raw HTTPS POST to Twilio Content API.
 * The Twilio Node SDK v4 does NOT support client.content.v1 — so we call the REST API directly,
 * exactly like the working wa-test.js script does.
 */
function contentApiPost(path, body) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const req = https.request({
            hostname: 'content.twilio.com',
            path: path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': authHeader,
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const j = JSON.parse(data);
                    if (res.statusCode >= 300) reject(new Error(JSON.stringify(j)));
                    else resolve(j);
                } catch (e) { reject(new Error(data)); }
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

/**
 * Get or create a quick-reply content template (cached in memory).
 * Uses direct HTTPS to content.twilio.com/v1/Content (not the SDK).
 * These are for IN-SESSION messages only (within 24hr window).
 */
const getOrCreateQuickReplyTemplate = async (body, buttons) => {
    try {
        if (!client) {
            logger.info('[MOCK] Quick-reply buttons', { buttons: buttons.map(b => b.title) });
            return null;
        }

        // Cache key: body hash + sorted button titles
        const cacheKey = body.substring(0, 40) + '|' + buttons.map(b => b.title).sort().join('|');
        if (templateCache.has(cacheKey)) {
            logger.info('Using cached template', { cacheKey });
            return templateCache.get(cacheKey);
        }

        const friendlyName = 'ek_' + buttons.map(b => b.title.replace(/\s+/g, '_').toLowerCase()).join('_') + '_' + Date.now();

        const actions = buttons.map(btn => ({
            type: 'QUICK_REPLY',
            title: btn.title.substring(0, 20),
            id: btn.id || btn.title.toLowerCase().replace(/\s+/g, '_')
        }));

        const content = await contentApiPost('/v1/Content', {
            friendly_name: friendlyName,
            language: 'en',
            types: {
                'twilio/text': { body },
                'twilio/quick-reply': { body, actions }
            }
        });

        logger.info('Created & cached content template', { sid: content.sid, cacheKey });
        templateCache.set(cacheKey, content.sid);
        return content.sid;
    } catch (error) {
        logger.error('Failed to create content template', { error: error.message });
        return null;
    }
};

/**
 * Send a message using a Content API template SID.
 * Works for both pre-approved templates (outside 24hr) and in-session quick-replies.
 */
const sendContentMessage = async (contentSid, senderID, variables = {}) => {
    try {
        if (!client) {
            logger.info('[MOCK] Content template', { contentSid, phone: senderID, variables });
            return;
        }

        const params = {
            from: fromNumber,
            to: formatPhone(senderID),
            contentSid: contentSid,
        };
        if (Object.keys(variables).length > 0) {
            params.contentVariables = JSON.stringify(variables);
        }

        const message = await client.messages.create(params);
        logger.info('Content message sent', { sid: message.sid, contentSid, phone: senderID });
    } catch (error) {
        logger.error('Failed to send content message', { error: error.message, contentSid, phone: senderID });
    }
};

/**
 * Send a single quick-reply button message.
 * Creates/caches a Content API template, falls back to text.
 */
const sendInteractiveButtonsMessage = async (hTxt, bTxt, btnTxt, senderID) => {
    const body = `*${hTxt}*\n\n${bTxt}`;
    const buttons = [{ title: btnTxt, id: btnTxt.toLowerCase().replace(/\s+/g, '_') }];

    const contentSid = await getOrCreateQuickReplyTemplate(body, buttons);
    if (contentSid) {
        await sendContentMessage(contentSid, senderID);
    } else {
        await sendText(`${body}\n\n👉 Reply *${btnTxt}* to continue`, senderID);
    }
};

/**
 * Send a dual quick-reply button message (Yes/No, etc).
 * Creates/caches a Content API template, falls back to text.
 */
const sendInteractiveDualButtonsMessage = async (hTxt, bTxt, btnTxt1, btnTxt2, senderID) => {
    const body = `*${hTxt}*\n\n${bTxt}`;
    const buttons = [
        { title: btnTxt1, id: btnTxt1.toLowerCase().replace(/\s+/g, '_') },
        { title: btnTxt2, id: btnTxt2.toLowerCase().replace(/\s+/g, '_') }
    ];

    const contentSid = await getOrCreateQuickReplyTemplate(body, buttons);
    if (contentSid) {
        await sendContentMessage(contentSid, senderID);
    } else {
        await sendText(`${body}\n\n1️⃣ *${btnTxt1}*\n2️⃣ *${btnTxt2}*\n\nReply with *${btnTxt1}* or *${btnTxt2}*`, senderID);
    }
};

/**
 * Send a list as quick-reply buttons (max 3) with text fallback.
 */
const sendListInteractive = async (data, body, btnText, senderID) => {
    const buttons = data.slice(0, 3).map(item => ({
        title: (item.title || item).substring(0, 20),
        id: (item.id || item.title || item).toLowerCase().replace(/\s+/g, '_')
    }));

    if (data.length > 3) {
        logger.warn('List truncated to 3 buttons', { total: data.length });
    }

    const contentSid = await getOrCreateQuickReplyTemplate(body, buttons);
    if (contentSid) {
        await sendContentMessage(contentSid, senderID);
    } else {
        let listText = `${body}\n\n`;
        data.forEach((item, i) => { listText += `${i + 1}. ${item.title || item}\n`; });
        listText += `\nReply with the number of your choice`;
        await sendText(listText, senderID);
    }
};

/**
 * Send dynamic interactive buttons (max 3 quick-reply) with text fallback.
 */
const sendDynamicInteractiveMsg = async (data, body, senderID) => {
    const buttons = data.slice(0, 3).map((btn, i) => ({
        title: (btn.text || btn).substring(0, 20),
        id: `option_${i + 1}`
    }));

    const contentSid = await getOrCreateQuickReplyTemplate(body, buttons);
    if (contentSid) {
        await sendContentMessage(contentSid, senderID);
    } else {
        let msg = `${body}\n\n`;
        data.forEach((btn, i) => { msg += `${i + 1}. ${btn.text || btn}\n`; });
        msg += `\nReply with the number of your choice`;
        await sendText(msg, senderID);
    }
};

/**
 * Send a pre-approved template message via contentSid.
 * Works OUTSIDE the 24hr session window (proactive/outbound messages).
 * 
 * @param {number} day - Current day number
 * @param {string} course_name - Course topic name
 * @param {string} template_name - Template key (e.g. 'daily_reminder', 'course_complete')
 * @param {string} senderID - Student phone number
 * @param {string} [studentName] - Student name for personalization
 */
async function sendTemplateMessage(day, course_name, template_name, senderID, studentName) {
    // Map template_name to approved SID
    const templateKey = template_name.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
    const contentSid = APPROVED_TEMPLATES[templateKey] || APPROVED_TEMPLATES.daily_reminder;

    logger.info('Sending template message', { template: templateKey, contentSid, phone: senderID });

    // Build variables based on template type
    let variables = {};
    if (templateKey === 'daily_reminder') {
        variables = { '1': studentName || 'Learner', '2': `Day ${day}`, '3': course_name };
    } else if (templateKey === 'course_feedback' || templateKey === 'course_feedback_v2') {
        variables = { '1': course_name };
    }
    // course_complete and student_registration don't need variables

    await sendContentMessage(contentSid, senderID, variables);
}

/**
 * Send course completion notification using the approved template.
 * Includes quick-reply buttons for next steps.
 */
async function sendCourseCompleteTemplate(senderID, studentName, courseName) {
    logger.info('Sending course completion template', { phone: senderID });
    await sendContentMessage(APPROVED_TEMPLATES.course_complete, senderID);
}

/**
 * Send student registration flow/form.
 */
async function sendRegistrationFlow(senderID) {
    logger.info('Sending registration flow', { phone: senderID });
    await sendContentMessage(APPROVED_TEMPLATES.student_registration, senderID);
}

/**
 * Send course feedback survey.
 */
async function sendFeedbackSurvey(senderID, courseName) {
    logger.info('Sending feedback survey', { phone: senderID, course: courseName });
    await sendContentMessage(APPROVED_TEMPLATES.course_feedback, senderID, { '1': courseName });
}

/**
 * Get recent messages for a phone number from Twilio.
 */
const getMessages = async (senderID, at) => {
    try {
        if (!client) {
            logger.info('[MOCK] getMessages', { phone: senderID });
            return { text: '' };
        }
        const messages = await client.messages.list({ from: formatPhone(senderID), limit: 10 });
        at = Number(at);
        return messages[at] ? { text: messages[at].body } : { text: '' };
    } catch (error) {
        logger.error('Failed to get messages', { error: error.message, phone: senderID });
        return { text: '' };
    }
};

/**
 * Send a file by URL (image, PDF, etc).
 */
const sendFileByUrl = async (url, filename, senderID) => {
    try {
        if (!client) {
            logger.info('[MOCK] File by URL', { phone: senderID, filename, url });
            return;
        }
        const message = await client.messages.create({
            body: filename,
            from: fromNumber,
            to: formatPhone(senderID),
            mediaUrl: [url]
        });
        logger.info('File sent', { sid: message.sid, phone: senderID });
    } catch (error) {
        logger.error('Failed to send file', { error: error.message, phone: senderID });
    }
};

module.exports = {
    sendText,
    sendInteractiveButtonsMessage,
    sendInteractiveDualButtonsMessage,
    sendMedia,
    sendListInteractive,
    sendDynamicInteractiveMsg,
    getMessages,
    sendTemplateMessage,
    sendCourseCompleteTemplate,
    sendRegistrationFlow,
    sendFeedbackSurvey,
    sendFileByUrl,
    sendContentMessage,
    APPROVED_TEMPLATES
};
