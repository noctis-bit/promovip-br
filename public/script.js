document.addEventListener('DOMContentLoaded', () => {
    const offersGrid = document.querySelector('.offers-grid');
    const couponGrid = document.querySelector('.cupons-grid');
    const yearSpan = document.getElementById('year');
    if (yearSpan) yearSpan.textContent = new Date().getFullYear();

    let allPromos = [];

    const diceTrigger = document.getElementById('diceTrigger');
    const dice = document.getElementById('dice');

    if (diceTrigger) {
        diceTrigger.addEventListener('click', rollDice);
    }

    function rollDice() {
        const today = new Date().toDateString();
        const lastRoll = localStorage.getItem('lastDiceRoll');
        
        // MODO SECRETO: Se o URL tiver ?admin=true, ativa giros infinitos para este navegador
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('admin') === 'true') localStorage.setItem('promo_admin', 'true');
        
        const isAdmin = localStorage.getItem('promo_admin') === 'true';

        if (lastRoll === today && !isAdmin) {
            alert('🎲 Você já usou seu giro da sorte hoje! Volte amanhã para ganhar uma nova oferta secreta.');
            return;
        }

        if (!allPromos || allPromos.length === 0) {
            alert('Aguarde as ofertas carregarem...');
            return;
        }

        diceTrigger.style.pointerEvents = 'none';
        dice.style.animation = 'none'; // Para o idle
        
        // Gera rotações aleatórias massivas para efeito 3D real
        const xRand = Math.floor(Math.random() * 10 + 10) * 90;
        const yRand = Math.floor(Math.random() * 10 + 10) * 90;
        
        dice.style.transform = `rotateX(${xRand}deg) rotateY(${yRand}deg)`;
        dice.classList.add('glow');

        // Escolhe uma promo aleatória
        const randomPromo = allPromos[Math.floor(Math.random() * allPromos.length)];

        setTimeout(() => {
            dice.classList.remove('glow');
            localStorage.setItem('lastDiceRoll', today);
            
            if (randomPromo.affiliateLink && randomPromo.affiliateLink !== '#') {
                // Redirecionamento direto na mesma aba
                window.location.href = randomPromo.affiliateLink;
            } else {
                alert('A sorte te levou para: ' + randomPromo.name);
            }
            
            // Volta para a animação idle após um tempo
            setTimeout(() => {
                dice.style.animation = 'dice-idle 15s infinite linear';
                diceTrigger.style.pointerEvents = 'auto';
            }, 2000);
            
        }, 1200);
    }

    // Carregar dados iniciais
    loadContent();

    // --- BUSCA INTELIGENTE (REAL-TIME) ---
    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');

    if (searchBtn) searchBtn.addEventListener('click', performSearch);
    if (searchInput) {
        // Busca enquanto digita para ser instantânea
        searchInput.addEventListener('input', performSearch);
        searchInput.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') performSearch();
        });
    }

    function performSearch() {
        const query = (searchInput.value || '').toLowerCase().trim();
        
        if (!query) {
            renderPromos(allPromos);
            return;
        }

        // Divide a busca em palavras (Ex: "batom amazon" vira ["batom", "amazon"])
        const keywords = query.split(/\s+/);

        const filtered = allPromos.filter(p => {
            const content = `${p.name} ${p.category || 'Geral'} ${p.store || 'Loja Parceira'}`.toLowerCase();
            // Verifica se TODAS as palavras digitadas existem no produto (Lógica E)
            return keywords.every(key => content.includes(key));
        });

        renderPromos(filtered);
    }

    async function loadContent() {
        try {
            const res = await fetch('/api/promos');
            const data = await res.json();

            if (data.promos && data.promos.length > 0) {
                allPromos = data.promos;
                renderPromos(allPromos);
            }

            if (data.coupons && data.coupons.length > 0) {
                couponGrid.innerHTML = '';
                data.coupons.forEach(cp => {
                    const id = 'cp-' + Math.random().toString(36).substr(2, 9);
                    const card = document.createElement('div');
                    card.className = 'coupon-card';
                    card.innerHTML = `
                        <div class="coupon-logo">🎟️</div>
                        <div class="coupon-info">
                            <div class="coupon-store">${cp.store}</div>
                            <div class="coupon-desc">${cp.desc || 'Cupom exclusivo'}</div>
                            <div class="coupon-code-box">
                                <span class="coupon-code" id="${id}">${cp.code}</span>
                                <button class="btn-copy" onclick="copyCoupon('${id}')">Copiar</button>
                            </div>
                        </div>
                        <div class="coupon-value">${cp.value}</div>
                    `;
                    couponGrid.appendChild(card);
                });
            }
        } catch (error) {
            console.error('Erro ao carregar conteúdo:', error);
        }
    }

    function renderPromos(promos) {
        offersGrid.innerHTML = '';
        if (promos.length === 0) {
            offersGrid.innerHTML = '<div class="no-results" style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--gray);">Nenhuma promoção encontrada nesta categoria.</div>';
            return;
        }
        promos.forEach(promo => {
            offersGrid.appendChild(createProductCard(promo));
        });
    }

    window.filterByCategory = (category) => {
        console.log('Filtrando por:', category);
        if (category === 'Todas') {
            renderPromos(allPromos);
        } else {
            const filtered = allPromos.filter(p => (p.category || 'Geral') === category);
            renderPromos(filtered);
        }
        
        // Scroll suave para a seção de ofertas
        const offersSection = document.getElementById('ofertas');
        if (offersSection) {
            offersSection.scrollIntoView({ behavior: 'smooth' });
        }
    };

    function createProductCard(promo) {
        const article = document.createElement('article');
        article.className = 'product-card';
        
        // Termo de busca limpo (3 primeiras palavras)
        const cleanName = promo.name.replace(/[^\w\s]/gi, '');
        const searchTerm = encodeURIComponent(cleanName.split(' ').slice(0, 3).join(' '));
        
        // Detecta se a imagem é inválida ou placeholder
        const imgVal = String(promo.image).toLowerCase();
        const isPlaceholder = !promo.image || imgVal.includes('placeholder') || imgVal.includes('ninja') || imgVal === 'null' || imgVal === 'undefined' || imgVal === '';
        
        // Se for inválida, já começa com o fallback do LoremFlickr
        const imageSrc = !isPlaceholder ? promo.image : `https://loremflickr.com/800/800/${searchTerm},product`;

        article.innerHTML = `
            <div class="discount-badge">${promo.discount}</div>
            <div class="category-tag">${promo.category || 'Geral'}</div>
            <div class="card-image">
                <img src="${imageSrc}" 
                     alt="${promo.name}" 
                     data-link="${promo.affiliateLink || '#'}"
                     data-term="${searchTerm}"
                     onerror="handleImageError(this)">
            </div>
            <div class="card-content">
                <div class="promo-store">${promo.store || 'Loja Parceira'}</div>
                <h2 class="product-name">${promo.name}</h2>
                <div class="price-container">
                    <div class="price-row">
                        <span class="current-price">R$ ${(promo.currentPrice || "Consulte").replace('R$', '').trim()}</span>
                        <span class="old-price">${promo.oldPrice || ""}</span>
                    </div>
                    <div class="urgency-text">⚡ ${promo.urgency}</div>
                </div>
                <a href="${promo.affiliateLink}" class="promo-btn featured" target="_blank" rel="noopener noreferrer">Pegar Oferta</a>
            </div>
        `;
        return article;
    }
});

