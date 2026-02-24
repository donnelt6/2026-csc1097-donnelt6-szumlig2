# Caddie Web (Next.js)

Next.js 14 frontend with hubs list, hub detail page, upload widget (file + URL ingestion with retry/refresh/delete), reminder suggestions/management, and chat flow (hub-only or hub + web search) with per-source selection.

## Run locally
```bash
cd apps/web
npm install
npm run dev
```

Environment variables: see `.env.example`. Set `NEXT_PUBLIC_API_BASE_URL` to your FastAPI host and provide `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` for auth.

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
- `app/auth/page.tsx` - Email/password sign in and sign up.
- `app/globals.css` - Global styles and theme variables.
- `app/hubs/[hubId]/page.tsx` - Hub detail page with upload, reminders, and chat.
- `components/ChatPanel.tsx` - Chat UI with citations, hub/global scope, and selected sources.
- `components/HubsList.tsx` - Hub list and create form.
- `components/InvitesPanel.tsx` - Pending invite list and accept actions.
- `components/MembersPanel.tsx` - Member list and role management.
- `components/Providers.tsx` - React Query + auth provider setup.
- `components/ReminderCandidatesPanel.tsx` - Suggested reminders from detected due dates.
- `components/RemindersPanel.tsx` - Reminder list and management actions.
- `components/UploadPanel.tsx` - Upload widget with file + URL submission, status list, source selection checkboxes, refresh/reprocess for web sources, and retry/delete for failures.
- `components/auth/AuthProvider.tsx` - Supabase session provider.
- `components/auth/AuthGate.tsx` - Route guard for authenticated pages.
- `components/auth/UserMenu.tsx` - Current user menu and sign out.
- `components/navigation/NotificationsMenu.tsx` - In-app notifications menu for invites and reminders.
- `lib/api.ts` - API client helpers.
- `lib/useSourceSelection.ts` - Hook for persisting per-hub source selection.
- `lib/supabaseClient.ts` - Supabase client initialization.
- `lib/types.ts` - Shared TypeScript types.
