/* eslint-disable @next/next/no-img-element */
import type { Metadata } from 'next'
import Script from 'next/script'
import { LiveStatusPill } from './components/LiveStatusPill'
import './homepage.css'

const professionalServiceJsonLd = `{
  "@context": "https://schema.org",
  "@type": "ProfessionalService",
  "name": "Stargazing Events",
  "url": "https://www.stargazing.events/",
  "image": "https://www.stargazing.events/images/stargazing-events-thumbnail.jpg",
  "description": "Premium stargazing experiences for hotels, resorts, weddings and luxury venues in Kos, nearby Greek islands and Bodrum.",
  "founder": {
    "@type": "Person",
    "name": "Michalis Reisis"
  },
  "email": "mike@stargazing.events",
  "telephone": "+306947772928",
  "areaServed": [
    { "@type": "Place", "name": "Kos Island" },
    { "@type": "Place", "name": "Greece" },
    { "@type": "Place", "name": "Bodrum" }
  ],
  "sameAs": [
    "https://www.instagram.com/mixalre",
    "https://www.facebook.com/nextdoorphotographer",
    "https://www.linkedin.com/in/michalis-reisis-stargazing/"
  ],
  "serviceType": "Premium stargazing experiences for hotels, resorts, weddings and private events"
}`

const faqJsonLd = `{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "What exactly is a Stargazing experience?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "A guided evening combining live telescope observation, storytelling about constellations and Greek mythology, and original astrophotography. The format is calm, premium and accessible, with no prior astronomy knowledge needed."
      }
    },
    {
      "@type": "Question",
      "name": "How long does the experience last?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Approximately 60 to 75 minutes. The format can be adjusted slightly for private events, hotel schedules or shorter evening windows."
      }
    },
    {
      "@type": "Question",
      "name": "What does the hotel or venue need to provide?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "An open outdoor area with a clear view of the sky, reduced nearby lighting where possible, and access to a standard electrical outlet. All telescopes, equipment and materials are brought, set up and operated by Michalis."
      }
    },
    {
      "@type": "Question",
      "name": "What happens if the weather is bad?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Weather and Moon phase are checked in advance. If conditions are not suitable for proper observation, the event can be rescheduled to a new date or cancelled."
      }
    },
    {
      "@type": "Question",
      "name": "How many guests can participate?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "The experience works well from one private guest up to around 20 to 22 participants for the best interaction and quality. Larger formats can be discussed separately."
      }
    },
    {
      "@type": "Question",
      "name": "Which areas do you operate in?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Stargazing Events is based on Kos Island and is available for selected collaborations in nearby Greek islands, other destinations in Greece and Bodrum."
      }
    }
  ]
}`

