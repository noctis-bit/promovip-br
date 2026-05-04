const express = require('express');
const multer = require('multer');
const { PDFParse } = require('pdf-parse');
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

// Função auxiliar para inicializar o Supabase com segurança
function getSupabase() {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    
    if (!url || !key) {
        throw new Error('SUPABASE_URL ou SUPABASE_KEY não configurados nas variáveis de ambiente do Vercel.');
    }
    return createClient(url, key);
}

// --- ROTAS ---

app.get('/api/debug', async (req, res) => {
    try {
        const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
        const key = process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
        
        let supabase_status = 'NÃO CONECTADO';
        let supabase_error = null;

        try {
            const supabase = getSupabase();
            const { error } = await supabase.from('promos').select('count', { count: 'exact', head: true });
            if (error) {
                supabase_error = error.message;
                supabase_status = 'ERRO NA TABELA PROMOS';
            } else {
                supabase_status = 'CONECTADO COM SUCESSO';
            }
        } catch (e) {
            supabase_status = 'ERRO DE INICIALIZAÇÃO';
            supabase_error = e.message;
        }

        res.json({ 
            status: 'ok', 
            node_version: process.version,
            supabase: {
                status: supabase_status,
                error: supabase_error,
                url_configured: !!url,
                key_configured: !!key,
                key_format_jwt: key?.startsWith('eyJ')
            }
        });
    } catch (e) {
        res.status(500).json({ error: 'Erro crítico no debug: ' + e.message });
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
    } catch (error) {
        console.error('Erro ao buscar dados:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/upload-pdf', upload.single('pdf'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

        const supabase = getSupabase();
        const globalCoupon = req.body.coupon || "";
        const dataBuffer = fs.readFileSync(req.file.path);
        
        console.log('Iniciando PDFParse...');
        const parser = new PDFParse(new Uint8Array(dataBuffer));
        
        const [textResult, imageResult] = await Promise.all([
            parser.getText().catch(e => { console.error('Erro texto:', e); return { pages: [] }; }),
            parser.getImage({ imageDataUrl: true }).catch(e => { console.error('Erro imagens:', e); return { pages: [] }; })
        ]);

        if (!textResult || !textResult.pages || textResult.pages.length === 0) {
            throw new Error('Não foi possível extrair texto do PDF.');
        }

        const totalPages = Math.min(textResult.pages.length, 10); // Reduzido para 10 para Vercel
        const newPromos = [];

        for (let i = 0; i < totalPages; i++) {
            const page = textResult.pages[i];
            const pageText = page.text || "";
            const pageImages = (imageResult && imageResult.pages && imageResult.pages[i]) ? imageResult.pages[i].images : [];

            const uniqueLinks = [...new Set(pageText.match(/(https?:\/\/[^\s]+)/g) || [])];
            if (uniqueLinks.length === 0) continue;

            let productImage = "assets/placeholder.png";
            if (pageImages.length > 0) {
                try {
                    const img = pageImages[0];
                    const imgName = `promo_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.png`;
                    let buffer = img.data.startsWith('data:') 
                        ? Buffer.from(img.data.replace(/^data:image\/\w+;base64,/, ""), 'base64')
                        : Buffer.from(img.data);

                    const { error: uploadError } = await supabase.storage.from('promos').upload(imgName, buffer, { contentType: 'image/png' });
                    if (!uploadError) {
                        productImage = supabase.storage.from('promos').getPublicUrl(imgName).data.publicUrl;
                    }
                } catch (e) { console.error('Erro imagem:', e); }
            }

            const priceMatches = pageText.match(/R\$\s?(\d+[\d.,]*)/g);
            const price = priceMatches ? priceMatches[priceMatches.length - 1] : "Consulte no site";
            const name = (pageText.split('\n')[0] || `Produto ${i + 1}`).substring(0, 100);

            uniqueLinks.forEach(url => {
                newPromos.push({
                    name, old_price: "---", current_price: price, 
                    discount: globalCoupon ? `CUPOM: ${globalCoupon}` : "Oferta!",
                    image: productImage, affiliate_link: url, urgency: "Verificado!", coupon: globalCoupon
                });
            });
        }

        if (newPromos.length > 0) {
            const { error: dbError } = await supabase.from('promos').insert(newPromos);
            if (dbError) throw dbError;
        }

        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.json({ message: 'Sucesso!', count: newPromos.length });

    } catch (error) {
        console.error('ERRO:', error);
        res.status(500).json({ error: error.message });
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
app.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));

module.exports = app;
