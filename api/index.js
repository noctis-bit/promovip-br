const express = require('express');
const multer = require('multer');
const fs = require('fs-extra');
const path = require('path');
const cors = require('cors');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const app = express();
const upload = multer({ dest: '/tmp' });

app.use(cors());
app.use(express.static('public'));
app.use(express.json());

// Lazy-load PDF parser safely
function getPDFParser() {
    try {
        const { PDFParse } = require('pdf-parse');
        return PDFParse;
    } catch (e) {
        throw new Error('Falha ao carregar o motor de PDF: ' + e.message);
    }
}

function getSupabase() {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new Error('Credenciais do Supabase ausentes nas variáveis de ambiente.');
    return createClient(url, key);
}

// --- ROTAS ---

app.get('/api/debug', async (req, res) => {
    try {
        const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
        const key = process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
        
        let supabase_info = { status: 'checking' };
        try {
            const supabase = getSupabase();
            const { error } = await supabase.from('promos').select('count', { count: 'exact', head: true });
            supabase_info = { 
                status: error ? 'error' : 'ok', 
                message: error ? error.message : 'Conectado!',
                url_ok: !!url,
                key_ok: !!key
            };
        } catch (e) {
            supabase_info = { status: 'crash', message: e.message };
        }

        res.json({ 
            status: 'online', 
            env: process.env.NODE_ENV || 'production',
            supabase: supabase_info,
            time: new Date().toISOString()
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/promos', async (req, res) => {
    try {
        const supabase = getSupabase();
        const { data: promos, error: pError } = await supabase.from('promos')
            .select('*, oldPrice:old_price, currentPrice:current_price, affiliateLink:affiliate_link')
            .order('created_at', { ascending: false });
        const { data: coupons, error: cError } = await supabase.from('coupons')
            .select('*, desc:description')
            .order('created_at', { ascending: false });
        if (pError || cError) throw pError || cError;
        res.json({ promos, coupons });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/upload-pdf', upload.single('pdf'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado.' });

        const PDFParse = getPDFParser();
        const supabase = getSupabase();
        const globalCoupon = req.body.coupon || "";
        const dataBuffer = fs.readFileSync(req.file.path);
        
        const parser = new PDFParse(new Uint8Array(dataBuffer));
        const [textResult, imageResult] = await Promise.all([
            parser.getText().catch(() => ({ pages: [] })),
            parser.getImage({ imageDataUrl: true }).catch(() => ({ pages: [] }))
        ]);

        if (!textResult.pages?.length) throw new Error('PDF sem texto extraível.');

        const totalPages = Math.min(textResult.pages.length, 5); // Limitado a 5 para evitar timeout
        const newPromos = [];

        for (let i = 0; i < totalPages; i++) {
            const pageText = textResult.pages[i].text || "";
            const pageImages = (imageResult.pages?.[i]) ? imageResult.pages[i].images : [];
            const links = [...new Set(pageText.match(/(https?:\/\/[^\s]+)/g) || [])];
            if (!links.length) continue;

            let productImage = "assets/placeholder.png";
            if (pageImages.length > 0) {
                try {
                    const img = pageImages[0];
                    const imgName = `p_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.png`;
                    const buffer = img.data.startsWith('data:') 
                        ? Buffer.from(img.data.split(',')[1], 'base64')
                        : Buffer.from(img.data);

                    const { error } = await supabase.storage.from('promos').upload(imgName, buffer, { contentType: 'image/png' });
                    if (!error) productImage = supabase.storage.from('promos').getPublicUrl(imgName).data.publicUrl;
                } catch (e) { console.error(e); }
            }

            const prices = pageText.match(/R\$\s?(\d+[\d.,]*)/g);
            const price = prices ? prices[prices.length - 1] : "Consulte";
            const name = (pageText.split('\n')[0] || "Produto").substring(0, 80);

            links.forEach(url => {
                newPromos.push({
                    name, current_price: price, discount: globalCoupon ? `CUPOM: ${globalCoupon}` : "Oferta!",
                    image: productImage, affiliate_link: url, urgency: "OK", coupon: globalCoupon
                });
            });
        }

        if (newPromos.length > 0) await supabase.from('promos').insert(newPromos);
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.json({ message: 'OK', count: newPromos.length });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log('Server OK'));
module.exports = app;
