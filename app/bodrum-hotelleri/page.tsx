/* eslint-disable @next/next/no-img-element */
import type { Metadata } from 'next'
import Script from 'next/script'
import './styles.css'

const professionalServiceJsonLd = `{
  "@context": "https://schema.org",
  "@type": "ProfessionalService",
  "name": "Stargazing Events",
  "url": "https://www.stargazing.events/bodrum-hotelleri",
  "image": "https://www.stargazing.events/images/stargazing-events-thumbnail.jpg",
  "description": "Bodrum'daki lüks oteller ve resortlar için premium yıldız gözlem deneyimleri.",
  "areaServed": [{"@type":"Place","name":"Bodrum"},{"@type":"Place","name":"Kos"},{"@type":"Place","name":"Greece"}],
  "founder": {"@type":"Person","name":"Michalis Reisis"},
  "email": "mike@stargazing.events",
  "telephone": "+306947772928",
  "sameAs": ["https://www.instagram.com/mixalre","https://www.linkedin.com/in/michalis-reisis-stargazing/","https://www.stargazing.events/"],
  "serviceType": "Premium stargazing experiences for luxury hotels and resorts"
}`

const faqJsonLd = `{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {"@type":"Question","name":"Deneyim ne kadar sürer?","acceptedAnswer":{"@type":"Answer","text":"Yaklaşık 60–75 dakika sürer."}},
    {"@type":"Question","name":"Hava kötü olursa ne olur?","acceptedAnswer":{"@type":"Answer","text":"Uygun olmayan hava koşullarında etkinlik yeni bir tarihe alınabilir veya iptal edilir. Hava ve Ay evresi önceden kontrol edilir."}},
    {"@type":"Question","name":"Otel ne hazırlamalı?","acceptedAnswer":{"@type":"Answer","text":"Otelin uygun açık alan, azaltılmış çevre ışığı ve elektrik bağlantısı sağlaması yeterlidir. Tüm ekipman Michalis tarafından getirilir ve kurulur."}},
    {"@type":"Question","name":"Kaç misafir için uygundur?","acceptedAnswer":{"@type":"Answer","text":"En iyi deneyim için 1 kişiden yaklaşık 20–22 kişiye kadar önerilir."}}
  ]
}`

export const metadata: Metadata = {
  title: 'Bodrum Lüks Otelleri İçin Premium Yıldız Gözlem Deneyimi',
  description:
    "Bodrum'daki lüks oteller ve resortlar için premium yıldız gözlem deneyimi. Teleskop gözlemi, gökyüzü hikâyeleri, Ay ve gezegen gözlemi ve astrofotoğrafçılık ile özel misafir deneyimi.",
  keywords: [
    'Bodrum otel etkinlikleri',
    'Bodrum misafir deneyimi',
    'Bodrum lüks otel aktiviteleri',
    'Bodrum resort etkinlikleri',
    'Bodrum VIP misafir deneyimi',
    'Bodrum otelleri için özel etkinlik',
    'Bodrum yıldız gözlem deneyimi',
    'Bodrum telescope experience',
    'Bodrum luxury hotel experience',
    'Bodrum guest experience',
  ],
  alternates: {
    canonical: 'https://www.stargazing.events/bodrum-hotelleri',
    languages: {
      tr: 'https://www.stargazing.events/bodrum-hotelleri',
      en: 'https://www.stargazing.events/',
      'x-default': 'https://www.stargazing.events/',
    },
  },
  openGraph: {
    title: 'Bodrum Lüks Otelleri İçin Premium Yıldız Gözlem Deneyimi | Stargazing Events',
    description:
      "Bodrum'daki lüks oteller ve resortlar için teleskop gözlemi, gökyüzü hikâyeleri ve astrofotoğrafçılık ile premium misafir deneyimi.",
    type: 'website',
    url: 'https://www.stargazing.events/bodrum-hotelleri',
    images: [
      {
        url: 'https://www.stargazing.events/images/stargazing-events-thumbnail.jpg',
        width: 1200,
        height: 630,
        alt: 'Bodrum lüks otel yıldız gözlem deneyimi — Stargazing Events',
      },
    ],
    siteName: 'Stargazing Events',
    locale: 'tr_TR',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Bodrum Lüks Otelleri İçin Premium Yıldız Gözlem Deneyimi | Stargazing Events',
    description:
      "Bodrum'daki lüks oteller ve resortlar için teleskop gözlemi, gökyüzü hikâyeleri ve astrofotoğrafçılık ile premium misafir deneyimi.",
    images: ['https://www.stargazing.events/images/stargazing-events-thumbnail.jpg'],
    site: '@mixalre',
  },
}

