function toggleContainer(button, container) {
    button.addEventListener('click', () => {
        if (container.style.display === 'none') {
            greetingContainer.style.display = 'none';
            container.style.display = 'block';
        } else {
            container.style.display = 'none';
            greetingContainer.style.display = 'block';
        }
    });
}

toggleContainer(togglePlayerButton, playerContainer);
toggleContainer(toggleFormButton, formContainer);
toggleContainer(toggleLinkButton, linkContainer);
toggleContainer(toggleAboutButton, aboutContainer);
toggleContainer(toggleGameButton, gameContainer);