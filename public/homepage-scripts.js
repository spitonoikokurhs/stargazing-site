const filterButtons = document.querySelectorAll('.gallery-filters button');
const galleryItems = document.querySelectorAll('#galleryGrid .gallery-card');

filterButtons.forEach(button => {
  button.addEventListener('click', () => {
    filterButtons.forEach(b => b.classList.remove('active'));
    button.classList.add('active');
    const filter = button.dataset.filter;

    galleryItems.forEach(item => {
      const categories = item.dataset.category.split(' ');
      item.style.display = (filter === 'all' || categories.includes(filter)) ? '' : 'none';
    });
  });
});

const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightboxImg');
const lightboxCaption = document.getElementById('lightboxCaption');

document.getElementById('galleryGrid').addEventListener('click', (event) => {
  const card = event.target.closest('.gallery-card');
  if (!card) return;
  const img = card.querySelector('img');
  const caption = card.querySelector('figcaption');

  lightboxImg.src = img.src;
  lightboxImg.alt = img.alt;
  lightboxCaption.textContent = caption ? caption.textContent : '';
  lightbox.classList.add('open');
});

lightbox.addEventListener('click', () => {
  lightbox.classList.remove('open');
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') lightbox.classList.remove('open');
});

// Mobile menu: close it after a nav choice. The menu itself is CSS-only (a
// checkbox toggle), which can't know a link was tapped — so this un-checks it
// on navigation, so tapping a link scrolls to the section AND closes the menu
// (leaving it open would cover the section you just jumped to). Also closes on
// Escape and on a tap outside the header. Guarded so it's a no-op if the toggle
// isn't present.
const navToggle = document.getElementById('nav-toggle');
if (navToggle) {
  const closeMenu = () => { navToggle.checked = false; };

  // Any link inside the header nav closes the menu when tapped.
  document.querySelectorAll('header nav a').forEach((link) => {
    link.addEventListener('click', closeMenu);
  });

  // Escape closes the menu too.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });

  // Tap outside the header (on the page) closes an open menu.
  document.addEventListener('click', (event) => {
    if (navToggle.checked && !event.target.closest('header')) closeMenu();
  });
}
