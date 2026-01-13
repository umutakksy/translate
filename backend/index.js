const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const Groq = require('groq-sdk');
const cors = require('cors');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

process.on('uncaughtException', (err) => {
    fs.appendFileSync('error.log', `UNCAUGHT EXCEPTION: ${err.message}\n${err.stack}\n`);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    fs.appendFileSync('error.log', `UNHANDLED REJECTION: ${reason}\n`);
});


const upload = multer({ dest: 'uploads/' });

// Simple status tracking
const jobs = {};

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

function cleanText(text) {
    if (!text) return "";
    const charMap = {
        'ı': 'i', 'İ': 'I', 'ğ': 'g', 'Ğ': 'G', 'ü': 'u', 'Ü': 'U',
        'ş': 's', 'Ş': 'S', 'ö': 'o', 'Ö': 'O', 'ç': 'c', 'Ç': 'C',
        '“': '"', '”': '"', '‘': "'", '’': "'", '–': '-', '—': '-',
        '…': '...', '™': '(TM)', '©': '(C)', '®': '(R)'
    };
    return text.split('').map(char => charMap[char] || (char.charCodeAt(0) > 127 ? '?' : char)).join('');
}

// Serve static files from the React frontend app
const frontendPath = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendPath));

app.post('/api/translate', upload.single('file'), async (req, res) => {
    const jobId = req.body.jobId || Date.now().toString();
    jobs[jobId] = { status: 'starting', message: 'Initializing...' };

    try {
        if (!req.file) {
            jobs[jobId] = { status: 'error', message: 'No file uploaded.' };
            return res.status(400).send('No file uploaded.');
        }

        const targetLanguage = req.body.targetLanguage || 'Turkish';
        const isPptx = req.file.originalname.toLowerCase().endsWith('.pptx');

        if (isPptx) {
            await handlePptxTranslation(req, res, jobId, targetLanguage);
        } else {
            await handlePdfTranslation(req, res, jobId, targetLanguage);
        }

    } catch (error) {
        const errorDetail = `
--- ${new Date().toISOString()} ---
Message: ${error.message}
Stack: ${error.stack}
${error.response ? `API Status: ${error.response.status}\nAPI Data: ${JSON.stringify(error.response.data)}` : ''}
--------------------------
`;
        fs.appendFileSync('error.log', errorDetail);

        jobs[jobId] = { status: 'error', message: error.message };
        console.error('--- Translation Error ---');
        console.error('Message:', error.message);
        if (!res.headersSent) {
            res.status(500).send('An error occurred during translation: ' + error.message);
        }
    }
});

async function handlePptxTranslation(req, res, jobId, targetLanguage) {
    jobs[jobId] = { status: 'extracting', message: 'Extracting slides...' };
    const zip = new AdmZip(req.file.path);
    const zipEntries = zip.getEntries();

    let allText = [];

    // 1. Gather all text from slides
    for (const entry of zipEntries) {
        if (entry.entryName.startsWith('ppt/slides/slide') && entry.entryName.endsWith('.xml')) {
            const content = entry.getData().toString('utf8');
            const matches = content.match(/<a:t>([^<]+)<\/a:t>/g);
            if (matches) {
                matches.forEach(m => {
                    const text = m.replace('<a:t>', '').replace('</a:t>', '');
                    if (text.trim()) allText.push(text);
                });
            }
        }
    }

    if (allText.length === 0) {
        throw new Error("No text found in presentation.");
    }

    // 2. Translate in chunks to avoid token limits
    const chunkSize = 50;
    let translations = {};
    const totalChunks = Math.ceil(allText.length / chunkSize);

    for (let i = 0; i < allText.length; i += chunkSize) {
        const currentChunkIdx = Math.floor(i / chunkSize) + 1;
        const percentage = Math.round((currentChunkIdx / totalChunks) * 100);

        jobs[jobId] = {
            status: 'translating',
            message: `Translating content... (${percentage}%)`
        };

        const chunk = allText.slice(i, i + chunkSize);
        const promptText = chunk.map((text, idx) => `[${i + idx}]: ${text}`).join('\n');

        const chatCompletion = await groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: `You are an elite academic and technical translator. 
                    Translate the following numbered list into ${targetLanguage}. 
                    
                    GUIDELINES:
                    1. Use a highly formal, academic, and professional tone.
                    2. Maintain technical integrity. Terms like 'Deadlock', 'Race Condition', 'Throughput', 'Latency' should remain in English if they are the academic standard, or use the most accepted formal academic equivalent in ${targetLanguage}.
                    3. Do not use colloquialisms. Ensure sentences are flowy and grammatically superior.
                    4. Keep the original numbers in brackets (e.g., [0], [1]).
                    5. Return ONLY the translated list.`
                },
                {
                    role: "user",
                    content: promptText
                }
            ],
            model: "llama-3.3-70b-versatile",
        });

        const translatedChunk = chatCompletion.choices[0]?.message?.content || "";
        const lines = translatedChunk.split('\n');
        lines.forEach(line => {
            const match = line.match(/^\[(\d+)\]:\s*(.*)/);
            if (match) {
                translations[match[1]] = match[2];
            }
        });
    }

    // 3. Reconstruct the PPTX
    jobs[jobId] = { status: 'generating', message: 'Reconstructing the slides...' };
    let currentTextIdx = 0;

    for (const entry of zipEntries) {
        if (entry.entryName.startsWith('ppt/slides/slide') && entry.entryName.endsWith('.xml')) {
            let content = entry.getData().toString('utf8');
            content = content.replace(/<a:t>([^<]+)<\/a:t>/g, (match, p1) => {
                const originalText = p1.trim();
                if (originalText) {
                    const translated = translations[currentTextIdx++] || p1;
                    const cleaned = cleanText(translated);
                    return `<a:t>${cleaned}</a:t>`;
                }
                return match;
            });
            zip.updateFile(entry.entryName, Buffer.from(content, 'utf8'));
        }
    }

    const pptxBuffer = zip.toBuffer();
    fs.unlinkSync(req.file.path);

    jobs[jobId] = { status: 'completed', message: 'Slide translation ready!' };
    res.contentType("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    res.send(pptxBuffer);
}

