const filterButtons = document.querySelectorAll('.gallery-filters button');
const galleryItems = document.querySelectorAll('#galleryGrid .gallery-card-3col');

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

document.getElementById('galleryGrid').addEventListener('click', event => {
  const card = event.target.closest('.gallery-card-3col');
  if (!card) return;
  const img = card.querySelector('img');
  const caption = card.querySelector('figcaption');

  lightboxImg.src = img.src;
  lightboxImg.alt = img.alt;
  lightboxCaption.textContent = caption ? caption.textContent : '';
  lightbox.classList.add('open');
});

lightbox.addEventListener('click', () => lightbox.classList.remove('open'));

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') lightbox.classList.remove('open');
});
