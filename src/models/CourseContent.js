const mongoose = require('mongoose');

const moduleSchema = new mongoose.Schema({
    text: { type: String, default: '' },
    listTitle: { type: String, default: '' },
    list: [{ type: String }],
    interactiveBody: { type: String, default: '' },
    interactiveButtons: [{ type: String }],
    question: { type: String, default: '' },
    answer: { type: String, default: '' },
    files: [{
        filename: String,
        url: String
    }]
}, { _id: false });

const courseContentSchema = new mongoose.Schema({
    studentPhone: {
        type: String,
        required: true,
        index: true
    },
    topic: {
        type: String,
        required: true
    },
    day: {
        type: Number,
        required: true
    },
    isTemplate: {
        type: Boolean,
        default: false,
        index: true
    },
    modules: {
        type: [moduleSchema],
        default: () => [{}, {}, {}] // 3 modules per day
    }
}, {
    timestamps: true
});

// Compound index for primary lookup pattern
courseContentSchema.index({ studentPhone: 1, topic: 1, day: 1 }, { unique: true });

module.exports = mongoose.model('CourseContent', courseContentSchema);
