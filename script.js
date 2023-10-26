const togglePlayerButton = document.getElementById('togglePlayerButton');
const toggleFormButton = document.getElementById('toggleFormButton');
const toggleLinkButton = document.getElementById('toggleLinkButton');
const toggleAboutButton = document.getElementById('toggleAboutButton');

const playerContainer = document.getElementById('playerContainer');
const formContainer = document.getElementById('formContainer');
const linkContainer = document.getElementById('linkContainer');
const aboutContainer = document.getElementById('aboutContainer');

togglePlayerButton.addEventListener('click', () => {
    if (playerContainer.style.display === 'none') {
        playerContainer.style.display = 'block';
    } else {
        playerContainer.style.display = 'none';
    }
});

toggleFormButton.addEventListener('click', () => {
    if (formContainer.style.display === 'none') {
        formContainer.style.display = 'block';
    } else {
        formContainer.style.display = 'none';
    }
});

toggleLinkButton.addEventListener('click', () => {
    if (linkContainer.style.display === 'none') {
        linkContainer.style.display = 'block';
    } else {
        linkContainer.style.display = 'none';
    }
});

toggleAboutButton.addEventListener('click', () => {
    if (aboutContainer.style.display === 'none') {
        aboutContainer.style.display = 'block';
    } else {
        aboutContainer.style.display = 'none';
    }
});

