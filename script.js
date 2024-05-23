function toggleContainer(button, container, scriptToLoad) {
    button.addEventListener('click', () => {
        if (container.style.display === 'none') {
// make container display none so only the open one is visabile
	playerContainer.style.display = 'none';
    	formContainer.style.display = 'none';
    	linkContainer.style.display = 'none';
    	aboutContainer.style.display = 'none';
	// set the one selected to block            
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
            container.style.display = 'none';
        }
    });
}

toggleContainer(togglePlayerButton, playerContainer);
toggleContainer(toggleFormButton, formContainer);
toggleContainer(toggleLinkButton, linkContainer);
toggleContainer(toggleAboutButton, aboutContainer);
