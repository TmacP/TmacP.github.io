 // Load header template from external file
 fetch('header-template.html')
 .then(response => response.text())
 .then(html => {
     // Create a temporary container
     const tempContainer = document.createElement('div');
     tempContainer.innerHTML = html.trim();

     // Get the template element from the temporary container
     const template = tempContainer.querySelector('template');

     // Clone the template content
     const header = document.importNode(template.content, true);

     // Insert the header into the header container
     const headerContainer = document.getElementById('header-container');
     headerContainer.appendChild(header);
 })
 .catch(error => {
     console.error('Error fetching header template:', error);
 });