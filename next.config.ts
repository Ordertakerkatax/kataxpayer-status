import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The home page reads content/what-to-do.md at request time; make sure the
  // file ships with the function on Vercel.
  outputFileTracingIncludes: { '/': ['./content/**'] },
};

export default nextConfig;
