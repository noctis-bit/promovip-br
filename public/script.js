document.addEventListener('DOMContentLoaded', () => {
    const offersGrid = document.querySelector('.offers-grid');
    const couponGrid = document.querySelector('.cupons-grid');
    const yearSpan = document.getElementById('year');
    if (yearSpan) yearSpan.textContent = new Date().getFullYear();

    // Carregar dados iniciais
    loadContent();

    async function loadContent() {
        try {
            const res = await fetch('/api/promos');
            const data = await res.json();

            if (data.promos && data.promos.length > 0) {
                offersGrid.innerHTML = '';
                data.promos.forEach(promo => {
                    offersGrid.appendChild(createProductCard(promo));
                });
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
    // 2. Tenta LoremFlickr com uma variante de busca
    if (!img.dataset.triedSmart) {
        img.dataset.triedSmart = 'true';
        img.src = `https://loremflickr.com/800/800/${term},item`;
        img.dataset.handlingError = '';
        return;
    }

    // 3. Fallback Final: Imagem de Texto Estilizada (Nunca Falha)
    if (!img.dataset.triedFinal) {
        img.dataset.triedFinal = 'true';
        const cleanTerm = decodeURIComponent(term).toUpperCase();
        img.src = `https://placehold.co/800x800/1a1a1a/e50914?text=${cleanTerm}`;
        img.dataset.handlingError = '';
    }
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
