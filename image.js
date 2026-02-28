/**
 * image.js — Media file handling
 * 
 * Migrated from Airtable SDK to Mongoose.
 * WATI sendMedia replaced with Twilio.
 */

require('dotenv').config();
const WA = require('./twilio_whatsapp');
const Student = require('./models/Student');
const CourseContent = require('./models/CourseContent');
const { createLogger } = require('./utils/logger');

const logger = createLogger('image');

/**
 * Send all media files for a given module
 * Original: Airtable SDK query for Module N File attachment field
 */
async function sendMediaFile(cDay, cModule, number) {
    try {
        const student = await Student.findOne({ phone: number }).select('topic');
        if (!student) {
            logger.warn('No student found for media', { phone: number });
            return;
        }

        const content = await CourseContent.findOne({
            studentPhone: number,
            topic: student.topic,
            day: cDay
        });

        if (!content || !content.modules[cModule - 1]) {
            logger.info('No content found for media', { phone: number, day: cDay, module: cModule });
            return;
        }

        const files = content.modules[cModule - 1].files;
        if (files && files.length > 0) {
            logger.info('Sending media files', { phone: number, count: files.length });
            for (const file of files) {
                await WA.sendFileByUrl(file.url, file.filename, number);
            }
        } else {
            logger.info("No media in this module");
        }
    } catch (error) {
        logger.error('Error sending media files', error);
    }
}

/**
 * Send a specific media file by index
 * Original: Same as sendMediaFile but only sends file at given index
 */
async function sendMediaFile_v2(index, cDay, cModule, number) {
    try {
        const student = await Student.findOne({ phone: number }).select('topic');
        if (!student) return;

        const content = await CourseContent.findOne({
            studentPhone: number,
            topic: student.topic,
            day: cDay
        });

        if (!content || !content.modules[cModule - 1]) return;

        const files = content.modules[cModule - 1].files;
        if (files && files[index]) {
            logger.info('Sending media file', { phone: number, index, filename: files[index].filename });
            await WA.sendFileByUrl(files[index].url, files[index].filename, number);
        } else {
            logger.info("No media at index", { index });
        }
    } catch (error) {
        logger.error('Error sending media file v2', error);
    }
}

module.exports = { sendMediaFile, sendMediaFile_v2 };
