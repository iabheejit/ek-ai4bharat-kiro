require('dotenv').config();
const getStream = require('get-stream');
const PDFDocument = require('pdfkit');
const { PassThrough } = require('stream');
const path = require('path');
const fs = require('fs');

async function createCertificate(name, course_name) {
    try {
        console.log("Creating certificate for ", name, course_name);

        const doc = new PDFDocument({
            layout: 'landscape',
            size: 'A4',
        });

        const stream = new PassThrough();
        doc.pipe(stream);

        const W = doc.page.width;
        const H = doc.page.height;

        // ─── Background ───
        doc.rect(0, 0, W, H).fill('#fff');

        // ─── Border decoration (replaces corners.png) ───
        const borderColor = '#125951';
        doc.lineWidth(4).rect(20, 20, W - 40, H - 40).stroke(borderColor);
        doc.lineWidth(1.5).rect(30, 30, W - 60, H - 60).stroke(borderColor);

        // Corner accents
        const cornerSize = 40;
        [[35, 35], [W - 35, 35], [35, H - 35], [W - 35, H - 35]].forEach(([x, y]) => {
            doc.save();
            doc.circle(x, y, 6).fill(borderColor);
            doc.restore();
        });

        // ─── Try custom fonts, fall back to built-in ───
        const hasCustomFonts = fs.existsSync(path.join(__dirname, 'fonts', 'RozhaOne-Regular.ttf'));
        
        if (hasCustomFonts) {
            const fontPath = path.join(__dirname, 'fonts', 'RozhaOne-Regular.ttf');
            const rufinaFontPath = path.join(__dirname, 'fonts', 'Rufina-Regular.ttf');
            const pinyonFontPath = path.join(__dirname, 'fonts', 'Pinyon Script 400.ttf');

            doc.font(fontPath).fontSize(60).fill('#292929').text('CERTIFICATE', 80, 50, { align: 'center' });
            doc.font(fontPath).fontSize(35).fill('#292929').text('OF COMPLETION', 100, 125, { align: 'center' });
            doc.font(rufinaFontPath).fontSize(23).fill(borderColor).text('This certificate is awarded to', 100, 200, { align: 'center' });
            doc.font(pinyonFontPath).fontSize(65).fill(borderColor).text(`${name}`, 0, 255, { align: 'center' });
            doc.font(rufinaFontPath).fontSize(25).fill('#292929').text('For Completing The Topic on ' + course_name, 140, 360, { align: 'center' });
            doc.font(rufinaFontPath).fontSize(20).fill('#292929').text('Abhijeet K.', 490, 460, { align: 'center' });
            doc.font(rufinaFontPath).fontSize(20).fill('#292929').text('Founder, Ekatra', 490, 497, { align: 'center' });
        } else {
            // Built-in fonts fallback
            doc.font('Helvetica-Bold').fontSize(52).fill('#292929').text('CERTIFICATE', 80, 55, { align: 'center' });
            doc.font('Helvetica-Bold').fontSize(28).fill('#292929').text('OF COMPLETION', 100, 120, { align: 'center' });
            doc.font('Helvetica').fontSize(20).fill(borderColor).text('This certificate is awarded to', 100, 200, { align: 'center' });
            doc.font('Helvetica-BoldOblique').fontSize(48).fill(borderColor).text(`${name}`, 0, 255, { align: 'center' });
            doc.font('Helvetica').fontSize(22).fill('#292929').text('For Completing The Topic on ' + course_name, 140, 360, { align: 'center' });
            doc.font('Helvetica').fontSize(18).fill('#292929').text('Abhijeet K.', 490, 460, { align: 'center' });
            doc.font('Helvetica').fontSize(18).fill('#292929').text('Founder, Ekatra', 490, 497, { align: 'center' });
        }

        // ─── Decorative line under name ───
        doc.lineWidth(2).moveTo(200, 330).lineTo(W - 200, 330).stroke(borderColor);

        // ─── Try optional images, skip if missing ───
        const ekatraLogoPath = path.join(__dirname, 'assets', 'ekatra logo.png');
        if (fs.existsSync(ekatraLogoPath)) {
            doc.image(ekatraLogoPath, W - 120, H - 110, { fit: [75, 75] });
        }

        const signPath = path.join(__dirname, 'assets', 'Sign.png');
        if (fs.existsSync(signPath)) {
            doc.image(signPath, 560, 405, { fit: [120, 120] });
        }

        // ─── Signature line ───
        doc.lineWidth(1.5).moveTo(560, 490).lineTo(690, 490).stroke(borderColor);

        // ─── Date ───
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        doc.font('Helvetica').fontSize(14).fill('#666').text(today, 60, H - 70, { align: 'left' });

        doc.end();

        const pdfBuffer = await getStream.buffer(stream);
        console.log("Certificate created! Returning the buffer.");
        return pdfBuffer;
    } catch (error) {
        console.error("Error in creating certificate", error);
        throw error;
    }
}

module.exports = { createCertificate };