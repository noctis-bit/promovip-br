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
                    // Pega todo o texto da página mantendo ordem natural
                    const text = textContent.items.map(item => item.str).join(' ');
                    pagesText.push(text);
                    return text;
                });
            }
        });

        const pdfDoc = await PDFDocument.load(dataBuffer);
        const totalPages = pdfDoc.getPageCount();
        const newPromos = [];

        console.log(`Processando ${totalPages} produtos (um por página)...`);

        for (let i = 0; i < totalPages; i++) {
            const pageText = pagesText[i] || "";
            const links = [...new Set(pageText.match(/(https?:\/\/[^\s]+)/g) || [])];
            const prices = pageText.match(/R\$\s?(\d+[\d.,]*)/g);
            
            if (!links.length && !prices) continue;

            const price = prices ? prices[prices.length - 1] : "Consulte";
            
            // Filtro de Nome: Pega o texto da página, remove o link e o preço, e o que sobrar de relevante é o nome
            let name = pageText
                .replace(/(https?:\/\/[^\s]+)/g, '')
                .replace(/R\$\s?(\d+[\d.,]*)/g, '')
                .replace(/\s+/g, ' ')
                .trim();
            
            // Se o nome ficou muito grande, pega apenas o começo
            if (name.length > 100) name = name.substring(0, 97) + '...';
            if (!name) name = `Produto Página ${i + 1}`;

            let productImage = "assets/placeholder.png";
            
            // Busca profunda por imagens na página
            try {
                const page = pdfDoc.getPage(i);
                const resources = page.node.resources();
                const xObjects = resources?.get('XObject');
                if (xObjects) {
                    const names = xObjects.keys();
                    for (const xName of names) {
                        const xObject = xObjects.lookup(xName);
                        if (xObject && xObject.get('Subtype')?.toString() === '/Image') {
                            const bytes = xObject.contents;
                            if (bytes && bytes.length > 3000) { // Evita ícones minúsculos
                                const fileName = `img_${Date.now()}_${i}.jpg`;
                                const { error: uploadError } = await supabase.storage.from('promos').upload(fileName, bytes, { contentType: 'image/jpeg' });
                                if (!uploadError) {
                                    productImage = supabase.storage.from('promos').getPublicUrl(fileName).data.publicUrl;
                                    break; 
                                }
                            }
                        }
                    }
                }
            } catch (e) { console.error('Erro ao extrair imagem:', e.message); }

            newPromos.push({
                name, 
                old_price: "---", 
                current_price: price, 
                discount: globalCoupon ? `CUPOM: ${globalCoupon}` : "Oferta!",
                image: productImage,
                affiliate_link: links[0] || "#",
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