export const metadata: Metadata = {
  title: {
    absolute: 'Premium Stargazing Experiences for Hotels & Resorts | Kos, Greece',
  },
  description:
    'Premium stargazing experiences for hotels, resorts, weddings and luxury venues in Kos, nearby Greek islands and Bodrum — telescope observation, storytelling and original astrophotography by Michalis Reisis.',
  alternates: {
    canonical: 'https://www.stargazing.events/',
    languages: {
      en: 'https://www.stargazing.events/',
      tr: 'https://www.stargazing.events/bodrum-hotelleri',
      'x-default': 'https://www.stargazing.events/',
    },
  },
  openGraph: {
    title: 'Premium Stargazing Experiences for Hotels & Resorts | Stargazing Events',
    description:
      'Premium stargazing experiences for hotels, resorts, weddings and luxury venues in Kos, Greece and Bodrum — telescope observation, storytelling and astrophotography.',
    type: 'website',
    url: 'https://www.stargazing.events/',
    images: [
      {
        url: 'https://www.stargazing.events/images/stargazing-events-thumbnail.jpg',
        width: 1200,
        height: 630,
        alt: 'Stargazing Events premium hotel stargazing experience under the Milky Way',
      },
    ],
    siteName: 'Stargazing Events',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Premium Stargazing Experiences for Hotels & Resorts | Stargazing Events',
    description:
      'Premium stargazing experiences for hotels, resorts, weddings and luxury venues in Kos, Greece and Bodrum.',
    images: ['https://www.stargazing.events/images/stargazing-events-thumbnail.jpg'],
    site: '@mixalre',
  },
}

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: professionalServiceJsonLd }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: faqJsonLd }}
      />

      <header>
        <div className="container nav">
          <a href="#top" className="brand">
            <span className="brand-dot"></span>
            <span>Michalis Reisis</span>
          </a>

          {/* The live pill stays on the bar at ALL sizes (it's time-sensitive
              info a guest wants at a glance); the rest of the nav collapses
              behind the menu toggle on mobile. */}
          <LiveStatusPill variant="header" />

          {/* CSS-only mobile menu: a hidden checkbox toggles the nav open, so
              there's zero JS and nothing to hydrate/break. The label is the
              hamburger; it's hidden on desktop where the full nav shows inline. */}
          <input type="checkbox" id="nav-toggle" className="nav-toggle" aria-hidden="true" />
          <label htmlFor="nav-toggle" className="nav-burger" aria-label="Open menu">
            <span></span>
            <span></span>
            <span></span>
          </label>

          <nav>
            <a href="#gallery">Gallery</a>
            <a href="#partnerships">Partnerships</a>
            <a href="#about">About</a>
            <a href="#faq">FAQ</a>
            <a href="/sky-calendar">Tonight&apos;s Sky</a>
            <a href="/bodrum-hotelleri">Bodrum TR</a>
            <a href="#guest-feedback">Feedback</a>
            <a href="#contact" className="btn">Contact</a>
            <a href="mailto:mike@stargazing.events" className="btn primary">Email Michalis</a>
          </nav>
        </div>
      </header>

      <main>
        <section className="hero section">
          <div className="hero-media"></div>

          <div className="container hero-inner">
            <span className="kicker">Stargazing Events • Astronomy • Astrophotography</span>
            <h1><span>Premium Stargazing Experiences for Hotels, Weddings &amp; Luxury Venues</span></h1>
            <p className="lead">
              I design and host premium stargazing experiences that blend astronomy, Greek mythology, and storytelling under the night sky. Based on Kos Island and working across nearby islands, Greece, and Bodrum, I create immersive evenings using telescopes, guided sky tours, and narrative — offering guests a memorable and unexpected experience.
            </p>
            <p className="hero-subnote muted">Now entering its 5th season, hosted across multiple 5-star hotels in Kos.</p>
            <div className="hero-cta">
              <a className="btn primary" href="#contact">Discuss a partnership</a>
              <LiveStatusPill variant="hero" />
            </div>
          </div>
        </section>

        <section className="section">
          <div className="container">
            <h2>Trusted by hospitality teams</h2>
            <p className="lead">A premium night-sky activity that adds atmosphere, storytelling and memorable moments to a guest&apos;s stay.</p>

            <div className="trust-grid">
              <div className="trust-item"><img src="/images/logos/caravialogo.png" alt="Caravia Beach Hotel logo" /></div>
              <div className="trust-item"><img src="/images/logos/okukoslogo.png" alt="OKU Kos logo" /></div>
              <div className="trust-item"><img src="/images/logos/astirlogo.png" alt="Astir Odysseus Resort and Spa logo" /></div>
              <div className="trust-item"><img src="/images/logos/palazzologo.png" alt="Palazzo del Mare hotel logo" /></div>
              <div className="trust-item"><img src="/images/logos/paralos-kyma-dunes.png" alt="Paralos Kyma Dunes hotel logo" /></div>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="container">
            <h2>Stargazing Experiences for Hotels and Resorts</h2>
            <div className="grid-3">
              <article className="card">
                <span className="chip">Guest Experience</span>
                <h3>Premium Stargazing Experience</h3>
                <p>A curated evening under the night sky, combining storytelling, guided sky tours, and telescope observation — designed to engage, inspire, and leave a lasting impression.</p>
              </article>

              <article className="card">
                <span className="chip">Content</span>
                <h3>Astronomy &amp; Visual Experience</h3>
                <p>Astrophotography and visual elements that complement the experience, revealing details beyond what the eye can see and adding depth to the night sky.</p>
              </article>

              <article className="card">
                <span className="chip">Coverage</span>
                <h3>Kos • Nearby Islands • Bodrum</h3>
                <p>Based in Kos and operating across nearby islands, Greece, and Bodrum for selected collaborations and private events.</p>
              </article>
            </div>
          </div>
        </section>

        <section id="gallery" className="section">
          <div className="container">
            <h2>My Astrophotography Work</h2>
            <p className="lead">A selection of my astrophotography and night-sky work, capturing details and structures not visible to the naked eye. These images offer a deeper visual perspective of what we explore together during the stargazing experience. Click any image to view it larger.</p>

            <div className="gallery-filters" aria-label="Gallery filters">
              <button className="active" data-filter="all" aria-label="Show all images">All</button>
              <button data-filter="deep-sky" aria-label="Show deep sky images">Deep Sky</button>
              <button data-filter="wide-field" aria-label="Show wide field images">Wide Field</button>
              <button data-filter="featured" aria-label="Show featured images">Featured</button>
            </div>

            <div className="gallery-grid" id="galleryGrid">
              <figure className="gallery-card" data-category="deep-sky featured">
                <img loading="lazy" src="/images/galaxy-triangulum-m33.jpg" alt="Triangulum Galaxy M33 astrophotography by Michalis Reisis" />
                <figcaption>Triangulum Galaxy (M33) — a nearby spiral galaxy rich in star-forming regions</figcaption>
              </figure>

              <figure className="gallery-card" data-category="deep-sky featured">
                <img loading="lazy" src="/images/nebula-orion-m42.jpg" alt="Orion Nebula M42 astrophotography showing a stellar nursery" />
                <figcaption>Orion Nebula (M42) — a vast stellar nursery where new stars are being born</figcaption>
              </figure>

              <figure className="gallery-card" data-category="deep-sky">
                <img loading="lazy" src="/images/galaxy-fireworks-ngc6946.jpg" alt="Fireworks Galaxy NGC 6946 and star cluster NGC 6939 astrophotography" />
                <figcaption>Fireworks Galaxy (NGC 6946) alongside the open star cluster NGC 6939</figcaption>
              </figure>

              <figure className="gallery-card" data-category="deep-sky">
                <img loading="lazy" src="/images/galaxy-ngc2403.jpg" alt="NGC 2403 spiral galaxy astrophotography" />
                <figcaption>NGC 2403 — a bright spiral galaxy in Camelopardalis with active star-forming regions</figcaption>
              </figure>

              <figure className="gallery-card" data-category="deep-sky">
                <img loading="lazy" src="/images/galaxy-ic342-hidden.jpg" alt="IC 342 Hidden Galaxy face-on spiral galaxy astrophotography" />
                <figcaption>IC 342 — a face-on spiral galaxy partially veiled by interstellar dust</figcaption>
              </figure>

              <figure className="gallery-card" data-category="deep-sky wide-field">
                <img loading="lazy" src="/images/milkyway-core-dust-clouds.jpg" alt="Milky Way core dust clouds astrophotography" />
                <figcaption>Dense Milky Way dust clouds shaping the structure of our galaxy</figcaption>
              </figure>

              <figure className="gallery-card" data-category="deep-sky">
                <img loading="lazy" src="/images/nebula-trifid-m20.jpg" alt="Trifid Nebula M20 astrophotography" />
                <figcaption>Trifid Nebula (M20) — a rare combination of emission, reflection and dark nebula</figcaption>
              </figure>

              <figure className="gallery-card" data-category="wide-field featured">
                <img loading="lazy" src="/images/milkyway-kos-turkey-coast.jpg" alt="Milky Way core rising above Kos with Turkey coastline visible" />
                <figcaption>Milky Way core rising above Kos, with the coastline of Turkey visible in the distance</figcaption>
              </figure>

              <figure className="gallery-card" data-category="wide-field featured">
                <img loading="lazy" src="/images/milkyway-kos-agios-stefanos.jpg" alt="Milky Way panorama over Agios Stefanos Basilica in Kefalos Kos Greece" />
                <figcaption>Basilica of Agios Stefanos, Kefalos — ancient ruins beneath the timeless arc of the Milky Way</figcaption>
              </figure>
            </div>
          </div>

          <div className="lightbox" id="lightbox" aria-modal={true} role="dialog" aria-label="Image viewer">
            <div className="lightbox-inner">
              <img id="lightboxImg" alt="" />
              <div className="lightbox-caption" id="lightboxCaption"></div>
            </div>
          </div>
        </section>

        <section id="partnerships" className="section">
          <div className="container">
            <h2>Hotel Partnerships and Private Events</h2>
            <p className="lead">A premium night experience designed for hotels, resorts, weddings and venues looking to offer something distinctive, engaging and memorable.</p>

            <div className="partnership-columns">
              <div className="card">
                <span className="chip">Trusted Partners</span>
                <h3>Current and recurring collaborations</h3>
                <ul className="partner-list">
                  <li>Caravia Beach Hotel – Kos</li>
                  <li>OKU Kos</li>
                  <li>Astir Odysseus Resort &amp; Spa</li>
                  <li>Palazzo del Mare</li>
                  <li>Kyma Mare Dunes Resort</li>
                </ul>
              </div>

              <div className="card">
                <span className="chip">Selected Collaborations</span>
                <h3>Additional venues and private events</h3>
                <ul className="partner-list">
                  <li>Grecotel Kos Imperial</li>
                  <li>The Bodrum EDITION</li>
                  <li>The Peninsula Istanbul — private event</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section id="about" className="section">
          <div className="container about-grid">
            <div className="card">
              <h2>About Michalis Reisis — Astrophotographer &amp; Astronomy Host</h2>
              <p>Born and raised on Kos Island, I design and host stargazing experiences across luxury hotels, resorts and private events.</p>
              <p>Now entering its 5th year, the experience has been developed and presented in multiple 5-star properties, combining astronomy, storytelling and atmosphere into a refined guest experience.</p>
              <p>My goal is to help guests connect with the night sky in a way that feels simple, engaging and memorable.</p>

              <div className="meta-list">
                <div><strong>Base:</strong> Kos Island, Greece</div>
                <div><strong>Coverage:</strong> Nearby islands, Greece, Bodrum</div>
                <div><strong>Focus:</strong> Guest experience, storytelling, astronomy, uranography</div>
                <div><strong>Style:</strong> Premium, calm, immersive</div>
              </div>
            </div>

            <div className="about-photo">
              <img loading="lazy" src="/images/michalis-reisis-stargazing-host.jpg" alt="Michalis Reisis hosting a stargazing event with telescope under the Milky Way" />
            </div>
          </div>
        </section>

        <section id="testimonials" className="section">
          <div className="container">
            <h2>Testimonials</h2>
            <p className="lead">Feedback from hospitality partners and venue collaborations.</p>

            <div className="testimonial-grid">
              <div className="card">
                <blockquote>&ldquo;A memorable and elegant experience for our guests.&rdquo;</blockquote>
                <div className="quote-author">Hospitality partner</div>
              </div>

              <div className="card">
                <blockquote>&ldquo;Michalis combines real astronomy knowledge with a calm and premium presentation.&rdquo;</blockquote>
                <div className="quote-author">Venue collaboration</div>
              </div>

              <div className="card">
                <blockquote>&ldquo;One of the most talked-about evening activities of the season.&rdquo;</blockquote>
                <div className="quote-author">Guest experience feedback</div>
              </div>
            </div>
          </div>
        </section>

        <section id="faq" className="section">
          <div className="container">
            <h2>Frequently Asked Questions</h2>
            <p className="lead">Practical information for hotels, resorts, weddings and private venue collaborations.</p>

            <div className="faq-grid">
              <article className="faq-item">
                <h3>What exactly is a Stargazing experience?</h3>
                <p>A guided evening combining live telescope observation, storytelling about constellations and Greek mythology, and original astrophotography. The format is calm, premium and accessible.</p>
              </article>

              <article className="faq-item">
                <h3>How long does the experience last?</h3>
                <p>Approximately 60–75 minutes. The format can be adjusted slightly for private events, hotel schedules or shorter evening windows.</p>
              </article>

              <article className="faq-item">
                <h3>What does the hotel or venue need to provide?</h3>
                <p>An open outdoor area with a clear view of the sky, reduced nearby lighting where possible, and access to a standard electrical outlet. I bring and set up all equipment.</p>
              </article>

              <article className="faq-item">
                <h3>What if the weather is bad?</h3>
                <p>Weather and Moon phase are checked in advance. If conditions are not suitable for proper observation, the event can be rescheduled or cancelled.</p>
              </article>

              <article className="faq-item">
                <h3>Is this suitable for children?</h3>
                <p>Yes. The experience is designed for ages roughly 5 to 85, with no prior astronomy knowledge needed.</p>
              </article>

              <article className="faq-item">
                <h3>How many guests can participate?</h3>
                <p>The experience works well from one private guest up to around 20–22 participants for the best interaction and quality. Larger formats can be discussed separately.</p>
              </article>

              <article className="faq-item">
                <h3>How are partnerships structured?</h3>
                <p>Each collaboration is shaped to the venue&apos;s needs: a one-off event, a weekly seasonal evening, or a private VIP experience. Pricing depends on frequency, location and format.</p>
              </article>

              <article className="faq-item">
                <h3>Which areas do you operate in?</h3>
                <p>Based on Kos Island, with selected collaborations available across nearby Greek islands, other destinations in Greece and Bodrum, Turkey.</p>
              </article>
            </div>
          </div>
        </section>

        <section id="guest-feedback" className="section">
          <div className="container">
            <div className="card contact-card">
              <h2>Leave your feedback</h2>
              <p className="lead">If you attended one of my stargazing events, I&apos;d be grateful for your feedback. With your permission, selected comments may be featured on this website as testimonials.</p>

              <form action="https://formspree.io/f/mgonbldz" method="POST" className="feedback-form">
                <input type="hidden" name="_subject" value="New Stargazing Events testimonial submission" />
                <input type="text" name="_gotcha" className="visually-hidden" tabIndex={-1} autoComplete="off" />

                <div className="form-grid">
                  <div className="form-group">
                    <label htmlFor="guest-name">Your name</label>
                    <input type="text" id="guest-name" name="name" required minLength={2} />
                  </div>

                  <div className="form-group">
                    <label htmlFor="guest-hotel">Hotel / Venue</label>
                    <input type="text" id="guest-hotel" name="hotel" required minLength={2} />
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="guest-feedback-text">Your feedback</label>
                  <textarea id="guest-feedback-text" name="feedback" rows={6} required minLength={20} placeholder="Tell me a few words about your stargazing experience..."></textarea>
                </div>

                <div className="form-group checkbox-group">
                  <label>
                    <input type="checkbox" name="permission" value="yes" required />
                    I give permission for my feedback, first name, and hotel / venue name to be displayed publicly as a testimonial.
                  </label>
                </div>

                <button type="submit" className="btn primary">Submit feedback</button>
              </form>
            </div>
          </div>
        </section>

        <section id="contact" className="section">
          <div className="container">
            <div className="card contact-card">
              <h2>Contact</h2>
              <p className="lead">For partnerships, weddings, and venue collaborations, feel free to email me directly — I&apos;ll be happy to discuss availability and tailor the experience to your needs.</p>
              <a className="btn primary" href="mailto:mike@stargazing.events">Email Michalis</a>
              <p className="muted" style={{ marginTop: '12px' }}>Email: <a href="mailto:mike@stargazing.events">mike@stargazing.events</a></p>
              <div className="socials">
                <a href="https://instagram.com/mixalre" target="_blank" rel="noopener noreferrer">Instagram @mixalre</a>
                <a href="https://fb.com/nextdoorphotographer" target="_blank" rel="noopener noreferrer">Facebook Page</a>
                <a href="https://www.linkedin.com/in/michalis-reisis-stargazing/" target="_blank" rel="noopener noreferrer">LinkedIn</a>
                <a href="https://wa.me/306947772928" target="_blank" rel="noopener noreferrer">WhatsApp</a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="container">
          <p className="footer-links">
            <a href="/sky-calendar">Tonight&apos;s Sky</a>
            <a href="/bodrum-hotelleri">Bodrum</a>
            <a href="/privacy">Privacy</a>
          </p>
          © {new Date().getFullYear()} Michalis Reisis • Stargazing Events
        </div>
      </footer>

      <Script src="/homepage-scripts.js" strategy="afterInteractive" />
    </>
  )
}
