document.addEventListener('DOMContentLoaded', function() {
    // Update the year dynamically
    document.getElementById('year').innerHTML = new Date().getFullYear();
    
    // Add event listener for the form submission
    document.getElementById('contactForm').addEventListener('submit', handleSubmit);

    // Create an IntersectionObserver instance
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
            } else {
                entry.target.classList.remove('visible');
            }
        });
    });

    // Observe all elements with the class 'hidden'
    const hiddenElements = document.querySelectorAll('.hidden');
    hiddenElements.forEach((element) => {
        observer.observe(element);
    });
});

// Define the handleSubmit function
function handleSubmit(event) {
    event.preventDefault();
    // Your form submission logic here
    console.log("Form submitted!");
}
