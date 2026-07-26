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
    // Notify consent-gated surfaces (ConsentedAnalytics, /live's poll loop) so
    // they react WITHOUT a page reload — mount analytics, attach the viewerId.
    notifyConsentChanged();
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
    // Withdrawal must propagate exactly like a grant (ePrivacy 5(3)): the same
    // notification fires so ConsentedAnalytics UNMOUNTS and /live drops the
    // viewerId. Rejecting is not a no-op for an already-consented session.
    notifyConsentChanged();
    removeBanner();
  }

  // Dispatch the consent-change signal on EVERY choice, accept or reject.
  // Fires the general "changed" event (new consumers react in both directions)
  // and, on accept only, the legacy grant-only event for back-compat. Must
  // match CONSENT_CHANGED_EVENT / CONSENT_GRANTED_EVENT in lib/consent.ts
  // (asserted by scripts/test-consent-parity.mjs).
  function notifyConsentChanged() {
    try {
      window.dispatchEvent(new Event("stargazing-consent-changed"));
      if (getSavedChoice() === "accepted") {
        window.dispatchEvent(new Event("stargazing-consent-granted"));
      }
    } catch (error) {
      // Older engines without the Event constructor: consumers still pick up
      // the stored choice on their next mount/navigation. Best-effort only.
    }
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

  // /live, the offline/status screen, and the finished/farewell screen
  // (.farewell-stage) are all an immersive, dark, full-screen experience
  // (guests are night-adapted under a real dark sky) — a persistent floating
  // button breaks that on purpose-built grounds, not just a style call. The
  // one-time consent banner (showBanner) is unaffected and still appears
  // when required elsewhere; only the always-on re-open-preferences button
  // is suppressed on these pages (the banner itself is fully hidden on the
  // farewell screen specifically via CSS — see app/cookie-consent.css).
  function isImmersivePage() {
    return !!(
      document.querySelector(".live-root") ||
      document.querySelector(".status-root") ||
      document.querySelector(".farewell-stage")
    );
  }

  // ---------------------------------------------------------------------
  // PATH EXCLUSIONS — the single place that decides where this script backs
  // off. Two tiers, deliberately different in scope:
  //
  //   startsWithPath(prefixes): tiny shared matcher — exact match or
  //   "<prefix>/…" (so "/live" matches "/live" and "/live/x", never "/livery").
  //
  //   TIER 1 — BANNER-ONLY suppression (isBannerSuppressedPath):
  //     /live*  — the immersive guest experience (dark, full-screen,
  //               night-adapted; includes /live-debug). Path-based rather than
  //               DOM-based on purpose: the immersive markers (.live-root /
  //               .farewell-stage) are client-rendered AFTER hydration — and
  //               the eclipse farewell lives in an <iframe srcDoc> and never
  //               puts a marker in this document at all — while this banner is
  //               created on DOMContentLoaded, so a DOM query would flash the
  //               banner over the farewell on a fresh QR arrival.
  //     /demo*  — the self-running sales pitches; a cookie banner mid-pitch
  //               breaks the illusion, and the demo feed is analytics-inert
  //               (see app/api/demo-status/route.ts).
  //     Everything ELSE still runs: a previously-accepted guest still gets GA,
  //     and consent stays intact — analytics remain denied until acceptance,
  //     and the banner still appears on every normal page.
  //
  //   TIER 2 — FULL skip (isOperatorPath, checked first in onReady):
  //     /season* — the private, noindex operator calendar. Not a guest surface
  //     at all, so nothing here should run: no banner, no floating settings
  //     button, and no GA load even for an accepted choice — operator archive
  //     reading is not guest analytics (and the banner physically overlays the
  //     data tables).
  //
  // Adding a future exclusion = one line in the right tier's list below.
  // ---------------------------------------------------------------------
  function startsWithPath(prefixes) {
    var path = (window.location && window.location.pathname) || "";
    for (var i = 0; i < prefixes.length; i++) {
      if (path === prefixes[i] || path.indexOf(prefixes[i] + "/") === 0) return true;
    }
    return false;
  }

  function isBannerSuppressedPath() {
    return startsWithPath(["/live", "/live-debug", "/demo"]);
  }

  function isOperatorPath() {
    return startsWithPath(["/season"]);
  }

  function addPrivacySettingsButton() {
    if (document.getElementById("privacy-settings-button")) {
      return;
    }
    if (isImmersivePage()) {
      return;
    }

    const isTurkish = document.documentElement.lang
      .toLowerCase()
      .startsWith("tr");

    const button = document.createElement("button");
    button.type = "button";
    button.id = "privacy-settings-button";
    button.className = "privacy-settings-button";
    button.style.marginLeft = "1em";
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
    // TIER 2: full skip on operator paths (see the PATH EXCLUSIONS block).
    if (isOperatorPath()) {
      return;
    }

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

    // TIER 1: banner-only suppression on /live* and /demo* (see the PATH
    // EXCLUSIONS block for the full rationale). Not a compliance change:
    // nothing is tracked without consent, and the banner still appears on
    // every normal page.
    if (isBannerSuppressedPath()) {
      return;
    }

    showBanner();
  });
})();
