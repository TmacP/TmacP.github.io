// Helper function to determine the relative path
function getRelativePath(file) {
    // Check if the current script is running from a subdirectory
    const pathArray = window.location.pathname.split('/');
    // If the pathArray has more than 2 parts, it means we're in a subdirectory
    if (pathArray.length > 2) {
        return `../${file}`;
    }
    return file;
}

// Load header template from external file
fetch(getRelativePath('header-template.html'))
    .then(response => response.text())
    .then(html => {
        // Create a temporary container
        const tempContainer = document.createElement('div');
        tempContainer.innerHTML = html.trim();

        // Get the template element from the temporary container
        const template = tempContainer.querySelector('template');

        // Clone the template content
        const header = document.importNode(template.content, true);

        // Adjust links based on the current location
        const basePath = getRelativePath('');
        header.querySelector('#home-link').href = `${basePath}index.html`;
        header.querySelector('#logo').src = `${basePath}image/7risten.svg`;
        header.querySelector('#about-link').href = `${basePath}index.html#about`;
        header.querySelector('#services-link').href = `${basePath}index.html#services`;
        header.querySelector('#portfolio-link').href = `${basePath}index.html#portfolio`;
        header.querySelector('#contact-link').href = `${basePath}index.html#contact`;

        // Insert the header into the header container
        const headerContainer = document.getElementById('header-container');
        headerContainer.appendChild(header);
    })
    .catch(error => {
        console.error('Error fetching header template:', error);
    });

// Load footer template from external file
fetch(getRelativePath('footer-template.html'))
    .then(response => response.text())
    .then(html => {
        // Create a temporary container
        const tempContainer = document.createElement('div');
        tempContainer.innerHTML = html.trim();

        // Get the template element from the temporary container
        const template = tempContainer.querySelector('template');

        // Clone the template content
        const footer = document.importNode(template.content, true);

        // Insert the footer into the footer container
        const footerContainer = document.getElementById('footer-container');
        footerContainer.appendChild(footer);

        // Set the current year in the footer
        const yearSpan = footerContainer.querySelector('#year');
        const currentYear = new Date().getFullYear();
        yearSpan.textContent = currentYear;
    })
    .catch(error => {
        console.error('Error fetching footer template:', error);
    });
