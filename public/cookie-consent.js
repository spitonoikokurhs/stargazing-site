(function () {
  "use strict";

  const GA_ID = "G-C5WYY0F0Z1";
  const STORAGE_KEY = "stargazing_cookie_consent_v1";

  window.dataLayer = window.dataLayer || [];

  window.gtag =
    window.gtag ||
    function () {
      window.dataLayer.push(arguments);
    };

  // Consent Mode v2: deny everything before any Google tag loads.
  window.gtag("consent", "default", {
    analytics_storage: "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    wait_for_update: 500
  });

  window.gtag("set", "ads_data_redaction", true);

  function getSavedChoice() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      return null;
    }
  }

  function saveChoice(choice) {
    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch (error) {
      console.warn("Could not save cookie preference.", error);
    }
  }

  function loadGoogleAnalytics() {
    if (document.getElementById("stargazing-ga4-script")) {
      return;
    }

    const script = document.createElement("script");
    script.id = "stargazing-ga4-script";
    script.async = true;
    script.src =
      "https://www.googletagmanager.com/gtag/js?id=" +
      encodeURIComponent(GA_ID);

    document.head.appendChild(script);

    window.gtag("js", new Date());

    window.gtag("config", GA_ID, {
      send_page_view: true
    });
  }

  function grantConsent() {
    window.gtag("consent", "update", {
      analytics_storage: "granted",
      ad_storage: "granted",
      ad_user_data: "granted",
      ad_personalization: "granted"
    });

    saveChoice("accepted");
    loadGoogleAnalytics();
    removeBanner();
  }

  function rejectConsent() {
    window.gtag("consent", "update", {
      analytics_storage: "denied",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied"
    });

    saveChoice("rejected");
    removeBanner();
  }

  function removeBanner() {
    const banner = document.getElementById("cookie-consent-banner");

    if (banner) {
      banner.remove();
    }
  }

  function showBanner() {
    removeBanner();

    const isTurkish = document.documentElement.lang
      .toLowerCase()
      .startsWith("tr");

    const text = isTurkish
      ? {
          title: "Gizlilik tercihleri",
          message:
            "Web sitesi ziyaretlerini anlamak ve deneyimi geliştirmek için analiz araçları kullanıyoruz. Analiz yalnızca onayınızdan sonra etkinleştirilir.",
          policy: "Gizlilik Politikası",
          reject: "Gerekli olmayanları reddet",
          accept: "Tümünü kabul et"
        }
      : {
          title: "Privacy preferences",
          message:
            "We use analytics to understand website visits and improve the experience. Analytics is activated only after you consent.",
          policy: "Privacy Policy",
          reject: "Reject non-essential",
          accept: "Accept all"
        };

    const banner = document.createElement("div");
    banner.id = "cookie-consent-banner";
    banner.className = "cookie-consent-banner";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-label", text.title);

    banner.innerHTML = `
      <div class="cookie-consent-copy">
        <strong>${text.title}</strong>
        <p>${text.message}</p>
        <a href="/privacy">${text.policy}</a>
      </div>

      <div class="cookie-consent-actions">
        <button
          type="button"
          class="cookie-btn cookie-btn-secondary"
          id="cookie-reject"
        >
          ${text.reject}
        </button>

        <button
          type="button"
          class="cookie-btn cookie-btn-primary"
          id="cookie-accept"
        >
          ${text.accept}
        </button>
      </div>
    `;

    document.body.appendChild(banner);

    document
      .getElementById("cookie-reject")
      .addEventListener("click", rejectConsent);

    document
      .getElementById("cookie-accept")
      .addEventListener("click", grantConsent);
  }

  function addPrivacySettingsButton() {
    if (document.getElementById("privacy-settings-button")) {
      return;
    }

    const isTurkish = document.documentElement.lang
      .toLowerCase()
      .startsWith("tr");

    const button = document.createElement("button");
    button.type = "button";
    button.id = "privacy-settings-button";
    button.className = "privacy-settings-button";
    button.textContent = isTurkish
      ? "Gizlilik tercihleri"
      : "Privacy settings";

    button.addEventListener("click", showBanner);

    const footerTarget =
      document.querySelector("footer .container") ||
      document.querySelector(".footer") ||
      document.body;

    footerTarget.appendChild(button);
  }

  function sendAnalyticsEvent(eventName, extraParameters) {
    if (
      getSavedChoice() !== "accepted" ||
      typeof window.gtag !== "function"
    ) {
      return;
    }

    window.gtag("event", eventName, {
      event_category: "website_cta",
      page_location: window.location.href,
      page_path: window.location.pathname,
      transport_type: "beacon",
      ...(extraParameters || {})
    });
  }

  // Existing Bodrum buttons call this function directly.
  window.trackCTA = function (eventName) {
    if (window.va) {
      window.va("event", {
        name: eventName
      });
    }

    sendAnalyticsEvent(eventName);
  };

  function detectLinkType(anchor) {
    const href = (anchor.getAttribute("href") || "").trim().toLowerCase();

    if (href.startsWith("mailto:")) return "email";
    if (href.includes("wa.me/") || href.includes("whatsapp.com")) return "whatsapp";
    if (href.includes("instagram.com")) return "instagram";
    if (href.includes("linkedin.com")) return "linkedin";
    if (href.includes("facebook.com") || href.includes("fb.com")) return "facebook";
    if (href.includes("brochure") || href.endsWith(".pdf")) return "brochure";

    return null;
  }

  // Automatically name homepage/social/contact clicks that do not already
  // have an explicit trackCTA(...) handler in the HTML.
  document.addEventListener("click", function (event) {
    const anchor = event.target.closest("a[href]");
    if (!anchor) return;

    const inlineHandler = anchor.getAttribute("onclick") || "";
    if (inlineHandler.includes("trackCTA")) return;

    const linkType = detectLinkType(anchor);
    if (!linkType) return;

    const pagePrefix = window.location.pathname.includes("bodrum-hotelleri")
      ? "bodrum"
      : "homepage";

    const eventName = `${pagePrefix}_${linkType}_click`;

    if (window.va) {
      window.va("event", {
        name: eventName
      });
    }

    sendAnalyticsEvent(eventName, {
      link_type: linkType,
      link_text: (anchor.textContent || "").trim().slice(0, 100)
    });
  });

  function onReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback);
    } else {
      callback();
    }
  }

  onReady(function () {
    const savedChoice = getSavedChoice();

    addPrivacySettingsButton();

    if (savedChoice === "accepted") {
      window.gtag("consent", "update", {
        analytics_storage: "granted",
        ad_storage: "granted",
        ad_user_data: "granted",
        ad_personalization: "granted"
      });

      loadGoogleAnalytics();
      return;
    }

    if (savedChoice === "rejected") {
      return;
    }

    showBanner();
  });
})();
