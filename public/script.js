document.addEventListener('DOMContentLoaded', () => {
    // Atualiza o ano no rodapé automaticamente
    const yearSpan = document.getElementById('year');
    if (yearSpan) {
        yearSpan.textContent = new Date().getFullYear();
    }

    // Smooth scroll para âncoras
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });

    // --- CARREGAR PROMOÇÕES ---
    async function loadPromos() {
        const grid = document.querySelector('.offers-grid');
        try {
            const response = await fetch('/api/promos');
            const data = await response.json();
            
            if (data.promos && data.promos.length > 0) {
                grid.innerHTML = ''; // Limpa os estáticos
                data.promos.forEach(promo => {
                    const card = createProductCard(promo);
                    grid.appendChild(card);
                });
                observeCards();
            }
        } catch (error) {
            console.error('Erro ao carregar promoções:', error);
        }
    }

    function createProductCard(promo) {
        const article = document.createElement('article');
        article.className = 'product-card';
        // Geramos um termo de busca limpo para a imagem de fallback
        const searchTerm = encodeURIComponent(promo.name.split(' ').slice(0, 3).join(' '));
        
        article.innerHTML = `
            <div class="discount-badge">${promo.discount}</div>
            <div class="card-image">
                <img src="${promo.image}" 
                     alt="${promo.name}" 
                     onerror="handleImageError(this, '${searchTerm}')">
            </div>
            <div class="card-content">
                <div class="promo-store">${promo.store || 'Loja Parceira'}</div>
                <h2 class="product-name">${promo.name}</h2>
                <div class="price-container">
                    <div class="price-row">
                        <span class="current-price">R$ ${promo.currentPrice.replace('R$', '').trim()}</span>
                        <span class="old-price">${promo.oldPrice}</span>
                    </div>
                    <div class="urgency-text">⚡ ${promo.urgency}</div>
                </div>
                <a href="${promo.affiliateLink}" class="promo-btn featured" target="_blank" rel="noopener noreferrer">Pegar Oferta</a>
            </div>
        `;
        return article;
    }

    // --- CARREGAR CUPONS ---
    async function loadCoupons() {
        const couponGrid = document.querySelector('.coupons-grid');
        if (!couponGrid) return;

        try {
            const response = await fetch('/api/coupons');
            const coupons = await response.json();

            if (coupons && coupons.length > 0) {
                couponGrid.innerHTML = '';
                coupons.forEach((cp, index) => {
                    const id = `cupom_dynamic_${index}`;
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
            console.error('Erro ao carregar cupons');
        }
    }

    function observeCards() {
        const cards = document.querySelectorAll('.product-card');
        const observerOptions = { threshold: 0.1 };

        const cardObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach((entry, index) => {
                if (entry.isIntersecting) {
                    setTimeout(() => {
                        entry.target.style.opacity = '1';
                        entry.target.style.transform = 'translateY(0)';
                    }, index * 100);
                    observer.unobserve(entry.target);
                }
            });
        }, observerOptions);

        cards.forEach(card => {
            card.style.opacity = '0';
            card.style.transform = 'translateY(20px)';
            card.style.transition = 'opacity 0.6s ease-out, transform 0.6s ease-out';
            cardObserver.observe(card);
        });
    }

    loadPromos();
    loadCoupons();

    // --- NEWSLETTER ---
    const newsletterWidget = document.getElementById('newsletterWidget');
    const closeNewsletter = document.getElementById('closeNewsletter');
    const newsletterForm = document.getElementById('newsletterForm');

    if (closeNewsletter) {
        closeNewsletter.addEventListener('click', () => {
            newsletterWidget.style.display = 'none';
        });
    }

    if (newsletterForm) {
        newsletterForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const email = newsletterForm.querySelector('input').value;
            alert(`Obrigado! O e-mail ${email} foi cadastrado.`);
            newsletterWidget.style.display = 'none';
            newsletterForm.reset();
        });
    }

    setTimeout(() => {
        if (newsletterWidget) {
            newsletterWidget.classList.add('active');
        }
    }, 5000);

    // --- MODO ESCURO / CLARO ---
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
        });
    }
});

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

// Função de Fallback Inteligente para Imagens
function handleImageError(img, term) {
    // Evita loop infinito se a imagem de fallback também falhar
    if (img.dataset.triedFallback) {
        img.src = 'assets/placeholder.png'; // Placeholder final se tudo falhar
        return;
    }
    
    img.dataset.triedFallback = 'true';
    // Busca uma imagem aleatória relacionada ao nome do produto
    img.src = `https://loremflickr.com/800/800/${term}`;
    
    console.log(`Imagem original falhou. Buscando fallback para: ${term}`);
}
