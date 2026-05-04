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

// Função para extrair a primeira imagem de uma página usando pdf-lib
async function extractFirstImageFromPage(pdfDoc, pageIndex) {
    try {
        const page = pdfDoc.getPage(pageIndex);
        const { xObjectNames } = page.node;
        if (!xObjectNames) return null;

        for (const name of xObjectNames()) {
            const xObject = page.node.resources().lookup(name);
            if (xObject && xObject.get('Subtype')?.toString() === '/Image') {
                const imageBytes = xObject.contents;
                const filter = xObject.get('Filter')?.toString();
                
                let contentType = 'image/jpeg';
                if (filter === '/FlateDecode') contentType = 'image/png';
                
                return { bytes: imageBytes, contentType };
            }
        }
    } catch (e) {
        console.error('Erro ao extrair imagem:', e.message);
    }
    return null;
}

app.post('/api/upload-pdf', upload.single('pdf'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado.' });

        const dataBuffer = fs.readFileSync(req.file.path);
        const pdfData = await pdf(dataBuffer);
        const pdfDoc = await PDFDocument.load(dataBuffer);
        
        const pagesText = pdfData.text.split(/\u000c|\f/);
        const globalCoupon = req.body.coupon || "";
        const newPromos = [];
        const supabase = getSupabase();

        console.log(`Processando ${pdfDoc.getPageCount()} páginas...`);

        for (let i = 0; i < pdfDoc.getPageCount(); i++) {
            const pageText = pagesText[i] || "";
            if (!pageText.trim()) continue;

            const links = [...new Set(pageText.match(/(https?:\/\/[^\s]+)/g) || [])];
            if (!links.length) continue;

            // Tentar extrair a foto do produto
            let productImage = "assets/placeholder.png";
            const imgData = await extractFirstImageFromPage(pdfDoc, i);
            if (imgData) {
                try {
                    const imgName = `p_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.jpg`;
                    const { error: uploadError } = await supabase.storage
                        .from('promos')
                        .upload(imgName, imgData.bytes, { contentType: imgData.contentType });

                    if (!uploadError) {
                        productImage = supabase.storage.from('promos').getPublicUrl(imgName).data.publicUrl;
                    }
                } catch (e) { console.error('Erro upload imagem:', e); }
            }

            const prices = pageText.match(/R\$\s?(\d+[\d.,]*)/g);
            const price = prices ? prices[prices.length - 1] : "Consulte";
            const lines = pageText.split('\n').map(l => l.trim()).filter(l => l.length > 5);
            const name = (lines[0] || `Produto ${i + 1}`).substring(0, 100);

            // Evitar duplicação se houver mais de um link na mesma página (um produto por página)
            newPromos.push({
                name, 
                old_price: "---", 
                current_price: price, 
                discount: globalCoupon ? `CUPOM: ${globalCoupon}` : "Oferta!",
                image: productImage,
                affiliate_link: links[0], // Pega o primeiro link da página para evitar repetição
                urgency: "Verificado!", 
                coupon: globalCoupon
            });
        }

        if (newPromos.length > 0) {
            const { error: dbError } = await supabase.from('promos').insert(newPromos);
            if (dbError) throw dbError;
        }

        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.json({ message: 'Sucesso!', count: newPromos.length });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// Outras rotas (mantidas iguais)
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