// FUNÇÃO DE ERRO REFEITA (Sincrona que chama assíncrona)
function handleImageError(img) {
    if (img.dataset.handlingError) return;
    img.dataset.handlingError = 'true';

    const term = img.dataset.term || 'product';
    const link = img.dataset.link;

    console.log(`Iniciando recuperação de imagem para: ${term}`);

    // 1. Tenta o Image Finder (Busca no link da loja)
    if (link && link !== '#' && !img.dataset.triedScraper) {
        img.dataset.triedScraper = 'true';
        fetch(`/api/image-finder?url=${encodeURIComponent(link)}`)
            .then(res => res.json())
            .then(data => {
                if (data.image) {
                    img.src = data.image;
                    img.dataset.handlingError = ''; // Reset para permitir novos erros se o scraper falhar
                } else {
                    tryNextFallback(img, term);
                }
            })
            .catch(() => tryNextFallback(img, term));
    } else {
        tryNextFallback(img, term);
    }
}

function tryNextFallback(img, term) {
    console.log('Recuperação falhou, usando placeholder oficial.');
    img.onerror = null;
    img.src = 'assets/placeholder.png';
    img.dataset.handlingError = 'true';
}

function copyCoupon(id) {
    const couponElement = document.getElementById(id);
    const couponText = couponElement.innerText;
    navigator.clipboard.writeText(couponText).then(() => {
        const btn = event.target;
        const originalText = btn.innerText;
        btn.innerText = 'Copiado!';
        btn.style.color = '#fff';
        btn.style.backgroundColor = 'var(--red)';
        setTimeout(() => {
            btn.innerText = originalText;
            btn.style.backgroundColor = '';
            btn.style.color = '';
        }, 2000);
    });
}
