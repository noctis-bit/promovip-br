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
                    // Agrupa por posição Y para manter as linhas corretas
                    const lines = {};
                    textContent.items.forEach(item => {
                        const y = Math.round(item.transform[5]);
                        if (!lines[y]) lines[y] = [];
                        lines[y].push(item.str);
                    });
                    const text = Object.keys(lines).sort((a, b) => b - a)
                        .map(y => lines[y].join(' ')).join('\n');
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

            const priceMatches = pageText.match(/R\$\s?(\d+[\d.,]*)/g);
            const price = priceMatches ? priceMatches[priceMatches.length - 1] : "Consulte";
            
            // Pega a primeira linha que não seja vazia e não seja link
            const lines = pageText.split('\n').map(l => l.trim()).filter(l => l.length > 3 && !l.includes('http'));
            const name = lines[0] || `Produto ${i + 1}`;

            let productImage = "assets/placeholder.png";
            
            // Tenta extrair a foto (método pdf-lib revisado)
            try {
                const page = pdfDoc.getPage(i);
                const { xObjectNames } = page.node;
                if (xObjectNames) {
                    for (const xName of xObjectNames()) {
                        const xObject = page.node.resources().lookup(xName);
                        if (xObject && xObject.get('Subtype')?.toString() === '/Image') {
                            const bytes = xObject.contents;
                            if (bytes && bytes.length > 5000) { // Garante que não é um ícone pequeno
                                const imgName = `p_${Date.now()}_${i}.jpg`;
                                await supabase.storage.from('promos').upload(imgName, bytes, { contentType: 'image/jpeg' });
                                productImage = supabase.storage.from('promos').getPublicUrl(imgName).data.publicUrl;
                                break; 
                            }
                        }
                    }
                }
            } catch (e) { console.error('Erro img:', e); }

            newPromos.push({
                name: name.substring(0, 100), 
                old_price: "---", 
                current_price: price, 
                discount: globalCoupon ? `CUPOM: ${globalCoupon}` : "Oferta!",
                image: productImage,
                affiliate_link: links[0],
                urgency: "Verificado!",
                coupon: globalCoupon
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
