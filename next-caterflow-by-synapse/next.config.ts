// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  experimental: {
    // Rewrites barrel imports so only the icons/components/helpers actually
    // used end up in each route's bundle.
    optimizePackageImports: [
      '@chakra-ui/react',
      '@chakra-ui/icons',
      'react-icons/fi',
      'react-icons/bs',
      'react-icons/fa',
      'react-icons/md',
      'date-fns',
      'framer-motion',
    ],
  },
};

// Check if we're in production mode
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction) {
  // Only require and apply next-pwa in production
  // API responses are deliberately NOT cached by the service worker: they are
  // per-user, authenticated and change constantly, and the default `apis`
  // NetworkFirst rule would serve up-to-24h-old data (possibly another user's,
  // on a shared browser) whenever a request stalled for 10s.
  const defaultRuntimeCaching = require('next-pwa/cache');
  const runtimeCaching = defaultRuntimeCaching.filter(
    (entry: any) => entry?.options?.cacheName !== 'apis',
  );
  const withPWA = require('next-pwa')({
    dest: 'public',
    register: true,
    skipWaiting: true,
    runtimeCaching,
  });
  module.exports = withPWA(nextConfig);
} else {
  module.exports = nextConfig;
}
