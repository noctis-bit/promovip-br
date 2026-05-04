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

// Endpoint para o frontend pegar as chaves públicas com segurança
app.get('/api/config', (req, res) => {
    res.json({
        url: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
        key: process.env.NEXT_PUBLIC_SUPABASE_KEY || process.env.SUPABASE_KEY
    });
});

// Extração de imagem por cabeçalhos binários (Técnica Ninja)
async function extractNinjaImages(pdfDoc) {
    const images = [];
    try {
        const objects = pdfDoc.context.enumerateIndirectObjects();
        for (const [ref, obj] of objects) {
            if (obj && obj.contents) {
                const dict = obj.dict || (obj.get ? obj : null);
                if (!dict) continue;
                const subtype = dict.get ? dict.get('Subtype')?.toString() : null;
                const filter = dict.get ? dict.get('Filter')?.toString() : null;
                if (subtype === '/Image' || (filter === '/DCTDecode')) {
                    const bytes = obj.contents;
                    if (bytes && bytes.length > 5000) {
                        images.push({ bytes, contentType: filter === '/DCTDecode' ? 'image/jpeg' : 'image/png' });
                    }
                }
            }
        }
    } catch (e) { console.error('Erro ninja:', e); }
    return images;
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
                    const text = textContent.items.map(item => item.str).join(' ');
                    pagesText.push(text);
                    return text;
                });
            }
        });
        const pdfDoc = await PDFDocument.load(dataBuffer);
        const totalPages = pdfDoc.getPageCount();
        const allImages = await extractNinjaImages(pdfDoc);
        const newPromos = [];
        for (let i = 0; i < totalPages; i++) {
            const pageText = pagesText[i] || "";
            let price = "Consulte", link = "#", name = "";
            const priceMatch = pageText.match(/PRE[ÇC]O:?\s*(R\$\s?[\d.,]+|\d+[\d.,]*)/i);
            if (priceMatch) price = priceMatch[1];
            const linkMatch = pageText.match(/LINK:?\s*(https?:\/\/[^\s]+)/i);
            if (linkMatch) link = linkMatch[1];
            name = pageText.split(/PRE[ÇC]O|LINK/i)[0].trim() || `Produto ${i + 1}`;
            if (name.length > 100) name = name.substring(0, 97) + '...';
            let productImage = "assets/placeholder.png";
            if (allImages[i]) {
                const img = allImages[i];
                const fileName = `ninja_${Date.now()}_${i}.jpg`;
                const { error } = await supabase.storage.from('promos').upload(fileName, img.bytes, { contentType: img.contentType });
                if (!error) productImage = supabase.storage.from('promos').getPublicUrl(fileName).data.publicUrl;
            }
            newPromos.push({
                name, old_price: "---", current_price: price, 
                discount: globalCoupon ? `CUPOM: ${globalCoupon}` : "Oferta!",
                image: productImage, affiliate_link: link, urgency: "Verificado!", coupon: globalCoupon
            });
        }
        if (newPromos.length > 0) await supabase.from('promos').insert(newPromos);
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.json({ message: 'Sucesso!', count: newPromos.length });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/promos', async (req, res) => {
    try {
        const supabase = getSupabase();
        const { data: promos } = await supabase.from('promos').select('*, oldPrice:old_price, currentPrice:current_price, affiliateLink:affiliate_link').order('created_at', { ascending: false });
        const { data: coupons } = await supabase.from('coupons').select('*, desc:description').order('created_at', { ascending: false });
        res.json({ promos, coupons });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Atualizar apenas texto via API (Imagem agora é direto no front)
app.put('/api/promos/:id', async (req, res) => {
    try {
        const supabase = getSupabase();
        const { id } = req.params;
        const { name, current_price, affiliate_link, image } = req.body;
        
        let updateData = { name, current_price, affiliate_link };
        if (image) updateData.image = image;

        const { error } = await supabase.from('promos').update(updateData).eq('id', id);
        if (error) return res.status(400).json({ error: error.message });
        
        res.json({ message: 'OK' });
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
