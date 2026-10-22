# Taskly – task planner PWA
## Setup
1. Create a free project at supabase.com. SQL Editor → run `supabase/migrations/0001_init.sql`.
2. Auth → URL Configuration: add your Cloudflare Pages URL (and http://localhost:5173) as Site URL / redirect URLs.
3. `cp .env.example .env` and fill in the project URL and anon key (Settings → API). Never use the service-role key in the frontend.
4. `npm install && npm run dev`
## Deploy (Cloudflare Pages, free)
Push to GitHub → Cloudflare Pages → Connect repo. Build command `npm run build`, output `dist`, add the two env vars. `public/_redirects` handles SPA routing.
## Install
Chrome/Edge desktop & Android: install icon in address bar or menu → Install app. iOS Safari: Share → Add to Home Screen.
## Not yet implemented
Subtasks/tags/projects UI, recurrence, calendar, focus timer, push reminders, offline write queue, settings page, automated tests.