export default function BodrumHotelleriPage() {
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
          <a href="/" className="brand">
            <span className="brand-dot"></span>
            <span>Stargazing Events</span>
          </a>

          {/* CSS-only mobile menu (checkbox hack) — matches the main site. Hidden
              on desktop; below the breakpoint the burger toggles the dropdown. */}
          <input type="checkbox" id="nav-toggle" className="nav-toggle" aria-hidden="true" />
          <label htmlFor="nav-toggle" className="nav-burger" aria-label="Menüyü aç">
            <span></span>
            <span></span>
            <span></span>
          </label>

          <nav>
            <a href="#deneyim">Deneyim</a>
            <a href="#oteller">Oteller</a>
            <a href="#gorsel">Görseller</a>
            <a href="#sss">SSS</a>
            <a href="/">English</a>
            <a href="#iletisim" className="btn">İletişim</a>
          </nav>
        </div>
      </header>

      <main>
        <section className="hero section">
          <div className="hero-media"></div>
          <div className="container hero-inner">
            <span className="kicker">Bodrum • Luxury Hotels • Guest Experience</span>
            <h1>Bodrum&apos;daki Lüks Oteller İçin Premium Yıldız Gözlem Deneyimi</h1>
            <p className="lead">Misafirlerinize teleskop gözlemi, gökyüzü hikâyeleri ve astrofotoğrafçılık ile unutulmaz bir akşam deneyimi sunun.</p>
            <p className="hero-proof">Kos&apos;ta 5 yıldızlı otellerle 5 sezondur düzenlenen premium misafir deneyimi. Şimdi Bodrum&apos;da seçili otel iş birlikleri için görüşmeler yapılmaktadır.</p>
            <div className="btn-group">
              <a className="btn primary" href="mailto:mike@stargazing.events?subject=Bodrum%20Hotel%20Stargazing%20Experience%20Inquiry">Toplantı Planlayalım</a>
              <a className="btn" href="/images/Stargazing%20Events%20PDF%20Brochure%20comp.pdf?utm_source=bodrum_landing&utm_medium=website&utm_campaign=hotel_b2b_bodrum" target="_blank" rel="noopener noreferrer">Otel Broşürünü Gör</a>
              <a className="btn" href="https://wa.me/306947772928?text=Hello%20Michalis%2C%20I%20would%20like%20to%20discuss%20a%20stargazing%20experience%20for%20a%20hotel%20in%20Bodrum." target="_blank" rel="noopener noreferrer">WhatsApp</a>
            </div>
          </div>
        </section>

        <section className="section" id="referanslar">
          <div className="container">
            <h2>Kos&apos;ta Kanıtlanmış Bir Misafir Deneyimi</h2>
            <p className="lead">Stargazing Events, son 5 sezondur Kos Adası&apos;nda 5 yıldızlı oteller, resortlar ve özel misafir grupları için düzenlenen premium bir gece deneyimidir.</p>
            <div className="proof-stats">
              <div className="stat-item"><span className="stat-number">5</span><span className="stat-label">Sezon aktif</span></div>
              <div className="stat-item"><span className="stat-number">5★</span><span className="stat-label">Otel iş birlikleri</span></div>
              <div className="stat-item"><span className="stat-number">VIP</span><span className="stat-label">Özel misafir deneyimleri</span></div>
              <div className="stat-item"><span className="stat-number">TR</span><span className="stat-label">Bodrum&apos;da seçili iş birlikleri</span></div>
            </div>
            <div className="trust-grid" style={{ marginTop: '32px' }}>
              <div className="trust-item"><img loading="lazy" src="/images/logos/caravialogo.png" alt="Caravia Beach Hotel logosu" /></div>
              <div className="trust-item"><img loading="lazy" src="/images/logos/okukoslogo.png" alt="OKU Kos logosu" /></div>
              <div className="trust-item"><img loading="lazy" src="/images/logos/astirlogo.png" alt="Astir Odysseus Resort and Spa logosu" /></div>
              <div className="trust-item"><img loading="lazy" src="/images/logos/palazzologo.png" alt="Palazzo del Mare logosu" /></div>
              <div className="trust-item"><img loading="lazy" src="/images/logos/paralos-kyma-dunes.png" alt="Paralos Kyma Dunes logosu" /></div>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="container">
            <div style={{ maxWidth: '820px' }}>
              <h2>Misafirlerinizin Beklemediği Bir Deneyim</h2>
              <p className="lead">Misafirler genellikle yıldız gözlem etkinliği talep etmez; çünkü konaklamaları sırasında böyle bir deneyimin sunulabileceğini bilmezler. Bu da deneyimi beklenmedik, özel ve akılda kalıcı hâle getirir.</p>
              <div className="highlight-quote">Zor fizik yok. Karmaşık anlatım yok. Sadece yıldızların altında zarif, rahat ve unutulmaz bir akşam.</div>
            </div>
          </div>
        </section>

        <section className="section" id="deneyim">
          <div className="container">
            <h2>Misafirler Ne Deneyimler?</h2>
            <p className="lead">Ön bilgi gerekmez. Deneyim tamamen rehberlidir ve her yaştan misafir için uygundur.</p>
            <div className="grid-3" style={{ marginTop: '24px' }}>
              <article className="card"><span className="chip">Gözlem</span><h3>Teleskop Gözlemi</h3><p className="muted">Canlı teleskop gözlemi ile Ay, gezegenler ve gökyüzü detayları.</p></article>
              <article className="card"><span className="chip">Ay</span><h3>Ay Gözlemi</h3><p className="muted">Ay görünür olduğunda kraterler ve yüzey detayları etkileyici şekilde gözlemlenir.</p></article>
              <article className="card"><span className="chip">Gezegenler</span><h3>Satürn ve Jüpiter</h3><p className="muted">Mevsim ve gökyüzü koşullarına bağlı olarak Satürn, Jüpiter ve parlak gezegenler.</p></article>
              <article className="card"><span className="chip">Anlatım</span><h3>Gökyüzü Hikâyeleri</h3><p className="muted">Takımyıldızlar, mitoloji ve gece gökyüzüne dair sade, etkileyici anlatım.</p></article>
              <article className="card"><span className="chip">Görsel</span><h3>Astrofotoğrafçılık</h3><p className="muted">Orijinal astrofotoğrafçılık çalışmaları ile gökyüzünün görünmeyen detayları.</p></article>
              <article className="card"><span className="chip">Premium</span><h3>VIP Misafir Deneyimi</h3><p className="muted">Çiftler, aileler, küçük gruplar ve VIP misafirler için uygun, sakin ve özel bir etkinlik.</p></article>
            </div>
          </div>
        </section>

        <section className="section" id="oteller">
          <div className="container">
            <div className="grid-2">
              <div>
                <h2>Oteller İçin Nasıl İşler?</h2>
                <p className="lead">Düşük operasyon yükü, yüksek misafir memnuniyeti. Otel ekibi için minimum hazırlık gerektirir.</p>
                <ul className="how-list">
                  <li><span className="how-num">1</span><span>Yaklaşık <strong>60–75 dakika</strong> sürer; planlı otel etkinliği veya özel misafir deneyimi olarak sunulabilir.</span></li>
                  <li><span className="how-num">2</span><span><strong>Hava durumu ve Ay evresi</strong> önceden kontrol edilir; program buna göre ayarlanır.</span></li>
                  <li><span className="how-num">3</span><span><strong>Concierge, guest relations veya marketing ekipleriyle</strong> kolayca koordine edilebilir.</span></li>
                  <li><span className="how-num">4</span><span><strong>Tüm teleskop ve ekipman</strong> Michalis tarafından getirilir, kurulur ve etkinlik sonunda kaldırılır.</span></li>
                  <li><span className="how-num">5</span><span>Otelin sağlaması gereken temel ihtiyaç: <strong>uygun açık alan, azaltılmış çevre ışığı ve elektrik bağlantısı.</strong></span></li>
                  <li><span className="how-num">6</span><span>Her katılımcıya orijinal astrofotoğrafçılık çalışmalarından hazırlanmış <strong>özel bir kartpostal</strong> hediye edilebilir.</span></li>
                </ul>
              </div>
              <div className="card">
                <span className="chip">Fiyatlandırma</span>
                <h3>Her otel için özel teklif</h3>
                <p className="muted">Sabit bir liste fiyatı yoktur. Fiyatlandırma; iş birliği sıklığı, etkinlik süresi, grup büyüklüğü, lokasyon ve seçilen format gibi detaylara göre netleşir.</p>
                <p className="muted">Otel için ekipman maliyeti veya gelir paylaşımı yoktur. En iyi başlangıç noktası kısa bir görüşmedir.</p>
                <a className="btn primary" href="mailto:mike@stargazing.events?subject=Bodrum%20Hotel%20Stargazing%20Experience%20Inquiry">Teklif Görüşmesi</a>
              </div>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="container">
            <h2>Mekân Gereksinimleri</h2>
            <p className="lead">Deneyim için ideal alan, gökyüzünü mümkün olduğunca geniş gören açık ve güvenli bir bölgedir. Otel ekibinin özel bir hazırlık yapması gerekmez.</p>
            <div className="req-grid">
              <div className="req-item"><span className="req-icon">🌌</span><div><strong>Açık gökyüzü görüşü</strong><p className="muted" style={{ margin: '4px 0 0', fontSize: '.9rem' }}>Engelsiz veya geniş gökyüzü açısı idealdir.</p></div></div>
              <div className="req-item"><span className="req-icon">💡</span><div><strong>Azaltılmış ışık</strong><p className="muted" style={{ margin: '4px 0 0', fontSize: '.9rem' }}>Yakın çevre ışıkları mümkün olduğunca azaltılır.</p></div></div>
              <div className="req-item"><span className="req-icon">🔌</span><div><strong>Elektrik bağlantısı</strong><p className="muted" style={{ margin: '4px 0 0', fontSize: '.9rem' }}>Standart bir elektrik hattı yeterlidir.</p></div></div>
              <div className="req-item"><span className="req-icon">👥</span><div><strong>Rahat toplanma alanı</strong><p className="muted" style={{ margin: '4px 0 0', fontSize: '.9rem' }}>Misafirlerin konforlu şekilde bekleyebileceği alan.</p></div></div>
              <div className="req-item"><span className="req-icon">✅</span><div><strong>Minimum operasyonel yük</strong><p className="muted" style={{ margin: '4px 0 0', fontSize: '.9rem' }}>Otel ekibinin etkinlik süresinde özel müdahalesi gerekmez.</p></div></div>
              <div className="req-item"><span className="req-icon">🔭</span><div><strong>Ekipman otelden gelmez</strong><p className="muted" style={{ margin: '4px 0 0', fontSize: '.9rem' }}>Tüm teleskop ve donanım Michalis tarafından temin edilir.</p></div></div>
            </div>
          </div>
        </section>

        <section className="section" id="gorsel">
          <div className="container">
            <h2>Gerçek Deneyimden ve Astrofotoğrafçılıktan Görseller</h2>
            <p className="lead">Önce atmosfer ve Samanyolu; ardından derin uzay çalışmalarından seçilmiş görseller. Misafir deneyimini anlatan fotoğraf hero ve hakkımda bölümlerinde kullanılır.</p>
            <div className="gallery-filters" aria-label="Galeri filtreleri">
              <button className="active" data-filter="all">Tümü</button>
              <button data-filter="wide-field">Geniş Alan</button>
              <button data-filter="deep-sky">Derin Uzay</button>
              <button data-filter="featured">Öne Çıkanlar</button>
            </div>
            <div className="gallery-grid-3col" id="galleryGrid">
              <figure className="gallery-card-3col" data-category="wide-field featured">
                <img loading="lazy" src="/images/milkyway-kos-agios-stefanos.jpg" alt="Kos Kefalos Agios Stefanos Bazilikası üzerinde Samanyolu panoraması" />
                <figcaption>Agios Stefanos Bazilikası, Kefalos — Samanyolu altında antik kalıntılar</figcaption>
              </figure>
              <figure className="gallery-card-3col" data-category="wide-field featured">
                <img loading="lazy" src="/images/milkyway-kos-turkey-coast.jpg" alt="Kos üzerinde yükselen Samanyolu çekirdeği ve uzakta Türkiye kıyısı" />
                <figcaption>Kos üzerinde yükselen Samanyolu — uzakta Türkiye kıyısı</figcaption>
              </figure>
              <figure className="gallery-card-3col" data-category="deep-sky featured">
                <img loading="lazy" src="/images/galaxy-triangulum-m33.jpg" alt="Üçgen Galaksisi M33 astrofotoğrafçılığı" />
                <figcaption>Üçgen Galaksisi (M33) — yıldız oluşum bölgelerine sahip yakın bir sarmal galaksi</figcaption>
              </figure>
              <figure className="gallery-card-3col" data-category="deep-sky featured">
                <img loading="lazy" src="/images/nebula-orion-m42.jpg" alt="Orion Bulutsusu M42 astrofotoğrafçılığı" />
                <figcaption>Orion Bulutsusu (M42) — yeni yıldızların doğduğu geniş bir yıldız fabrikası</figcaption>
              </figure>
              <figure className="gallery-card-3col" data-category="deep-sky">
                <img loading="lazy" src="/images/galaxy-fireworks-ngc6946.jpg" alt="Havai Fişek Galaksisi NGC 6946 ve NGC 6939 yıldız kümesi" />
                <figcaption>Havai Fişek Galaksisi (NGC 6946) ve açık yıldız kümesi NGC 6939</figcaption>
              </figure>
              <figure className="gallery-card-3col" data-category="deep-sky">
                <img loading="lazy" src="/images/galaxy-ngc2403.jpg" alt="NGC 2403 sarmal galaksi astrofotoğrafçılığı" />
                <figcaption>NGC 2403 — aktif yıldız oluşum bölgelerine sahip parlak sarmal galaksi</figcaption>
              </figure>
              <figure className="gallery-card-3col" data-category="deep-sky">
                <img loading="lazy" src="/images/galaxy-ic342-hidden.jpg" alt="IC 342 Hidden Galaxy astrofotoğrafçılığı" />
                <figcaption>IC 342 — yıldızlararası toz tarafından kısmen örtülmüş sarmal galaksi</figcaption>
              </figure>
              <figure className="gallery-card-3col" data-category="deep-sky wide-field">
                <img loading="lazy" src="/images/milkyway-core-dust-clouds.jpg" alt="Samanyolu çekirdeği ve yoğun toz bulutları astrofotoğrafçılığı" />
                <figcaption>Galaksimizin yapısını şekillendiren yoğun Samanyolu toz bulutları</figcaption>
              </figure>
              <figure className="gallery-card-3col" data-category="deep-sky">
                <img loading="lazy" src="/images/nebula-trifid-m20.jpg" alt="Trifid Bulutsusu M20 astrofotoğrafçılığı" />
                <figcaption>Trifid Bulutsusu (M20) — emisyon, yansıma ve karanlık bulutsuların nadir birleşimi</figcaption>
              </figure>
            </div>
          </div>
          <div className="lightbox" id="lightbox" aria-modal={true} role="dialog" aria-label="Görsel görüntüleyici">
            <div className="lightbox-inner">
              <img id="lightboxImg" alt="" />
              <div className="lightbox-caption" id="lightboxCaption"></div>
            </div>
          </div>
        </section>

        <section className="section" id="hakkimda">
          <div className="container about-grid">
            <div className="card">
              <h2>Hakkımda</h2>
              <p>Kos Adası doğumluyum. Son 5 sezondur lüks oteller, resortlar ve özel misafir grupları için yıldız gözlem deneyimleri tasarlıyor ve sunuyorum.</p>
              <p>Deneyim; astronomi, mitoloji ve atmosfer öğelerini bir araya getirerek rafine bir misafir deneyimine dönüştürülmüştür. Kos&apos;taki 5 yıldızlı otellerle yürütülen iş birlikleri, şimdi Bodrum&apos;daki seçili ortaklıklara da açılmaktadır.</p>
              <p>Misafir deneyiminin yanı sıra, astrofotoğrafçılık çalışmalarımla geceye görsel derinlik ve özgünlük katıyorum.</p>
              <div className="meta-list">
                <div><strong>Merkez:</strong> Kos Adası, Yunanistan</div>
                <div><strong>Kapsama alanı:</strong> Yakın adalar, Yunanistan, Bodrum</div>
                <div><strong>Odak:</strong> Misafir deneyimi, anlatım, astronomi</div>
                <div><strong>Stil:</strong> Premium, sakin, unutulmaz</div>
              </div>
              <p className="muted" style={{ marginTop: '16px', fontSize: '.88rem', borderTop: '1px solid var(--border)', paddingTop: '14px' }}>
                <strong>Dil notu:</strong> Görüşmeler İngilizce dilinde yürütülmektedir. Otel ekipleriyle koordinasyon için İngilizce yeterlidir. <em>(Meetings are conducted in English.)</em>
              </p>
            </div>
            <div className="about-photo">
              <img loading="lazy" src="/images/michalis-reisis-stargazing-host.jpg" alt="Michalis Reisis — Stargazing Events kurucusu ve yıldız gözlem etkinliği sunucusu" />
            </div>
          </div>
        </section>

        <section className="section" id="sss">
          <div className="container">
            <h2>Pratik Bilgiler</h2>
            <p className="lead">Otel ekiplerinin sıkça sorduğu sorular.</p>
            <div className="faq-grid">
              <div className="faq-item"><div className="faq-q">Süre</div><p className="faq-a">Yaklaşık 60–75 dakika.</p></div>
              <div className="faq-item"><div className="faq-q">Hava Koşulları</div><p className="faq-a">Uygun olmayan hava koşullarında etkinlik yeni bir tarihe alınabilir veya iptal edilir. Hava ve Ay evresi önceden kontrol edilir.</p></div>
              <div className="faq-item"><div className="faq-q">Yaş Aralığı</div><p className="faq-a">5–85 yaş arası misafirler için uygundur. Ön bilgi veya hazırlık gerekmez.</p></div>
              <div className="faq-item"><div className="faq-q">Grup Büyüklüğü</div><p className="faq-a">En iyi deneyim için 1 kişiden yaklaşık 20–22 kişiye kadar önerilir.</p></div>
              <div className="faq-item"><div className="faq-q">Mekân</div><p className="faq-a">Gökyüzünü geniş gören açık bir alan idealdir — teras, bahçe veya havuz başı uygundur.</p></div>
              <div className="faq-item"><div className="faq-q">Otel Yükümlülüğü</div><p className="faq-a">Otelin yalnızca uygun alan, azaltılmış çevre ışığı ve elektrik bağlantısı sağlaması yeterlidir. Tüm ekipman Michalis tarafından getirilir.</p></div>
              <div className="faq-item"><div className="faq-q">Rehberlik</div><p className="faq-a">Deneyim tamamen rehberlidir; anlatım, gözlem ve hikâye akışı Michalis tarafından yönetilir.</p></div>
              <div className="faq-item"><div className="faq-q">Hatıra Hediyesi</div><p className="faq-a">Her katılımcıya orijinal astrofotoğrafçılık çalışmalarından hazırlanmış özel bir kartpostal hediye edilebilir.</p></div>
            </div>
          </div>
        </section>

        <section className="section" id="iletisim">
          <div className="container">
            <div className="card cta-card">
              <span className="chip">Selected collaborations in Bodrum</span>
              <h2>Oteliniz İçin Unutulmaz Bir Gece Deneyimi Planlayalım</h2>
              <p className="lead" style={{ marginLeft: 'auto', marginRight: 'auto' }}>Bodrum, Kos ve yakın destinasyonlarda seçili otel iş birlikleri için görüşmeye açığım.</p>
              <div className="btn-group" style={{ justifyContent: 'center' }}>
                <a className="btn primary" href="mailto:mike@stargazing.events?subject=Bodrum%20Hotel%20Stargazing%20Experience%20Inquiry">Email</a>
                <a className="btn" href="https://wa.me/306947772928?text=Hello%20Michalis%2C%20I%20would%20like%20to%20discuss%20a%20stargazing%20experience%20for%20a%20hotel%20in%20Bodrum." target="_blank" rel="noopener noreferrer">WhatsApp</a>
                <a className="btn" href="/images/Stargazing%20Events%20PDF%20Brochure%20comp.pdf?utm_source=bodrum_landing&utm_medium=website&utm_campaign=hotel_b2b_bodrum" target="_blank" rel="noopener noreferrer">Otel Broşürünü Gör</a>
                <a className="btn" href="https://instagram.com/mixalre?utm_source=bodrum_landing&utm_medium=website&utm_campaign=hotel_b2b_bodrum" target="_blank" rel="noopener noreferrer">Instagram</a>
                <a className="btn" href="https://www.linkedin.com/in/michalis-reisis-stargazing/?utm_source=bodrum_landing&utm_medium=website&utm_campaign=hotel_b2b_bodrum" target="_blank" rel="noopener noreferrer">LinkedIn</a>
              </div>
              <p className="contact-detail">mike@stargazing.events · +30 694 777 2928 · www.stargazing.events · @mixalre</p>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="container">
          Michalis Reisis · Stargazing Events · Kos Island, Greece | Bodrum<br />
          <a href="https://www.stargazing.events/">www.stargazing.events</a>
        </div>
      </footer>

      <Script src="/bodrum-scripts.js" strategy="afterInteractive" />
    </>
  )
}
