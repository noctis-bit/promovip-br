const express = require('express');
const multer = require('multer');
const { PDFParse } = require('pdf-parse');
const fs = require('fs-extra');
const path = require('path');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const app = express();
const upload = multer({ dest: 'uploads/' });

// Inicializar Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

app.use(express.static('public'));
app.use(express.json());

const ASSETS_DIR = path.join(__dirname, 'public', 'assets');
fs.ensureDirSync(ASSETS_DIR);

// Funções legadas removidas (agora usamos Supabase diretamente nas rotas)

// --- ROTAS ---

app.get('/api/promos', async (req, res) => {
    try {
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
        res.status(500).json({ error: 'Erro ao carregar dados' });
    }
});

app.post('/api/upload-pdf', upload.single('pdf'), async (req, res) => {
    if (!req.file) return res.status(400).send('Nenhum arquivo enviado.');

    try {
        const globalCoupon = req.body.coupon || "";
        const dataBuffer = fs.readFileSync(req.file.path);
        const parser = new PDFParse({ data: dataBuffer });
        
        // Extrair tudo de forma estruturada por página
        const textResult = await parser.getText();
        const infoResult = await parser.getInfo({ parsePageInfo: true });
        const imageResult = await parser.getImage({ imageDataUrl: true });

        const newPromos = [];
        const totalPages = textResult.pages.length;

        console.log(`Processando PDF com ${totalPages} páginas...`);

        for (let i = 0; i < totalPages; i++) {
            const pageText = textResult.pages[i].text;
            const pageLinks = infoResult.pages[i].links || [];
            const pageImages = imageResult.pages[i].images || [];

            // Adicionar links encontrados via Regex no texto da página (caso não estejam nas anotações)
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            const textUrls = pageText.match(urlRegex) || [];
            
            let uniqueLinks = [...pageLinks.map(l => l.url)];
            textUrls.forEach(url => {
                if (!uniqueLinks.includes(url)) uniqueLinks.push(url);
            });

            // Se não houver links nesta página, pula para a próxima
            if (uniqueLinks.length === 0) continue;

            // Processar a primeira imagem da página como imagem principal
            let productImage = "assets/placeholder.png";
            if (pageImages.length > 0) {
                const img = pageImages[0];
                const imgName = `promo_${Date.now()}_p${i}_${Math.random().toString(36).substr(2, 5)}.png`;
                const imgPath = path.join(ASSETS_DIR, imgName);
                await fs.writeFile(imgPath, Buffer.from(img.data));
                productImage = `assets/${imgName}`;
            }

            // Para cada link na página, tentamos criar um anúncio
            // (Se houver apenas um produto por página, isso será perfeito)
            for (const url of uniqueLinks) {
                const priceRegex = /R\$\s?(\d+[\d.,]*)/g;
                const priceMatches = pageText.match(priceRegex);
                const price = priceMatches ? priceMatches[priceMatches.length - 1] : "Consulte no site";

                const allLines = pageText.split('\n').map(l => l.trim()).filter(l => l.length > 5);
                const potentialNames = allLines.filter(l => {
                    const upper = l.toUpperCase();
                    return !upper.includes('PREÇO') && !upper.includes('LINK') && !upper.includes('HTTP') && !l.includes('R$');
                });
                
                // O nome costuma ser a primeira linha relevante da página
                const name = potentialNames.length > 0 ? potentialNames[0] : "Produto da Página " + (i + 1);

                newPromos.push({
                    id: Date.now() + Math.random(),
                    name: name,
                    oldPrice: "---",
                    currentPrice: price,
                    discount: globalCoupon ? `CUPOM: ${globalCoupon}` : "Confira!",
                    image: productImage,
                    affiliateLink: url,
                    urgency: "Oferta verificada!",
                    coupon: globalCoupon
                });
            }
        }

        // Salvar no Supabase
        if (newPromos.length > 0) {
            const { error } = await supabase.from('promos').insert(newPromos.map(p => {
                const { id, ...data } = p; // Removendo ID temporário para o Supabase gerar o UUID
                return {
                    name: data.name,
                    old_price: data.oldPrice,
                    current_price: data.currentPrice,
                    discount: data.discount,
                    image: data.image,
                    affiliate_link: data.affiliateLink,
                    urgency: data.urgency,
                    coupon: data.coupon
                };
            }));
            if (error) throw error;
        }

        fs.unlinkSync(req.file.path);
        res.json({ message: 'Processamento concluído!', count: newPromos.length });
    } catch (error) {
        console.error('Erro no processamento:', error);
        res.status(500).json({ error: 'Erro ao processar PDF' });
    }
});

app.delete('/api/promos/:id', async (req, res) => {
    try {
        const { error } = await supabase.from('promos').delete().eq('id', req.params.id);
        if (error) throw error;
        res.json({ message: 'Produto removido' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao remover produto' });
    }
});

// --- ROTAS DE CUPONS ---
app.get('/api/coupons', async (req, res) => {
    try {
        const { data, error } = await supabase.from('coupons').select('*, desc:description').order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao carregar cupons' });
    }
});

app.post('/api/coupons', async (req, res) => {
    try {
        const { store, value, code, desc } = req.body;
        const { data, error } = await supabase.from('coupons').insert([{ 
            store, 
            value, 
            code, 
            description: desc 
        }]).select();
        
        if (error) throw error;
        res.status(201).json(data[0]);
    } catch (error) {
        console.error('Erro ao salvar cupom:', error);
        res.status(500).json({ error: 'Erro ao salvar cupom' });
    }
});

app.delete('/api/coupons/:id', async (req, res) => {
    try {
        const { error } = await supabase.from('coupons').delete().eq('id', req.params.id);
        if (error) throw error;
        res.json({ message: 'Cupom removido' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao remover cupom' });
    }
});

const PORT = 8080;
app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});
