/**
 * llama.js — Course generation and doubt solving via AWS Bedrock
 * 
 * Uses AWS Bedrock Runtime with Meta Llama 3 (or any Bedrock model).
 * OpenAI-compatible messages format via Bedrock's Converse API.
 */

require('dotenv').config();
const { BedrockRuntimeClient, ConverseCommand } = require('@aws-sdk/client-bedrock-runtime');
const Student = require('./models/Student');
const CourseContent = require('./models/CourseContent');
const WA = require('./twilio_whatsapp');
const { createLogger } = require('./utils/logger');

const logger = createLogger('llama');

// AWS Bedrock client — uses AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY from env
const bedrockClient = new BedrockRuntimeClient({
    region: process.env.AWS_REGION || 'us-east-1'
});

const MODEL_ID = process.env.AWS_BEDROCK_MODEL_ID || 'meta.llama3-70b-instruct-v1:0';

/**
 * Call AWS Bedrock Converse API.
 * Returns the text content from the model response.
 */
async function callBedrock(systemPrompt, userPrompt, temperature = 0) {
    try {
        const messages = [{ role: 'user', content: [{ text: userPrompt || systemPrompt }] }];
        const system = [{ text: systemPrompt }];

        const command = new ConverseCommand({
            modelId: MODEL_ID,
            messages: userPrompt ? messages : [{ role: 'user', content: [{ text: systemPrompt }] }],
            system: userPrompt ? system : undefined,
            inferenceConfig: { temperature, maxTokens: 4096 }
        });

        const response = await bedrockClient.send(command);
        const text = response.output?.message?.content?.[0]?.text || '';
        return text;
    } catch (error) {
        logger.error('Bedrock API call failed', { error: error.message, model: MODEL_ID });
        throw error;
    }
}

/**
 * Build the course generation prompt.
 */
function buildCoursePrompt(topic, language, style, goal) {
    return `Create a 3-day micro-course on ${topic} in ${language || 'English'} using teaching style of ${style || 'Interactive'}, delivered via WhatsApp. The student's goal is: ${goal || topic}. Strict Guidelines: Structure: 3 days, 3 modules per day (total of 9 modules). Content: Each module must contain engaging and informative content, with a minimum of 10 sentences. Module Length: Ensure that each module is between 10 to 12 sentences, providing comprehensive insights while remaining concise. Style: Use a professional teaching style that encourages learning and engagement. Language: All content must be in ${language || 'English'}. Engagement: Incorporate 1-2 relevant emojis in each module to enhance engagement. Formatting: Use '\\n' for new lines in the JSON format. Content Approach: Start each module with a hook or key point. Focus on one core concept or skill per module. Use clear, simple language suitable for mobile reading. Include a brief actionable task or reflection question at the end of each module. Output Format: Provide the micro-course in JSON format as follows:{ "day1": { "module1": { "content": "..." }, "module2": { "content": "..." }, "module3": { "content": "..." } }, "day2": { "module1": { "content": "..." }, "module2": { "content": "..." }, "module3": { "content": "..." } }, "day3": { "module1": { "content": "..." }, "module2": { "content": "..." }, "module3": { "content": "..." } } } Return ONLY valid JSON, no other text.`;
}

/**
 * Parse LLM response text into JSON, handling markdown code blocks.
 */
function parseLLMJson(text) {
    try {
        let cleaned = text.replaceAll('```', '').trim();
        cleaned = cleaned.replace(/^json\s*/i, '').trim();
        return JSON.parse(cleaned);
    } catch (error) {
        logger.error('Failed to parse LLM JSON', { raw: text.substring(0, 200), error: error.message });
        return null;
    }
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
                const prompt = buildCoursePrompt(Topic, Language, Style, Goal);

                logger.info('Generating course via AWS Bedrock', { phone: Phone, topic: Topic, model: MODEL_ID });
                const responseText = await callBedrock(prompt, 'Generate the course now. Return ONLY valid JSON, no other text.');

                if (responseText) {
                    logger.info('Course generated successfully');
                    const courseData = parseLLMJson(responseText);
                    if (!courseData) {
                        await cleanUpStudentTable(Phone, 'Failed');
                        continue;
                    }

                    await updateCourseRecords(Phone, Topic, courseData);
                    await cleanUpStudentTable(Phone);

                    logger.info('Sending course notification', { phone: Phone, topic: Topic });
                    await WA.sendTemplateMessage(NextDay, Topic, 'daily_reminder', Phone, Name);
                } else {
                    logger.warn('Failed to generate course — no content in response');
                    await cleanUpStudentTable(Phone, 'Failed');
                }
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
        const systemPrompt = 'You are a doubt solver. Give a short, crisp, and correct answer to this query. If the query is not genuine or malicious then respond that this query violates the Ekatra guidelines.';

        logger.info('Solving user query via AWS Bedrock', { phone: waId });
        const responseText = await callBedrock(systemPrompt, prompt);

        if (responseText) {
            const cleaned = responseText.replaceAll('```', '').trim();
            WA.sendText(cleaned, waId);
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
        const prompt = buildCoursePrompt(Topic, Language, Style, Goal);

        logger.info('Generating course for student via Bedrock', { phone: Phone, topic: Topic, model: MODEL_ID });
        const responseText = await callBedrock(prompt, 'Generate the course now. Return ONLY valid JSON, no other text.');

        if (responseText) {
            const courseData = parseLLMJson(responseText);
            if (!courseData) {
                await Student.findOneAndUpdate({ phone: Phone }, { courseStatus: 'Failed', flowStep: 'alfred_topic' });
                return false;
            }

            await CourseContent.deleteMany({ studentPhone: Phone, topic: Topic });
            await updateCourseRecords(Phone, Topic, courseData);
            await Student.findOneAndUpdate({ phone: Phone }, {
                courseStatus: 'Content Created', progress: 'Pending', flowStep: 'awaiting_start',
                nextDay: 1, nextModule: 1, dayCompleted: 0, moduleCompleted: 0
            });
            logger.info('Course generated for student', { phone: Phone, topic: Topic });
            return true;
        } else {
            await Student.findOneAndUpdate({ phone: Phone }, { courseStatus: 'Failed', flowStep: 'alfred_topic' });
            return false;
        }
    } catch (error) {
        logger.error('Failed to generate course for student', { error: error.message, phone: Phone });
        await Student.findOneAndUpdate({ phone: Phone }, { courseStatus: 'Failed', flowStep: 'alfred_topic' });
        return false;
    }
};

module.exports = { generateCourse, generateForStudent, solveUserQuery };