async function handlePdfTranslation(req, res, jobId, targetLanguage) {
    const dataBuffer = fs.readFileSync(req.file.path);

    // 1. Extract text
    jobs[jobId] = { status: 'extracting', message: 'Extracting text from PDF...' };
    const data = await pdfParse(dataBuffer);
    const originalText = data.text;

    if (!originalText.trim()) {
        throw new Error("Could not extract text from PDF.");
    }

    // 2. Translate using Groq
    jobs[jobId] = { status: 'translating', message: 'Translating document... (50%)' };
    const chatCompletion = await groq.chat.completions.create({
        messages: [
            {
                role: "system",
                content: `You are an elite academic and technical translator. 
                Translate the provided text into ${targetLanguage}. 
                
                GUIDELINES:
                1. Use a highly formal, academic, and professional tone.
                2. Maintain technical integrity. Keep industry-standard English terms where they are the academic norm.
                3. Ensure the translation is contextually consistent and logically sound.
                4. Maintain original structure and professional formatting.
                5. Return ONLY the translation.`
            },
            {
                role: "user",
                content: originalText
            }
        ],
        model: "llama-3.3-70b-versatile",
    });

    const translatedText = cleanText(chatCompletion.choices[0]?.message?.content || "");

    if (!translatedText) {
        throw new Error("Empty translation received from Groq.");
    }

    // 3. Create new PDF
    jobs[jobId] = { status: 'generating', message: 'Generating translated PDF...' };
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    let page = pdfDoc.addPage();
    const { width, height } = page.getSize();

    const fontSize = 12;
    const margin = 50;
    const maxWidth = width - margin * 2;
    let y = height - margin;

    const lines = translatedText.split('\n');

    for (const line of lines) {
        if (y < margin + fontSize) {
            page = pdfDoc.addPage();
            y = height - margin;
        }

        const words = line.split(' ');
        let currentLine = '';

        for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            let testWidth;
            try {
                testWidth = font.widthOfTextAtSize(testLine, fontSize);
            } catch (e) {
                testWidth = font.widthOfTextAtSize(currentLine || word, fontSize);
            }

            if (testWidth > maxWidth) {
                const cleanedLine = cleanText(currentLine);
                page.drawText(cleanedLine, { x: margin, y, size: fontSize, font });
                y -= fontSize + 5;
                currentLine = word;

                if (y < margin + fontSize) {
                    page = pdfDoc.addPage();
                    y = height - margin;
                }
            } else {
                currentLine = testLine;
            }
        }

        if (currentLine) {
            const cleanedLine = cleanText(currentLine);
            page.drawText(cleanedLine, { x: margin, y, size: fontSize, font });
            y -= fontSize + 10;
        }
    }

    const pdfBytes = await pdfDoc.save();
    fs.unlinkSync(req.file.path);

    jobs[jobId] = { status: 'completed', message: 'PDF translation ready!' };
    res.contentType("application/pdf");
    res.send(Buffer.from(pdfBytes));
}

app.get('/api/status/:jobId', (req, res) => {
    const status = jobs[req.params.jobId] || { status: 'unknown', message: 'Job not found' };
    res.json(status);
});

// The "catchall" handler: for any request that doesn't
// match one above, send back React's index.html file.
app.get('*', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
