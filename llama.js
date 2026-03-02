/**
 * llama.js — Course generation and doubt solving via AWS Bedrock
 * 
 * Dual-model setup:
 *   - Llama 3.2 90B (via cross-region inference profile) for course generation
 *   - Llama 3.2 11B (via cross-region inference profile) for fast Q&A / doubt solving
 * Both support up to 8192 output tokens and 128K context window.
 */

require('dotenv').config();
const { BedrockRuntimeClient, ConverseCommand } = require('@aws-sdk/client-bedrock-runtime');
const Student = require('./models/Student');
const CourseContent = require('./models/CourseContent');
const WA = require('./twilio_whatsapp');
const { createLogger } = require('./utils/logger');
const { ErrorHandler } = require('./middleware/errorHandler');
const { markdownToWhatsApp } = require('./utils/whatsappFormatter');

const logger = createLogger('llama');

// AWS Bedrock client — uses AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY from env
const bedrockClient = new BedrockRuntimeClient({
    region: process.env.AWS_REGION || 'us-east-1'
});

// Course generation — higher quality, used for content creation
const MODEL_GENERATION = process.env.AWS_BEDROCK_MODEL_GENERATION || 'us.meta.llama3-2-90b-instruct-v1:0';
// Q&A / doubt solving — faster, cheaper, used for real-time student interactions
const MODEL_QA = process.env.AWS_BEDROCK_MODEL_QA || 'us.meta.llama3-2-11b-instruct-v1:0';
// Legacy fallback (kept for reference)
const MODEL_ID = process.env.AWS_BEDROCK_MODEL_ID || MODEL_GENERATION;

/**
 * Call AWS Bedrock Converse API.
 * Returns the text content from the model response.
 */
async function callBedrock(systemPrompt, userPrompt, temperature = 0, maxTokens = 2048, modelOverride = null) {
    const modelId = modelOverride || MODEL_GENERATION;
    try {
        const messages = [{ role: 'user', content: [{ text: userPrompt || systemPrompt }] }];
        const system = [{ text: systemPrompt }];

        const command = new ConverseCommand({
            modelId,
            messages: userPrompt ? messages : [{ role: 'user', content: [{ text: systemPrompt }] }],
            system: userPrompt ? system : undefined,
            inferenceConfig: { temperature, maxTokens }
        });

        // 90-second timeout to prevent hanging
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 90000);
        try {
            const response = await bedrockClient.send(command, { abortSignal: ac.signal });
            const text = response.output?.message?.content?.[0]?.text || '';
            return text;
        } finally {
            clearTimeout(timer);
        }
    } catch (error) {
        logger.error('Bedrock API call failed', error, { model: modelId });
        throw error;
    }
}

const DAY_THEMES = {
    1: 'Fundamentals — introduce the topic, core definitions, and foundational concepts',
    2: 'Intermediate — deeper techniques, common patterns, and practical examples',
    3: 'Application & Synthesis — real-world use cases, best practices, and a mini project or reflection'
};

/**
 * Build a prompt for generating ONE day of course content.
 * We generate day-by-day for structured, focused output per day.
 */
function buildDayPrompt(topic, language, style, goal, dayNum) {
    const lang = language || 'English';
    const sty = style || 'Casual';
    const gol = goal || `Learn the fundamentals of ${topic}`;
    const theme = DAY_THEMES[dayNum] || DAY_THEMES[1];

    return [
        `<TASK>Create Day ${dayNum} of a 3-day WhatsApp micro-course.</TASK>`,
        ``,
        `<COURSE_INFO>`,
        `  Topic: ${topic}`,
        `  Language: ${lang}`,
        `  Teaching Style: ${sty}`,
        `  Student Goal: ${gol}`,
        `  Day ${dayNum} theme: ${theme}`,
        `</COURSE_INFO>`,
        ``,
        `<RULES>`,
        `1. Generate exactly 3 modules for Day ${dayNum}.`,
        `2. Each module: 8-10 sentences. Start with a hook, cover one concept, end with a task or question.`,
        `3. Writing style: ${sty}. Clear, simple language for mobile reading.`,
        `4. Language: Write ALL content in ${lang}.`,
        `5. Include 1-2 relevant emojis per module.`,
        `6. Use literal \\n for newlines inside JSON strings.`,
        `7. Format for WhatsApp: use *bold* (single asterisk), _italic_ (single underscore), • for bullets. Do NOT use markdown **bold**, ## headers, or - bullets.`,
        `</RULES>`,
        ``,
        `<OUTPUT_FORMAT>`,
        `Return ONLY a valid JSON object (no markdown, no explanation, no code fences):`,
        `{`,
        `  "module1": { "content": "..." },`,
        `  "module2": { "content": "..." },`,
        `  "module3": { "content": "..." }`,
        `}`,
        `</OUTPUT_FORMAT>`
    ].join('\n');
}

