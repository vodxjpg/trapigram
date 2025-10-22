/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep your existing options if you already have this file; preserve everything else.
  experimental: {
    /**
     * Ensure Vercel/Next includes the CA bundle in the traced output
     * for server routes that might import `src/lib/db.ts` (directly or indirectly).
     * Keys are app-route entry patterns; values are arrays of files to bundle.
     *
     * We list the known webhook entry explicitly and also cover common app segments
     * that may touch the DB (add or remove keys as needed).
     */
    outputFileTracingIncludes: {
      // Your failing route handler:
      "/(dashboard)/niftipay/webhook/route": ["./certs/prod-ca-2021.crt"],

      // Optional broader coverage if other server routes/pages touch the DB:
      "/(dashboard)/**": ["./certs/prod-ca-2021.crt"],
      "/api/**": ["./certs/prod-ca-2021.crt"],

      // If you have other groups like (auth), (marketing), etc., you can add them too:
      // "/(auth)/**": ["./certs/prod-ca-2021.crt"],
    },
  },
};

export default nextConfig;
