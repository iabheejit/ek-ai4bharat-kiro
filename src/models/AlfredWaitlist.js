const mongoose = require('mongoose');

const alfredWaitlistSchema = new mongoose.Schema({
    phone: {
        type: String,
        required: true,
        index: true
    },
    topic: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('AlfredWaitlist', alfredWaitlistSchema);
