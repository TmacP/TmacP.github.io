function toggleContainer(button, container, scriptToLoad) {
    button.addEventListener('click', () => {
        if (container.style.display === 'block') { // Check if the container is already displayed
            // Set the landing container to block
            landingContainer.style.display = 'block';
            playerContainer.style.display = 'none';
            formContainer.style.display = 'none';
            linkContainer.style.display = 'none';
            aboutContainer.style.display = 'none';
        } else if (container.style.display === 'none') {
            // Hide all other containers
            playerContainer.style.display = 'none';
            formContainer.style.display = 'none';
            linkContainer.style.display = 'none';
            aboutContainer.style.display = 'none';
            // Hide the landing container
            landingContainer.style.display = 'none';

            // Set the selected container to block
            container.style.display = 'block';

            // Scroll to the container 
            container.scrollIntoView({ behavior: 'smooth' });

            // Check if the script should be loaded
            if (scriptToLoad) {
                const script = document.createElement('script');
                script.src = scriptToLoad;
                document.head.appendChild(script);
            }
        } else {
            // Hide the container if it's already displayed
            container.style.display = 'none';
        }
    });
}

toggleContainer(togglePlayerButton, playerContainer);
toggleContainer(toggleFormButton, formContainer);
toggleContainer(toggleLinkButton, linkContainer);
toggleContainer(toggleAboutButton, aboutContainer);

