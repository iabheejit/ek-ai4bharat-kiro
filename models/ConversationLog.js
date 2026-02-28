const mongoose = require('mongoose');

/**
 * ConversationLog — append-only audit trail for every state transition.
 * 
 * Query examples:
 *   - Full journey: ConversationLog.find({ studentPhone: '919766072308' }).sort({ timestamp: 1 })
 *   - Funnel:       ConversationLog.countDocuments({ toStep: 'course_complete' })
 *   - Drop-offs:    ConversationLog.aggregate([{ $group: { _id: '$toStep', count: { $sum: 1 } } }])
 */
const conversationLogSchema = new mongoose.Schema({
    studentPhone: {
        type: String,
        required: true,
        index: true
    },
    fromStep: {
        type: String,
        required: true
    },
    toStep: {
        type: String,
        required: true
    },
    trigger: {
        type: String,       // e.g. "button:Start Day", "text:hi", "button:Yes", "cron:daily_reminder"
        required: true
    },
    day: Number,            // Current day at time of transition
    module: Number,         // Current module at time of transition
    userMessage: String,    // What the user sent (truncated)
    botMessages: [{         // What the bot sent back
        type: { type: String },  // 'text', 'button', 'template', 'media'
        body: String,            // Message content (truncated)
        sid: String              // Twilio message SID
    }],
    metadata: {
        type: mongoose.Schema.Types.Mixed,  // Any extra context
        default: {}
    },
    timestamp: {
        type: Date,
        default: Date.now,
        index: true
    }
}, {
    timestamps: false  // We use our own timestamp field
});

// Compound index for per-student timeline queries
conversationLogSchema.index({ studentPhone: 1, timestamp: 1 });

module.exports = mongoose.model('ConversationLog', conversationLogSchema);
