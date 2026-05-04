const express = require('express');
const multer = require('multer');
const fs = require('fs-extra');
const path = require('path');
const cors = require('cors');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const pdf = require('pdf-parse');
const { PDFDocument } = require('pdf-lib');

const app = express();
const upload = multer({ dest: '/tmp' });

app.use(cors());
app.use(express.static('public'));
app.use(express.json());

function getSupabase() {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    return createClient(url, key);
}

// Extração de imagem melhorada
async function extractImage(pdfDoc, pageIndex) {
    try {
        const page = pdfDoc.getPage(pageIndex);
        const { xObjectNames } = page.node;
        if (!xObjectNames) return null;
        for (const name of xObjectNames()) {
            const xObject = page.node.resources().lookup(name);
            if (xObject && xObject.get('Subtype')?.toString() === '/Image') {
                const bytes = xObject.contents;
                if (!bytes || bytes.length < 1000) continue; // Pula ícones pequenos
                
                let contentType = 'image/jpeg';
                const filter = xObject.get('Filter')?.toString();
                if (filter?.includes('Flate')) contentType = 'image/png';
                
                return { bytes, contentType };
            }
        }
    } catch (e) { console.error('Erro ao extrair imagem:', e.message); }
    return null;
}

app.post('/api/upload-pdf', upload.single('pdf'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado.' });
        const dataBuffer = fs.readFileSync(req.file.path);
        const supabase = getSupabase();
        const globalCoupon = req.body.coupon || "";

        const pagesText = [];
        await pdf(dataBuffer, {
            pagerender: (pageData) => {
                return pageData.getTextContent().then((textContent) => {
                    // Preserva a estrutura de linhas
                    const text = textContent.items.map(item => item.str).join(' ');
                    pagesText.push(text);
                    return text;
                });
            }
        });

        const pdfDoc = await PDFDocument.load(dataBuffer);
        const totalPages = pdfDoc.getPageCount();
        const newPromos = [];

        for (let i = 0; i < totalPages; i++) {
            const pageText = pagesText[i] || "";
            const links = [...new Set(pageText.match(/(https?:\/\/[^\s]+)/g) || [])];
            if (!links.length) continue;

            let productImage = "assets/placeholder.png";
            const imgData = await extractImage(pdfDoc, i);
            if (imgData) {
                try {
                    const imgName = `p_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.jpg`;
                    const { error } = await supabase.storage.from('promos').upload(imgName, imgData.bytes, { contentType: imgData.contentType });
                    if (!error) productImage = supabase.storage.from('promos').getPublicUrl(imgName).data.publicUrl;
                } catch (e) { console.error('Erro upload:', e); }
            }

            const prices = pageText.match(/R\$\s?(\d+[\d.,]*)/g);
            const price = prices ? prices[prices.length - 1] : "Consulte";
            
            // Lógica de Nome Melhorada: Pega as primeiras palavras que não sejam links ou preços
            const nameParts = pageText.split(' ')
                .filter(w => w.length > 2 && !w.includes('http') && !w.includes('R$'))
                .slice(0, 8); // Pega as primeiras 8 palavras significativas
            const name = nameParts.length > 0 ? nameParts.join(' ') : `Produto ${i + 1}`;

            newPromos.push({
                name: name.substring(0, 100), 
                old_price: "---", current_price: price, 
                discount: globalCoupon ? `CUPOM: ${globalCoupon}` : "Oferta!",
                image: productImage, affiliate_link: links[0], urgency: "Verificado!", coupon: globalCoupon
            });
        }

        if (newPromos.length > 0) await supabase.from('promos').insert(newPromos);
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.json({ message: 'Sucesso!', count: newPromos.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/promos', async (req, res) => {
    try {
        const supabase = getSupabase();
        const { data: promos, error: pError } = await supabase.from('promos').select('*, oldPrice:old_price, currentPrice:current_price, affiliateLink:affiliate_link').order('created_at', { ascending: false });
        const { data: coupons, error: cError } = await supabase.from('coupons').select('*, desc:description').order('created_at', { ascending: false });
        res.json({ promos, coupons });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/promos/:id', async (req, res) => {
    try {
        const supabase = getSupabase();
        await supabase.from('promos').delete().eq('id', req.params.id);
        res.json({ message: 'OK' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log('Server OK'));
module.exports = app;
