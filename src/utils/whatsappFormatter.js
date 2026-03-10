/**
 * whatsappFormatter.js — Convert markdown/LLM output to WhatsApp-native formatting.
 *
 * WhatsApp formatting reference:
 *   *bold*      _italic_      ~strikethrough~      ```monospace```
 *
 * Common LLM/markdown patterns we need to convert:
 *   **bold** or __bold__  →  *bold*
 *   _italic_ (already correct)
 *   ## Header  →  *Header*  (bold, since WhatsApp has no headers)
 *   - item / * item  →  • item
 *   1. item  →  1. item (keep as is)
 *   ```code```  →  ```code```  (keep — WhatsApp supports this)
 *   [text](url)  →  text (url)
 */

/**
 * Convert markdown-style text to WhatsApp-native formatting.
 * Safe to call on text that is already WhatsApp-formatted.
 * @param {string} text
 * @returns {string}
 */
function markdownToWhatsApp(text) {
    if (!text || typeof text !== 'string') return text || '';

    let result = text;

    // 1. Protect existing code blocks (``` ... ```) — replace with placeholders
    const codeBlocks = [];
    result = result.replace(/```[\s\S]*?```/g, (match) => {
        codeBlocks.push(match);
        return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
    });

    // 2. Convert markdown headers (## Header → *Header*)
    //    Handle ### h3, ## h2, # h1 — all become bold in WhatsApp
    result = result.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

    // 3. Convert **bold** → *bold* (markdown double-star to WhatsApp single-star)
    //    Be careful not to double-convert if already single-star
    result = result.replace(/\*\*(.+?)\*\*/g, '*$1*');

    // 4. Convert __bold__ → *bold* (markdown double-underscore bold)
    result = result.replace(/__(.+?)__/g, '*$1*');

    // 5. Convert unordered list markers: "- item" or "* item" → "• item"
    //    Only at start of line, and only "* " (with space) to avoid hitting existing *bold*
    result = result.replace(/^[\-]\s+/gm, '• ');
    result = result.replace(/^\*\s+(?!\*)/gm, '• ');

    // 6. Convert markdown links: [text](url) → text (url)
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');

    // 7. Clean up excessive blank lines (3+ → 2)
    result = result.replace(/\n{3,}/g, '\n\n');

    // 8. Fix double-bold from conversions (****text**** → *text*)
    result = result.replace(/\*{2,}([^*]+)\*{2,}/g, '*$1*');

    // 9. Restore code blocks
    codeBlocks.forEach((block, i) => {
        result = result.replace(`__CODE_BLOCK_${i}__`, block);
    });

    return result.trim();
}

module.exports = { markdownToWhatsApp };
