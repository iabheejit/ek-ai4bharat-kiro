const mongoose = require('mongoose');

const certificateSchema = new mongoose.Schema({
    url: {
        type: String,
        default: ''
    },
    objectKey: {
        type: String,
        default: ''
    },
    bucket: {
        type: String,
        default: ''
    },
    provider: {
        type: String,
        default: ''
    },
    courseName: {
        type: String,
        default: ''
    },
    recipientName: {
        type: String,
        default: ''
    },
    generatedAt: {
        type: Date,
        default: null
    }
}, { _id: false });

const studentSchema = new mongoose.Schema({
    phone: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    name: {
        type: String,
        default: ''
    },
    topic: {
        type: String,
        default: ''
    },
    courseStatus: {
        type: String,
        enum: ['Pending Approval', 'Approved', 'Content Created', 'Failed', ''],
        default: ''
    },
    progress: {
        type: String,
        enum: ['In Progress', 'Pending', 'Completed', ''],
        default: 'In Progress'
    },
    nextDay: {
        type: Number,
        default: 1
    },
    dayCompleted: {
        type: Number,
        default: 0
    },
    nextModule: {
        type: Number,
        default: 1
    },
    moduleCompleted: {
        type: Number,
        default: 0
    },
    goal: {
        type: String,
        default: ''
    },
    style: {
        type: String,
        default: ''
    },
    language: {
        type: String,
        default: 'English'
    },
    lastMsg: {
        type: String,
        default: ''
    },
    responses: {
        type: String,
        default: ''
    },
    questionResponses: {
        type: String,
        default: ''
    },
    doubt: {
        type: Number,
        default: 0
    },
    dayCompletedAt: {
        type: Date,
        default: null
    },
    flowStep: {
        type: String,
        enum: [
            // ─── Onboarding flow ───
            'new_user',                // First message — send welcome
            'onboarding_welcome',      // Sent welcome, awaiting "Yes, Let's do this!"
            'onboarding_learn',        // Sent intro, awaiting "Learn with ekatra"
            'onboarding_topic',        // Sent topic list, awaiting pick
            // ─── Alfred AI generation flow ───
            'alfred_intro',            // Sent Alfred intro, awaiting "Yes, Tell me!"
            'alfred_topic',            // Asked for topic, awaiting user input
            'alfred_goal',             // Asked for learning goal, awaiting input
            'alfred_style',            // Asked for learning style, awaiting pick
            'alfred_language',         // Asked for language, awaiting pick
            'alfred_name',             // Asked for name confirmation, awaiting input
            'alfred_generating',       // AI is generating course
            // ─── Course delivery flow ───
            'idle',                    // Has a course, no active conversation
            'awaiting_start',          // Waiting for "Start Day"
            'awaiting_next_day',       // Day complete, locked until next calendar day (cron unlocks)
            'awaiting_next',           // Module delivered, waiting for "Next"
            'awaiting_doubt_answer',   // Day complete, "Any doubts? Yes/No"
            'doubt_mode',              // Waiting for doubt question
            'course_complete'          // All modules done
        ],
        default: 'new_user'
    },
    lastInteractionAt: {
        type: Date,
        default: Date.now
    },
    source: {
        type: String,
        default: ''
    },
    course: {
        type: String,
        default: ''
    },
    certificate: {
        type: certificateSchema,
        default: null
    }
}, {
    timestamps: true
});

// Compound index for common query pattern
studentSchema.index({ phone: 1, courseStatus: 1, progress: 1 });
studentSchema.index({ courseStatus: 1, progress: 1 });

module.exports = mongoose.model('Student', studentSchema);
