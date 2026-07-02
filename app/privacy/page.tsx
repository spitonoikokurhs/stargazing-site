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
            <div className="updated">Last updated: July 2026</div>
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

            <h2>Email subscribers</h2>
            <p>If you sign up through the subscription form on our live view page, we collect the email address you provide. We use it only to send you a notification shortly before a live stargazing session begins, and a short summary the morning after a session describing what was observed. Signing up is a clear opt-in — we only send emails if you actively submit the form.</p>
            <p>Subscriber email addresses are stored in our database (Neon Postgres, hosted in the EU / Frankfurt region). Emails are delivered through Resend, our email delivery provider.</p>
            <p>Every email we send includes a one-click unsubscribe link that works without logging in. When you unsubscribe, we stop sending emails immediately and delete your subscription record within 30 days. We keep your email address only until you unsubscribe.</p>

            <h2>Anonymous viewer counts</h2>
            <p>While you watch the live view, your browser sends a brief &ldquo;still here&rdquo; signal roughly every 30 seconds so we can show an accurate count of how many people are watching at the same time. Displaying that count is the only thing this signal is used for.</p>
            <p>This does not identify you. There is no account, no login, and no persistent identifier. The signal uses only a short-lived random token generated in your browser for the duration of your visit. The token is held in memory only — it is not a cookie and is not stored on your device, and it disappears when you close the tab.</p>
            <p>These counts are held in temporary storage (Upstash Redis, hosted in the EU / Frankfurt region) and the tokens expire automatically after five minutes of inactivity.</p>

            <h2>Live session records</h2>
            <p>For each live stargazing session, we record details of the astronomical observation itself: the name of the object viewed (for example, &ldquo;M31 Andromeda Galaxy&rdquo;), the date and time, which telescope produced the image (Pegasus or Seestar), and the stacked images captured during the session.</p>
            <p>These records describe the sky, not visitors — no personal or visitor information is linked to them. Images are stored in Vercel Blob, and the accompanying details in our database (Neon Postgres), both hosted in the EU / Frankfurt region. We keep these records indefinitely as a historical archive of our observations, and selected images may appear in the site&rsquo;s public astrophotography gallery.</p>

            <h2>Where your data is stored</h2>
            <p>All of the data described above is stored within the European Union (Frankfurt region): image files in Vercel Blob, short-lived state such as viewer counts in Upstash Redis, and subscriber, session and observation records in Neon Postgres. This matters under the GDPR: your data does not leave the EU.</p>

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
