const express = require('express');
const multer = require('multer');
const fs = require('fs-extra');
const path = require('path');
const cors = require('cors');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const pdf = require('pdf-parse');

const app = express();
const upload = multer({ dest: '/tmp' });

app.use(cors());
app.use(express.static('public'));
app.use(express.json());

function getSupabase() {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new Error('Credenciais do Supabase ausentes.');
    return createClient(url, key);
}

app.get('/api/debug', async (req, res) => {
    try {
        const supabase = getSupabase();
        const { error } = await supabase.from('promos').select('count', { count: 'exact', head: true });
        res.json({ status: 'online', supabase: error ? 'error' : 'ok', error: error?.message });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/promos', async (req, res) => {
    try {
        const supabase = getSupabase();
        const { data: promos, error: pError } = await supabase.from('promos').select('*, oldPrice:old_price, currentPrice:current_price, affiliateLink:affiliate_link').order('created_at', { ascending: false });
        const { data: coupons, error: cError } = await supabase.from('coupons').select('*, desc:description').order('created_at', { ascending: false });
        res.json({ promos, coupons });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/upload-pdf', upload.single('pdf'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado.' });

        const dataBuffer = fs.readFileSync(req.file.path);
        const data = await pdf(dataBuffer);
        
        // O pdf-parse 1.1.1 retorna todo o texto. 
        // Vamos separar por páginas (o caractere \f ou \u000c costuma separar páginas)
        const pages = data.text.split(/\u000c|\f/);
        const globalCoupon = req.body.coupon || "";
        const newPromos = [];

        console.log(`Extraídas ${pages.length} páginas de texto.`);

        pages.forEach((pageText, i) => {
            if (!pageText.trim()) return;

            const links = [...new Set(pageText.match(/(https?:\/\/[^\s]+)/g) || [])];
            if (!links.length) return;

            const prices = pageText.match(/R\$\s?(\d+[\d.,]*)/g);
            const price = prices ? prices[prices.length - 1] : "Consulte";
            const name = (pageText.split('\n').filter(l => l.trim().length > 3)[0] || `Produto ${i + 1}`).substring(0, 100);

            links.forEach(url => {
                newPromos.push({
                    name, 
                    old_price: "---", 
                    current_price: price, 
                    discount: globalCoupon ? `CUPOM: ${globalCoupon}` : "Oferta!",
                    image: "assets/placeholder.png", // Imagens desativadas temporariamente para estabilidade na Vercel
                    affiliate_link: url, 
                    urgency: "Verificado!", 
                    coupon: globalCoupon
                });
            });
        });

        if (newPromos.length > 0) {
            const supabase = getSupabase();
            const { error: dbError } = await supabase.from('promos').insert(newPromos);
            if (dbError) throw dbError;
        }

        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.json({ message: 'OK', count: newPromos.length });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao processar PDF: ' + error.message });
    }
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
