const express = require('express');
const multer = require('multer');
const { PDFParse } = require('pdf-parse');
const fs = require('fs-extra');
const path = require('path');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const app = express();
const upload = multer({ dest: '/tmp' });


// Inicializar Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

app.use(express.static('public'));
app.use(express.json());

const ASSETS_DIR = process.env.VERCEL 
    ? path.join('/tmp', 'assets') 
    : path.join(__dirname, '..', 'public', 'assets');


try {
    fs.ensureDirSync(ASSETS_DIR);
} catch (e) {
    console.warn('Não foi possível criar ASSETS_DIR (comum no Vercel):', e.message);
}


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
        const parser = new PDFParse(new Uint8Array(dataBuffer));
        
        // Extrair tudo de forma estruturada por página
        const textResult = await parser.getText();
        const imageResult = await parser.getImage({ imageDataUrl: true });

        if (!textResult || !textResult.pages) {
            throw new Error('Não foi possível extrair páginas do PDF. O arquivo pode estar corrompido ou protegido.');
        }

        const newPromos = [];
        const totalPages = textResult.pages.length;

        console.log(`Processando PDF com ${totalPages} páginas...`);

        for (let i = 0; i < totalPages; i++) {
            const pageText = textResult.pages[i]?.text || "";
            const pageImages = (imageResult && imageResult.pages && imageResult.pages[i]) ? imageResult.pages[i].images : [];

            // Extrair links via Regex no texto da página
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            const uniqueLinks = [...new Set(pageText.match(urlRegex) || [])];

            // Se não houver links nesta página, pula para a próxima
            if (uniqueLinks.length === 0) continue;

            // Processar a primeira imagem da página como imagem principal
            let productImage = "assets/placeholder.png";
            if (pageImages.length > 0) {
                try {
                    const img = pageImages[0];
                    const imgName = `promo_${Date.now()}_p${i}.png`;
                    
                    // Converter DataURL para Buffer se necessário
                    let buffer;
                    if (img.data.startsWith('data:')) {
                        const base64Data = img.data.replace(/^data:image\/\w+;base64,/, "");
                        buffer = Buffer.from(base64Data, 'base64');
                    } else {
                        buffer = Buffer.from(img.data);
                    }

                    // Upload para Supabase Storage (Bucket: 'promos')
                    const { data: uploadData, error: uploadError } = await supabase.storage
                        .from('promos')
                        .upload(imgName, buffer, {
                            contentType: 'image/png',
                            upsert: true
                        });

                    if (uploadError) {
                        console.error('Erro no upload do Supabase Storage:', uploadError.message);
                    } else {
                        // Obter URL pública
                        const { data: { publicUrl } } = supabase.storage
                            .from('promos')
                            .getPublicUrl(imgName);
                        productImage = publicUrl;
                    }
                } catch (storageError) {
                    console.error('Erro crítico no Supabase Storage:', storageError);
                }
            }

            // Tentar encontrar preço (Padrão R$ 99,99)
            const priceRegex = /R\$\s?(\d+[\d.,]*)/g;
            const priceMatches = pageText.match(priceRegex);
            const price = priceMatches ? priceMatches[priceMatches.length - 1] : "Consulte no site";

            // Tentar extrair nome
            const lines = pageText.split('\n').map(l => l.trim()).filter(l => l.length > 5);
            const potentialNames = lines.filter(l => 
                !l.includes('http') && !l.includes('R$') && !l.toUpperCase().includes('CUPOM')
            );
            const name = potentialNames.length > 0 ? potentialNames[0] : `Produto da Página ${i + 1}`;

            for (const url of uniqueLinks) {
                newPromos.push({
                    name: name,
                    old_price: "---",
                    current_price: price,
                    discount: globalCoupon ? `CUPOM: ${globalCoupon}` : "Oferta!",
                    image: productImage,
                    affiliate_link: url,
                    urgency: "Verificado!",
                    coupon: globalCoupon
                });
            }
        }

        // Salvar no Supabase
        if (newPromos.length > 0) {
            const { error: dbError } = await supabase.from('promos').insert(newPromos);
            if (dbError) {
                console.error('Erro ao salvar no banco de dados Supabase:', dbError.message);
                throw dbError;
            }
        }

        if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        if (newPromos.length === 0) {
            return res.status(422).json({ error: 'Nenhum produto ou link válido foi encontrado neste PDF. Certifique-se de que o PDF contém links e textos legíveis.' });
        }

        res.json({ message: 'Processamento concluído!', count: newPromos.length });
    } catch (error) {
        console.error('Erro Geral no Processamento do PDF:', error);
        res.status(500).json({ error: 'Erro ao processar PDF: ' + error.message });
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

if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    const PORT = 8080;
    app.listen(PORT, () => {
        console.log(`Servidor rodando em http://localhost:${PORT}`);
    });
}

module.exports = app;

