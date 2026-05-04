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

// Middleware
app.use(cors());
app.use(express.static('public'));
app.use(express.json());

// Inicializar Supabase
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

console.log('--- Verificação de Ambiente ---');
console.log('SUPABASE_URL:', supabaseUrl ? 'Configurado' : 'MISSING');
console.log('SUPABASE_KEY:', supabaseKey ? (supabaseKey.startsWith('eyJ') ? 'Válido (JWT)' : 'Formato Incomum (Verificar!)') : 'MISSING');

if (!supabaseUrl || !supabaseKey) {
    console.error('ERRO: SUPABASE_URL ou SUPABASE_KEY não configurados no .env');
}

const supabase = createClient(supabaseUrl, supabaseKey);

const ASSETS_DIR = process.env.VERCEL 
    ? path.join('/tmp', 'assets') 
    : path.join(__dirname, '..', 'public', 'assets');

try {
    fs.ensureDirSync(ASSETS_DIR);
} catch (e) {
    console.warn('Aviso: Não foi possível criar ASSETS_DIR:', e.message);
}

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
        res.status(500).json({ error: 'Erro ao carregar dados do Supabase: ' + error.message });
    }
});

app.post('/api/upload-pdf', upload.single('pdf'), async (req, res) => {
    if (!req.file) {
        console.error('Erro: Nenhum arquivo enviado.');
        return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    }

    console.log(`\n--- Novo PDF recebido: ${req.file.originalname} (${req.file.size} bytes) ---`);

    try {
        const globalCoupon = req.body.coupon || "";
        const dataBuffer = fs.readFileSync(req.file.path);
        
        console.log('Iniciando PDFParse...');
        const parser = new PDFParse(new Uint8Array(dataBuffer));
        
        const [textResult, imageResult] = await Promise.all([
            parser.getText().catch(e => { console.error('Erro ao extrair texto:', e); return { pages: [] }; }),
            parser.getImage({ imageDataUrl: true }).catch(e => { console.error('Erro ao extrair imagens:', e); return { pages: [] }; })
        ]);

        if (!textResult || !textResult.pages || textResult.pages.length === 0) {
            throw new Error('Não foi possível extrair texto do PDF. O arquivo pode estar vazio ou protegido.');
        }

        const totalPages = Math.min(textResult.pages.length, 20); 
        console.log(`Processando ${totalPages} páginas sequencialmente...`);

        const newPromos = [];

        // Processamento SEQUENCIAL para evitar estouro de memória e timeouts
        for (let i = 0; i < totalPages; i++) {
            console.log(`> Processando página ${i + 1}/${totalPages}...`);
            const page = textResult.pages[i];
            const pageText = page.text || "";
            const pageImages = (imageResult && imageResult.pages && imageResult.pages[i]) ? imageResult.pages[i].images : [];

            const urlRegex = /(https?:\/\/[^\s]+)/g;
            const uniqueLinks = [...new Set(pageText.match(urlRegex) || [])];

            if (uniqueLinks.length === 0) {
                console.log(`  Página ${i + 1}: Nenhum link encontrado.`);
                continue;
            }

            let productImage = "assets/placeholder.png";
            if (pageImages.length > 0) {
                try {
                    const img = pageImages[0];
                    const imgName = `promo_${Date.now()}_p${i}_${Math.random().toString(36).substr(2, 5)}.png`;
                    
                    let buffer;
                    if (img.data.startsWith('data:')) {
                        const base64Data = img.data.replace(/^data:image\/\w+;base64,/, "");
                        buffer = Buffer.from(base64Data, 'base64');
                    } else {
                        buffer = Buffer.from(img.data);
                    }

                    console.log(`  Página ${i + 1}: Fazendo upload da imagem para Supabase...`);
                    const { data: uploadData, error: uploadError } = await supabase.storage
                        .from('promos')
                        .upload(imgName, buffer, { contentType: 'image/png', upsert: true });

                    if (!uploadError) {
                        const { data: { publicUrl } } = supabase.storage.from('promos').getPublicUrl(imgName);
                        productImage = publicUrl;
                    } else {
                        console.warn(`  Aviso: Falha no upload da imagem p${i}:`, uploadError.message);
                    }
                } catch (e) { console.error(`  Erro ao processar imagem p${i}:`, e); }
            }

            const priceRegex = /R\$\s?(\d+[\d.,]*)/g;
            const priceMatches = pageText.match(priceRegex);
            const price = priceMatches ? priceMatches[priceMatches.length - 1] : "Consulte no site";

            const lines = pageText.split('\n').map(l => l.trim()).filter(l => l.length > 5);
            const potentialNames = lines.filter(l => !l.includes('http') && !l.includes('R$') && !l.toUpperCase().includes('CUPOM'));
            const name = potentialNames.length > 0 ? potentialNames[0] : `Produto da Página ${i + 1}`;

            uniqueLinks.forEach(url => {
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
            });
        }

        if (newPromos.length > 0) {
            console.log(`Salvando ${newPromos.length} anúncios no Supabase...`);
            const { error: dbError } = await supabase.from('promos').insert(newPromos);
            if (dbError) throw new Error(`Erro no Banco de Dados: ${dbError.message}`);
        }

        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

        if (newPromos.length === 0) {
            console.warn('Processamento concluído: Nenhum produto extraído.');
            return res.status(422).json({ error: 'Nenhum link de produto encontrado no PDF.' });
        }

        console.log('--- PDF processado com sucesso! ---\n');
        res.json({ message: 'Sucesso!', count: newPromos.length });
    } catch (error) {
        console.error('ERRO NO PROCESSAMENTO DO PDF:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/debug', async (req, res) => {
    try {
        const { error } = await supabase.from('promos').select('count', { count: 'exact', head: true });
        res.json({ 
            status: 'ok', 
            supabase_connected: !error, 
            error: error?.message,
            url_configured: !!process.env.SUPABASE_URL,
            key_configured: !!process.env.SUPABASE_KEY,
            key_format_ok: process.env.SUPABASE_KEY?.startsWith('eyJ')
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
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

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});

module.exports = app;
