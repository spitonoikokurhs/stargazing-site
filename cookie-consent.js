(function () {
  'use strict';

  const CONSENT_KEY = 'stargazing_cookie_consent';

  function updateGoogleConsent(status) {
    if (typeof window.gtag !== 'function') return;

    const granted = status === 'accepted' ? 'granted' : 'denied';
    window.gtag('consent', 'update', {
      analytics_storage: granted,
      ad_storage: granted,
      ad_user_data: granted,
      ad_personalization: granted
    });
  }

  function saveConsent(status) {
    try {
      localStorage.setItem(CONSENT_KEY, status);
    } catch (error) {
      // Continue without persistence if storage is unavailable.
    }
    updateGoogleConsent(status);
  }

  function closeBanner() {
    const banner = document.getElementById('cookie-consent-banner');
    if (banner) banner.remove();
  }

  function createBanner() {
    const banner = document.createElement('div');
    banner.id = 'cookie-consent-banner';
    banner.className = 'cookie-consent-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Cookie preferences');
    banner.innerHTML = `
      <div class="cookie-consent-copy">
        <strong>Privacy preferences</strong>
        <p>We use analytics to understand website visits and improve Stargazing Events. Advertising measurement will only be used after consent.</p>
        <a href="/privacy.html">Privacy Policy</a>
      </div>
      <div class="cookie-consent-actions">
        <button type="button" class="cookie-btn cookie-btn-secondary" data-cookie-choice="rejected">Reject non-essential</button>
        <button type="button" class="cookie-btn cookie-btn-primary" data-cookie-choice="accepted">Accept all</button>
      </div>
    `;

    banner.addEventListener('click', function (event) {
      const button = event.target.closest('[data-cookie-choice]');
      if (!button) return;
      saveConsent(button.dataset.cookieChoice);
      closeBanner();
    });

    document.body.appendChild(banner);
  }

  window.trackCTA = function (eventName) {
    if (window.va) {
      window.va('event', { name: eventName });
    }
    if (typeof window.gtag === 'function') {
      window.gtag('event', eventName, {
        event_category: 'website_cta',
        page_location: window.location.href
      });
    }
  };

  document.addEventListener('DOMContentLoaded', function () {
    let savedConsent = null;
    try {
      savedConsent = localStorage.getItem(CONSENT_KEY);
    } catch (error) {
      savedConsent = null;
    }

    if (savedConsent === 'accepted' || savedConsent === 'rejected') {
      updateGoogleConsent(savedConsent);
      return;
    }

    createBanner();
  });
})();
