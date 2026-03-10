/**
 * course_status.js — Course approval and status checking
 * 
 * Migrated from Airtable REST API to Mongoose.
 * Dead imports (./OpenAI, ./index) removed.
 */

require('dotenv').config();
const Student = require('./models/Student');
const { createLogger } = require('./utils/logger');

const logger = createLogger('course-status');

/**
 * Find students with 'Approved' or 'Failed' course status
 * Original: GET with complex URL-encoded Airtable formula
 * Returns array of student-like objects for compatibility
 */
async function find_course_to_create() {
    try {
        const students = await Student.find({
            courseStatus: { $in: ['Approved', 'Failed'] }
        })
        .select('phone topic courseStatus name language goal style')
        .sort({ createdAt: 1 })
        .limit(1)
        .lean();

        // Return in Airtable-compatible format
        return students.map(s => ({
            id: s._id,
            fields: {
                Phone: s.phone,
                Topic: s.topic,
                'Course Status': s.courseStatus,
                Name: s.name,
                Language: s.language,
                Goal: s.goal,
                Style: s.style
            }
        }));
    } catch (error) {
        logger.error('Error finding courses to create', error);
        return null;
    }
}

/**
 * Trigger course generation
 * Original: called openaiModule.generateCourse() (via ./OpenAI)
 * Now calls llama.generateCourse() directly
 */
async function course_approval() {
    try {
        // Import here to avoid circular dependency
        const { generateCourse } = require('./llama');
        await generateCourse();
    } catch (error) {
        logger.error("Error generating course", error);
    }
}

module.exports = {
    find_course_to_create,
    course_approval
};
