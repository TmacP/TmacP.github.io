// Load header template from external file
fetch('header-template.html')
    .then(response => response.text())
    .then(html => {
        // Create a temporary container
        const tempContainer = document.createElement('div');
        tempContainer.innerHTML = html.trim();

        // Get the header element from the temporary container
        const header = tempContainer.querySelector('header');
        
        // Insert the header into the header container in index.html
        const headerContainer = document.getElementById('header-container');
        headerContainer.appendChild(header);
    })
    .catch(error => {
        console.error('Error fetching header template:', error);
    });
