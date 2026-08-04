/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      {
        // The verdict-first redesign was promoted to be the canonical
        // /sky-calendar. Keep the old comparison URL working: anyone with a
        // shared /sky-calendar-v2 link (query params carry over automatically)
        // lands on the real page. Permanent so search engines consolidate on
        // the canonical URL.
        source: '/sky-calendar-v2',
        destination: '/sky-calendar',
        permanent: true,
      },
    ]
  },
}

module.exports = nextConfig
