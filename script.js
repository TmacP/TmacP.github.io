document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('year').innerHTML = new Date().getFullYear();
    document.getElementById('contactForm').addEventListener('submit', handleSubmit);
});