/**
 * Parse LLM response text into JSON, handling markdown code blocks.
 */
function parseLLMJson(text) {
    try {
        // Strip markdown code fences and leading 'json' tag
        let cleaned = text.replaceAll('```', '').trim();
        cleaned = cleaned.replace(/^json\s*/i, '').trim();
        // If the model wrapped output in extra text, extract the JSON object
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
            cleaned = cleaned.substring(firstBrace, lastBrace + 1);
        }
        return JSON.parse(cleaned);
    } catch (error) {
        logger.error('Failed to parse LLM JSON', { raw: text.substring(0, 300), error: error.message });
        return null;
    }
}

/**
 * Validate that a single-day LLM output has the expected structure:
 * 3 modules, each with non-empty content string (>= 50 chars).
 */
function validateDayJson(data) {
    if (!data || typeof data !== 'object') return false;
    for (let m = 1; m <= 3; m++) {
        const mod = data[`module${m}`];
        if (!mod || typeof mod.content !== 'string' || mod.content.trim().length < 50) return false;
    }
    return true;
}

/**
 * Generate all 3 days by calling Bedrock once per day.
 * Returns the combined courseData object { day1: {...}, day2: {...}, day3: {...} }.
 * Throws on failure after retries.
 */
async function generateAllDays(topic, language, style, goal, phone) {
    const courseData = {};

    for (let dayNum = 1; dayNum <= 3; dayNum++) {
        const prompt = buildDayPrompt(topic, language, style, goal, dayNum);
        logger.info(`Generating Day ${dayNum}/3`, { phone, topic, model: MODEL_GENERATION });

        const dayData = await ErrorHandler.withRetry(async () => {
            const responseText = await callBedrock(
                prompt,
                `Generate Day ${dayNum} now. Return ONLY valid JSON, no other text.`,
                0,
                4096,
                MODEL_GENERATION
            );
            if (!responseText) throw new Error(`Empty response from Bedrock (Day ${dayNum})`);
            const parsed = parseLLMJson(responseText);
            if (!parsed) throw new Error(`Failed to parse JSON (Day ${dayNum})`);
            if (!validateDayJson(parsed)) {
                logger.warn(`Day ${dayNum} validation failed`, { phone });
                throw new Error(`Day ${dayNum} JSON invalid (missing modules or short content)`);
            }
            return parsed;
        }, 2, 3000, 2);

        courseData[`day${dayNum}`] = dayData;
    }

    return courseData;
}

/**
 * Get all students with courseStatus = 'Approved'
 */
const getApprovedRecords = async () => {
    try {
        const students = await Student.find({ courseStatus: 'Approved' }).lean();
        return students;
    } catch (error) {
        logger.error("Failed getting approved data", error);
        return [];
    }
};

/**
 * Insert course content records into MongoDB
 * Original: Airtable SDK create records in dynamic table
 * 
 * courseData format from LLM:
 * { day1: { module1: { content: "..." }, module2: {...}, module3: {...} }, day2: {...}, day3: {...} }
 */
async function updateCourseRecords(studentPhone, topic, courseData) {
    try {
        let dayNo = 1;
        const records = [];

        for (const [day, modules] of Object.entries(courseData)) {
            const moduleContents = [
                modules.module1?.content || "",
                modules.module2?.content || "",
                modules.module3?.content || ""
            ];

            records.push({
                studentPhone,
                topic,
                day: dayNo++,
                modules: moduleContents.map(text => ({
                    text,
                    listTitle: '',
                    list: [],
                    interactiveBody: '',
                    interactiveButtons: [],
                    question: '',
                    answer: '',
                    files: []
                }))
            });
        }

        await CourseContent.insertMany(records);
        logger.info('Course records created', { studentPhone, topic, days: records.length });
    } catch (error) {
        logger.error('Failed to create course records', error);
        throw error;
    }
}

/**
 * Update student status after course generation
 * Original: Airtable SDK select + update
 */
async function cleanUpStudentTable(phoneNumber, status = "Content Created") {
    try {
        const update = { courseStatus: status };
        // When course is created, make the student deliverable + set flow state
        if (status === 'Content Created') {
            update.progress = 'Pending';
            update.flowStep = 'awaiting_start';
        }
        await Student.findOneAndUpdate(
            { phone: phoneNumber, courseStatus: 'Approved' },
            update
        );
        logger.info('Student status updated', { phone: phoneNumber, status, progress: update.progress });
    } catch (error) {
        logger.error('Failed to update student status', error);
    }
}

