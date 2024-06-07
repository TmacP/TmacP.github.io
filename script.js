document.addEventListener('DOMContentLoaded', function() {
    const toggleContainer = (button, container) => {
        button.addEventListener('click', () => {
            const containers = ['landingContainer', 'aboutContainer', 'servicesContainer', 'portfolioContainer', 'contactContainer'];
            containers.forEach(id => {
                document.getElementById(id).style.display = 'none';
            });
            container.style.display = 'block';
            container.scrollIntoView({ behavior: 'smooth' });
        });
    };

    const landingContainer = document.getElementById('landingContainer');
    const aboutContainer = document.getElementById('aboutContainer');
    const servicesContainer = document.getElementById('servicesContainer');
    const portfolioContainer = document.getElementById('portfolioContainer');
    const contactContainer = document.getElementById('contactContainer');

    toggleContainer(document.getElementById('toggleAboutButton'), aboutContainer);
    toggleContainer(document.getElementById('toggleServicesButton'), servicesContainer);
    toggleContainer(document.getElementById('togglePortfolioButton'), portfolioContainer);
    toggleContainer(document.getElementById('toggleContactButton'), contactContainer);

    document.getElementById('logo-link').addEventListener('click', function(event) {
        event.preventDefault();
        landingContainer.style.display = 'block';
        aboutContainer.style.display = 'none';
        servicesContainer.style.display = 'none';
        portfolioContainer.style.display = 'none';
        contactContainer.style.display = 'none';
    });

    document.getElementById('year').innerHTML = new Date().getFullYear();




    // Add submit event listener to the contact form
    document.getElementById('contactForm').addEventListener('submit', handleSubmit);
});
