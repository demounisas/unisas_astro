// @ts-check
import { defineConfig, envField } from 'astro/config';
import wix from "@wix/astro";
import wixPages from "@wix/astro-pages";

import react from "@astrojs/react";
import wixHostingAdapter from "@wix/astro-wix-hosting-adapter";

const secret = () => envField.string({ context: "server", access: "secret", optional: true });

// https://astro.build/config
export default defineConfig({
  integrations: [wix(), wixPages(), react()],
  security: { checkOrigin: false },
  adapter: wixHostingAdapter(),

  image: {
    domains: ["static.wixstatic.com"],
  },

  output: "server",

  // Set with `wix env set --key=<NAME> --value=<value>`, then `wix env pull`.
  env: {
    schema: {
      SUPABASE_URL: secret(),
      SUPABASE_SERVICE_KEY: secret(),
      RESEND_API_KEY: secret(),
      LEAD_ADMIN_EMAIL: secret(),
      LEAD_FROM_EMAIL: secret(),
      SHEETS_WEBHOOK_URL: secret(),
      SHEETS_SHARED_SECRET: secret(),
    },
  },
});