/**
 * Generate course content using AWS Bedrock for all approved students
 * Called by course_approval() on GET /ping
 */
const generateCourse = async () => {
    const approvedRecords = await getApprovedRecords();
    logger.info('Running AI Engine...', { approvedCount: approvedRecords.length });

    if (approvedRecords.length > 0) {
        for (const record of approvedRecords) {
            const { phone: Phone, topic: Topic, name: Name, goal: Goal, style: Style, language: Language, nextDay: NextDay } = record;

            try {
                logger.info('Generating course via AWS Bedrock (day-by-day)', { phone: Phone, topic: Topic, model: MODEL_GENERATION });

                const courseData = await generateAllDays(Topic, Language, Style, Goal, Phone);

                // Delete old content AFTER successful generation (safe order)
                await CourseContent.deleteMany({ studentPhone: Phone, topic: Topic });
                await updateCourseRecords(Phone, Topic, courseData);
                await cleanUpStudentTable(Phone);

                logger.info('Sending course notification', { phone: Phone, topic: Topic });
                await WA.sendTemplateMessage(NextDay, Topic, 'daily_reminder', Phone, Name);
            } catch (error) {
                logger.error('Failed to create course', error, { phone: Phone, topic: Topic });
                await cleanUpStudentTable(Phone, 'Failed');
            }
        }
    } else {
        logger.info('No approved records found');
    }
};

/**
 * Solve a user's doubt query using AWS Bedrock
 */
const solveUserQuery = async (prompt, waId) => {
    try {
        // Fetch student context so the AI knows what topic/day they're studying
        const student = await Student.findOne({ phone: waId }).lean();
        const topicCtx = student?.topic ? ` The student is currently learning "${student.topic}" (Day ${student.nextDay || 1}).` : '';
        const systemPrompt = `You are a helpful teaching assistant for the ekatra micro-learning platform. Give a short, crisp, and correct answer to the student's question.${topicCtx} Keep your answer concise and suitable for WhatsApp (under 300 words). If the query is not genuine or malicious then respond that this query violates the Ekatra guidelines.`;

        logger.info('Solving user query via AWS Bedrock', { phone: waId, model: MODEL_QA });
        const responseText = await callBedrock(systemPrompt, prompt, 0, 1024, MODEL_QA);

        if (responseText) {
            const cleaned = markdownToWhatsApp(responseText.replaceAll('```', '').trim());
            WA.sendText(`💡 *Here's what I found:*\n\n${cleaned}`, waId);
            logger.info('Query answered', { phone: waId });
        }
    } catch (error) {
        logger.error('Failed to solve user query', error, { phone: waId });
        WA.sendText('Sorry, I couldn\'t process your query right now. Please try again.', waId);
    }
};

/**
 * Generate course for a SINGLE student by phone number.
 * Called from the onboarding flow when user picks "Generate Course".
 * Returns true on success, false on failure.
 */
const generateForStudent = async (phoneNumber) => {
    const student = await Student.findOne({ phone: phoneNumber });
    if (!student) {
        logger.error('Student not found for generation', { phone: phoneNumber });
        return false;
    }

    const { phone: Phone, topic: Topic, name: Name, goal: Goal, style: Style, language: Language } = student;

    try {
        logger.info('Generating course for student via Bedrock (day-by-day)', { phone: Phone, topic: Topic, model: MODEL_GENERATION });

        const courseData = await generateAllDays(Topic, Language, Style, Goal, Phone);

        // SUCCESS — delete old content THEN insert new (safe order)
        await CourseContent.deleteMany({ studentPhone: Phone, topic: Topic });
        await updateCourseRecords(Phone, Topic, courseData);
        await Student.findOneAndUpdate({ phone: Phone }, {
            courseStatus: 'Content Created', progress: 'Pending', flowStep: 'awaiting_start',
            nextDay: 1, nextModule: 1, dayCompleted: 0, moduleCompleted: 0
        });
        logger.info('Course generated for student', { phone: Phone, topic: Topic });
        return true;
    } catch (error) {
        logger.error('Failed to generate course for student', error, { phone: Phone });
        await Student.findOneAndUpdate({ phone: Phone }, { courseStatus: 'Failed', flowStep: 'alfred_topic' });
        return false;
    }
};

module.exports = { generateCourse, generateForStudent, solveUserQuery };
