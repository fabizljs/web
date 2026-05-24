const express = require('express');
const multer = require('multer');
const axios = require('axios');
const loki = require('lokijs');
const crypto = require('crypto');
const path = require('path');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "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";
const GITHUB_USER = "fabizljs";
const GITHUB_REPO = "web"; 

const db = new loki('cdn_local.json');
let filesCollection = db.addCollection('files');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'Archivo requerido' });
        }

        const originalName = req.file.originalname;
        const extension = originalName.split('.').pop().toLowerCase();
        
        const fileId = crypto.randomBytes(4).toString('hex');
        const customFileName = `${fileId}.${extension}`;

        const contentBase64 = req.file.buffer.toString('base64');
        const githubUrl = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/files_cdn/${customFileName}`;
        
        await axios.put(githubUrl, {
            message: `CDN Sync: ${customFileName}`,
            content: contentBase64
        }, {
            headers: {
                Authorization: `token ${GITHUB_TOKEN}`,
                Accept: 'application/vnd.github.v3+json'
            }
        });

        const tiempoLimiteMs = 7 * 24 * 60 * 60 * 1000;
        const tiempoDeExpiracion = Date.now() + tiempoLimiteMs;

        filesCollection.insert({
            id: fileId,
            extension: extension,
            mimeType: req.file.mimetype,
            githubPath: `files_cdn/${customFileName}`,
            expiresAt: tiempoDeExpiracion
        });

        const host = req.get('host');
        const protocol = req.protocol;

        res.json({
            success: true,
            url: `${protocol}://${host}/files/${customFileName}`
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ 
            success: false, 
            error: error.response ? error.response.data.message : error.message 
        });
    }
});

app.get('/files/:idWithExt', async (req, res) => {
    const { idWithExt } = req.params;
    const parts = idWithExt.split('.');
    const fileId = parts[0];

    const archivoRecord = filesCollection.findOne({ id: fileId });

    if (!archivoRecord) {
        return res.status(404).send('Not Found');
    }

    if (Date.now() > archivoRecord.expiresAt) {
        filesCollection.remove(archivoRecord);
        return res.status(404).send('Not Found');
    }

    try {
        
        const githubDownloadUrl = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${archivoRecord.githubPath}`;
        
        const response = await axios.get(githubDownloadUrl, {
            headers: {
                Authorization: `token ${GITHUB_TOKEN}`,
                Accept: 'application/vnd.github.v3.raw'
            },
            responseType: 'arraybuffer'
        });

        res.setHeader('Content-Type', archivoRecord.mimeType);
        res.setHeader('Cache-Control', 'public, max-age=86400'); 

        res.send(Buffer.from(response.data));

    } catch (error) {
        res.status(500).send('Error');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server listo en puerto ${PORT}`);
});

module.exports = app;
