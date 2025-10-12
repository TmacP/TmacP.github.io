// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', function() {
    // Update the year dynamically in footer
    const yearElement = document.getElementById('year');
    if (yearElement) {
        yearElement.textContent = new Date().getFullYear();
    }

    // Smooth scrolling for navigation links
    const navLinks = document.querySelectorAll('nav a[href^="#"], .cta-button[href^="#"], footer a[href^="#"]');
    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const targetId = this.getAttribute('href');
            const targetElement = document.querySelector(targetId);
            
            if (targetElement) {
                targetElement.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });

    // Back to top button functionality
    const backToTopButton = document.getElementById('backToTop');
    
    // Show/hide back to top button based on scroll position
    function toggleBackToTopButton() {
        if (window.pageYOffset > 300) {
            backToTopButton.classList.add('visible');
        } else {
            backToTopButton.classList.remove('visible');
        }
    }
    
    // Back to top click handler
    backToTopButton.addEventListener('click', function() {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });

    // Listen for scroll events
    window.addEventListener('scroll', toggleBackToTopButton);

    // Intersection Observer for fade-in animations
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
            }
        });
    }, observerOptions);

    // Add fade-in class to elements and observe them
    const animateElements = document.querySelectorAll('.skill-item, .portfolio-item, .contact-item, .principles-section');
    animateElements.forEach((element, index) => {
        element.classList.add('fade-in');
        // Add slight delay for stagger effect
        element.style.transitionDelay = `${index * 0.1}s`;
        observer.observe(element);
    });

    // Portfolio embed loading optimization
    const portfolioEmbeds = document.querySelectorAll('.portfolio-embed iframe');
    portfolioEmbeds.forEach(iframe => {
        // Add loading="lazy" if not already present
        if (!iframe.hasAttribute('loading')) {
            iframe.setAttribute('loading', 'lazy');
        }
        
        // Add error handling
        iframe.addEventListener('error', function() {
            console.log('Failed to load iframe:', this.src);
            const fallbackDiv = document.createElement('div');
            fallbackDiv.innerHTML = `
                <div style="padding: 2rem; text-align: center; background-color: var(--body-color); border-radius: 8px;">
                    <p>Content temporarily unavailable</p>
                    <a href="${this.src}" target="_blank" rel="noopener">View in new tab</a>
                </div>
            `;
            this.parentNode.replaceChild(fallbackDiv, this);
        });
    });

    // Active navigation highlighting
    function highlightActiveNavItem() {
        const sections = document.querySelectorAll('section[id]');
        const navItems = document.querySelectorAll('nav a[href^="#"]');
        
        let currentSection = '';
        
        sections.forEach(section => {
            const rect = section.getBoundingClientRect();
            if (rect.top <= 100 && rect.bottom >= 100) {
                currentSection = section.id;
            }
        });
        
        navItems.forEach(item => {
            item.classList.remove('active');
            if (item.getAttribute('href') === `#${currentSection}`) {
                item.classList.add('active');
            }
        });
    }

    // Throttled scroll handler for performance
    let scrollTimeout;
    window.addEventListener('scroll', function() {
        if (scrollTimeout) {
            clearTimeout(scrollTimeout);
        }
        scrollTimeout = setTimeout(() => {
            highlightActiveNavItem();
        }, 10);
    });

    // Handle external links
    const externalLinks = document.querySelectorAll('a[href^="http"]:not([href*="7risten.ca"])');
    externalLinks.forEach(link => {
        // Ensure external links open in new tab and have security attributes
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
        
        // Optional: Add external link indicator
        if (!link.querySelector('.external-indicator')) {
            const indicator = document.createElement('span');
            indicator.className = 'external-indicator';
            indicator.innerHTML = ' ↗';
            indicator.style.opacity = '0.7';
            indicator.style.fontSize = '0.8em';
            link.appendChild(indicator);
        }
    });

    // Keyboard navigation support
    document.addEventListener('keydown', function(e) {
        // Escape key closes any modals or returns to top
        if (e.key === 'Escape') {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
        
        // Arrow keys for section navigation
        if (e.key === 'ArrowDown' && e.altKey) {
            e.preventDefault();
            const sections = document.querySelectorAll('section[id]');
            const currentSection = getCurrentSection();
            const currentIndex = Array.from(sections).findIndex(section => section.id === currentSection);
            
            if (currentIndex < sections.length - 1) {
                sections[currentIndex + 1].scrollIntoView({ behavior: 'smooth' });
            }
        }
        
        if (e.key === 'ArrowUp' && e.altKey) {
            e.preventDefault();
            const sections = document.querySelectorAll('section[id]');
            const currentSection = getCurrentSection();
            const currentIndex = Array.from(sections).findIndex(section => section.id === currentSection);
            
            if (currentIndex > 0) {
                sections[currentIndex - 1].scrollIntoView({ behavior: 'smooth' });
            }
        }
    });

    function getCurrentSection() {
        const sections = document.querySelectorAll('section[id]');
        let currentSection = '';
        
        sections.forEach(section => {
            const rect = section.getBoundingClientRect();
            if (rect.top <= 100 && rect.bottom >= 100) {
                currentSection = section.id;
            }
        });
        
        return currentSection;
    }

    // Performance optimization: Preload important images
    const importantImages = [
        'image/7risten.svg',
        'image/portfolio.png',
        'image/desktop.svg',
        'image/tablet.svg',
        'image/phone.svg'
    ];

    importantImages.forEach(src => {
        const img = new Image();
        img.src = src;
    });

    // Contact link interactions
    const emailLinks = document.querySelectorAll('a[href^="mailto:"]');
    emailLinks.forEach(link => {
        link.addEventListener('click', function() {
            // Optional: Track email clicks or show a confirmation
            console.log('Email link clicked:', this.href);
        });
    });

    // Stop game/iframe audio when scrolling away
    const gameIframes = document.querySelectorAll('.portfolio-embed iframe');
    const iframeStates = new Map();
    
    // Store original src for each iframe
    gameIframes.forEach(iframe => {
        iframeStates.set(iframe, iframe.src);
    });
    
    // Create intersection observer for iframes
    const iframeObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const iframe = entry.target;
            const originalSrc = iframeStates.get(iframe);
            
            if (!entry.isIntersecting) {
                // Iframe is out of view - reload it to stop audio
                iframe.src = 'about:blank';
            } else if (entry.isIntersecting && iframe.src === 'about:blank') {
                // Iframe is back in view - restore original src
                iframe.src = originalSrc;
            }
        });
    }, {
        threshold: 0.1, // Trigger when 10% visible/hidden
        rootMargin: '0px'
    });
    
    // Observe all game iframes
    gameIframes.forEach(iframe => {
        iframeObserver.observe(iframe);
    });

    // Initialize everything
    highlightActiveNavItem();
    toggleBackToTopButton();
    
    console.log('7risten.ca site initialized successfully!');
});

// Handle page visibility changes (for performance)
document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
        // Page is hidden, pause any animations or timers if needed
    } else {
        // Page is visible, resume normal operations
    }
});

// Error handling for any JavaScript errors
window.addEventListener('error', function(e) {
    console.error('JavaScript error:', e.error);
    // You could send this to an error tracking service
});

// Service worker registration for potential future use
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
        // Uncomment if you add a service worker in the future
        // navigator.serviceWorker.register('/sw.js');
    });
}