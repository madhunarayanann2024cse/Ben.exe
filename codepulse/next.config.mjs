/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow the sandbox / preview proxy hosts (and any extra host you set in env)
  // to hit the dev server's internal endpoints during the live demo.
  allowedDevOrigins: [
    '*.e2b.app',
    '*.arena.ai',
    '*.vercel.app',
    '*.ngrok-free.app',
    'localhost',
    'localhost:3000',
    ...(process.env.ALLOWED_DEV_ORIGINS ? process.env.ALLOWED_DEV_ORIGINS.split(',') : []),
  ],
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
