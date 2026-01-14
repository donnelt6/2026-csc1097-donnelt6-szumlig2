# Caddie Web (Next.js)

Next.js 14 frontend with hubs list, hub detail page, upload widget, and chat flow.

## Run locally
```bash
cd apps/web
npm install
npm run dev
```

Environment variables: see `.env.example`. Set `NEXT_PUBLIC_API_BASE_URL` to your FastAPI host and add Supabase keys when enabling auth.

## Files and purpose
- `.env.example` - Template for required env vars (no secrets).
- `.eslintrc.json` - ESLint rules for consistent linting.
- `README.md` - Setup notes for running the web app.
- `next.config.mjs` - Next.js configuration.
- `next-env.d.ts` - Next.js TypeScript declarations.
- `package.json` - Web app dependencies and scripts.
- `tsconfig.json` - TypeScript settings for the web app.
- `app/layout.tsx` - Root layout wrapper.
- `app/page.tsx` - Home page listing hubs.
- `app/globals.css` - Global styles and theme variables.
- `app/hubs/[hubId]/page.tsx` - Hub detail page with upload + chat.
- `components/ChatPanel.tsx` - Chat UI with citations.
- `components/HubsList.tsx` - Hub list and create form.
- `components/Providers.tsx` - React Query provider setup.
- `components/UploadPanel.tsx` - Upload widget with status list.
- `lib/api.ts` - API client helpers.
- `lib/supabaseClient.ts` - Supabase client initialization.
- `lib/types.ts` - Shared TypeScript types.
