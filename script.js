const menuToggle = document.querySelector('.menu-toggle');
const siteNav = document.querySelector('#site-nav');

menuToggle?.addEventListener('click', () => {
  const isOpen = siteNav.classList.toggle('open');
  menuToggle.setAttribute('aria-expanded', String(isOpen));
  menuToggle.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
});

document.querySelectorAll('.site-nav a').forEach((link) => link.addEventListener('click', () => {
  siteNav.classList.remove('open');
  menuToggle?.setAttribute('aria-expanded', 'false');
  menuToggle?.setAttribute('aria-label', 'Open navigation');
}));

async function loadEditableContent() {
  try {
    const response = await fetch('/api/content');
    if (!response.ok) return;
    const content = await response.json();
    const fields = { hero_intro: '#hero-intro', about_lead: '#about-lead', about_body: '#about-body', services_intro: '#services-intro', contact_intro: '#contact-intro' };
    Object.entries(fields).forEach(([key, selector]) => { if (content[key] && document.querySelector(selector)) document.querySelector(selector).textContent = content[key]; });
  } catch { /* The source copy remains available if the API is temporarily unavailable. */ }
}
loadEditableContent();

const motionTargets = document.querySelectorAll('.section-kicker, .hero-copy > *, .hero-visual, .quick-strip > div, .about-grid > *, .about-callout, .service-card, .portfolio-card, .testimonial-card, .process-step, .quote-intro > *, .quote-form, .contact-copy > *, .contact-details > *, .site-footer > *');
motionTargets.forEach((element, index) => {
  element.dataset.reveal = '';
  element.style.setProperty('--reveal-delay', `${Math.min(index % 6, 5) * 70}ms`);
});
if ('IntersectionObserver' in window) {
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.14, rootMargin: '0px 0px -8% 0px' });
  motionTargets.forEach((element) => revealObserver.observe(element));
} else {
  motionTargets.forEach((element) => element.classList.add('is-visible'));
}

const quoteForm = document.querySelector('#quote-form');
const formSuccess = document.querySelector('#form-success');
quoteForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(quoteForm);
  const values = Object.fromEntries(data.entries());
  const message = [
    'Hello Ndlovu Contractors, I would like to request a quote.', '',
    `Name: ${values.name}`, `Phone / WhatsApp: ${values.phone}`, `Email: ${values.email || 'Not provided'}`,
    `Project type: ${values.project}`, `Location: ${values.location}`, `Preferred start date: ${values.start || 'Not provided'}`, '',
    `Project details: ${values.details}`
  ].join('\n');
  const button = quoteForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const saved = await fetch('/api/enquiries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
    if (!saved.ok) throw new Error('Could not save enquiry');
    formSuccess.textContent = 'Your enquiry is saved. WhatsApp will open in a new tab.';
  } catch {
    formSuccess.textContent = 'WhatsApp will open, but the inbox could not be reached. Please send the message directly.';
  } finally {
    button.disabled = false;
    window.open(`https://wa.me/27814881115?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
  }
});

document.querySelector('#year').textContent = new Date().getFullYear();
