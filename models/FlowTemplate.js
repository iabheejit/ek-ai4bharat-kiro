const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    text: { type: String, required: true },
    type: { type: String, enum: ['text', 'interactive', 'dual_interactive', 'dynamic_interactive', 'template'], default: 'text' },
    delay: { type: Number, default: 1500 },
    buttons: [{ type: String }],
    header: { type: String, default: '' },
    mediaUrl: { type: String, default: '' }
}, { _id: false });

const flowTemplateSchema = new mongoose.Schema({
    stepName: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    displayName: {
        type: String,
        required: true
    },
    category: {
        type: String,
        enum: ['onboarding', 'alfred', 'delivery', 'global', 'doubt'],
        required: true
    },
    order: {
        type: Number,
        default: 0
    },
    messages: {
        type: [messageSchema],
        default: []
    },
    variables: {
        type: [String],
        default: []
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('FlowTemplate', flowTemplateSchema);
