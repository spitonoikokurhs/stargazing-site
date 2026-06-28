import type { Metadata } from 'next'
import './styles.css'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'Privacy policy for Stargazing Events by Michalis Reisis, including website analytics, contact links and advertising tracking information.',
  robots: { index: true, follow: true },
  alternates: {
    canonical: 'https://www.stargazing.events/privacy',
  },
}

export default function PrivacyPage() {
  return (
    <>
      <header>
        <div className="container nav">
          <a className="brand" href="/">
            <span className="brand-dot"></span>
            <span>Stargazing Events</span>
          </a>
          <a href="/bodrum-hotelleri">Bodrum Hotels</a>
        </div>
      </header>

      <main>
        <div className="container">
          <article className="card">
            <div className="updated">Last updated: June 2026</div>
            <h1>Privacy Policy</h1>
            <p>This Privacy Policy explains how Stargazing Events, operated by Michalis Reisis, handles information when you visit this website or contact us.</p>

            <h2>Who we are</h2>
            <p>Stargazing Events provides premium guided stargazing experiences for hotels, resorts, weddings, private venues and selected collaborations in Kos, nearby destinations, Greece and Bodrum.</p>
            <p>Contact: <a href="mailto:mike@stargazing.events">mike@stargazing.events</a></p>

            <h2>Information you may provide</h2>
            <p>You may voluntarily provide information when you contact us by email, WhatsApp, social media, or through a website form. This may include your name, email address, phone number, hotel or venue name, and message details.</p>

            <h2>Analytics and tracking</h2>
            <p>This website may use privacy-conscious website analytics and advertising measurement tools to understand traffic and improve marketing performance. These may include:</p>
            <ul>
              <li>Vercel Analytics for basic website traffic and page-view measurement.</li>
              <li>Google Analytics / Google Tag for website analytics and campaign performance.</li>
              <li>Meta Pixel for Facebook and Instagram advertising measurement.</li>
              <li>LinkedIn Insight Tag for B2B advertising and campaign measurement.</li>
            </ul>
            <p>These tools may collect technical information such as page visits, browser type, device type, approximate location, referral source, and interactions with buttons such as email, WhatsApp, brochure or Instagram links.</p>

            <h2>Cookies and similar technologies</h2>
            <p>Analytics and advertising tools may use cookies or similar technologies to measure visits, understand campaign performance and improve future advertising. You can control or block cookies through your browser settings.</p>

            <h2>How information is used</h2>
            <ul>
              <li>To reply to inquiries and collaboration requests.</li>
              <li>To arrange meetings, proposals and event details.</li>
              <li>To understand website performance and improve the website.</li>
              <li>To measure advertising and outreach performance.</li>
            </ul>

            <h2>Sharing information</h2>
            <p>We do not sell personal information. Information may be processed by service providers used for website hosting, analytics, advertising, email, forms or communication tools.</p>

            <h2>Data retention</h2>
            <p>Inquiry and communication data may be kept for as long as needed to manage business relationships, proposals, events, legal obligations and basic business records.</p>

            <h2>Your choices</h2>
            <p>You may contact us to ask about information you have provided, request correction, or request deletion where applicable. You can also use browser settings to manage cookies and tracking preferences.</p>

            <h2>Contact</h2>
            <p>For privacy-related questions, contact:</p>
            <p><a href="mailto:mike@stargazing.events">mike@stargazing.events</a></p>

            <p className="footer">&copy; Stargazing Events &middot; Michalis Reisis &middot; Kos Island, Greece</p>
          </article>
        </div>
      </main>
    </>
  )
}
