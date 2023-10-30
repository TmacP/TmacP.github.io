function toggleContainer(button, container, scriptToLoad) {
    button.addEventListener('click', () => {
        if (container.style.display === 'none') {
            greetingContainer.style.display = 'none';
            container.style.display = 'block';

            // Check if the script should be loaded
            if (scriptToLoad) {
                const script = document.createElement('script');
                script.src = scriptToLoad;
                document.head.appendChild(script);
            }
        } else {
            container.style.display = 'none';
        }
    });
}

toggleContainer(togglePlayerButton, playerContainer);
toggleContainer(toggleFormButton, formContainer);
toggleContainer(toggleLinkButton, linkContainer);
toggleContainer(toggleAboutButton, aboutContainer);
toggleContainer(toggleGameButton, gameContainer, 'canvas.js'); // Load "canvas.js" when game container is displayed
