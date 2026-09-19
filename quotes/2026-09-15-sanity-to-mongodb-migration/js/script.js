// js/scripts.js

document.addEventListener('DOMContentLoaded', () => {
    // Universal Tab Functionality
    const tabButtons = document.querySelectorAll('.tab-button');
    if (tabButtons.length > 0) {
        const tabContents = document.querySelectorAll('.tab-content');

        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const tabId = button.getAttribute('data-tab');

                // Remove active class from all buttons and contents
                tabButtons.forEach(btn => btn.classList.remove('active'));
                tabContents.forEach(content => content.classList.remove('active'));

                // Add active class to clicked button and corresponding content
                button.classList.add('active');
                document.getElementById(tabId).classList.add('active');
            });
        });
    }

    // Universal Filter Functionality (for sanity-doc)
    const filterButtons = document.querySelectorAll('.filter-button');
    if (filterButtons.length > 0) {
        const schemaCards = document.querySelectorAll('.schema-card');

        filterButtons.forEach(button => {
            button.addEventListener('click', function () {
                const filter = this.getAttribute('data-filter');

                filterButtons.forEach(btn => btn.classList.remove('active'));
                this.classList.add('active');

                schemaCards.forEach(card => {
                    if (filter === 'all') {
                        card.classList.remove('hidden');
                    } else {
                        if (card.getAttribute('data-type') === filter) {
                            card.classList.remove('hidden');
                        } else {
                            card.classList.add('hidden');
                        }
                    }
                });
            });
        });
    }

    // Optional: Add smooth scrolling for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            document.querySelector(this.getAttribute('href')).scrollIntoView({
                behavior: 'smooth'
            });
        });
    });
});