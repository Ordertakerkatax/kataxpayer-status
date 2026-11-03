import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The home page and /about read content/*.md at request time; make sure the
  // files ship with their functions on Vercel.
  outputFileTracingIncludes: { '/': ['./content/**'], '/about': ['./content/**'] },
};

export default nextConfig;
