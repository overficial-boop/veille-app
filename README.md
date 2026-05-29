# Veille

Turn a plain-language intent into a **living dossier** — Veille assembles the sources, watches them over time, and presents the result.

Web-first rebuild: pnpm monorepo, Next.js 15 + better-auth + PostgreSQL/Drizzle, with `@veille/core` + adapters + discovery as portable packages.

## Local development

**Prerequisites:** Node 22, pnpm 10, and access to the dev database (VPS Postgres via SSH tunnel).

```bash
# 1. Install
pnpm install

# 2. Open the DB tunnel (keep this running in its own terminal)
ssh -L 15432:localhost:5432 root@178.104.52.131 -N

# 3. Configure env
cp .env.example apps/web/.env.local
#   then fill in: DATABASE_URL (postgresql://veille:<pw>@localhost:15432/veille_dev),
#   BETTER_AUTH_SECRET (openssl rand -hex 32), RESEND_API_KEY, RESEND_FROM_EMAIL,
#   VEILLE_GEMINI_KEY, VEILLE_TAVILY_KEY, SUPADATA_API_KEY

# 4. Apply migrations (needs the tunnel open)
pnpm --filter @veille/web db:migrate

# 5. Run
pnpm --filter @veille/web dev      # http://localhost:3000

# Sign in: enter your email → click the magic link.
```

## Commands

```bash
pnpm build        # build all packages
pnpm test         # build packages + run vitest
pnpm typecheck    # typecheck all packages
pnpm --filter @veille/web build       # build the web app
pnpm --filter @veille/web db:generate # generate a migration from schema changes
pnpm --filter @veille/web db:migrate  # apply migrations
```

## Layout

```
packages/
  core/            @veille/core — Fact schema, extract registry, pipeline, LLM clients
  adapter-youtube/ @veille/adapter-youtube — transcripts (Supadata), metadata
  adapter-web/     @veille/adapter-web — jsdom + Readability
  adapter-text/    @veille/adapter-text
  adapter-pdf/     @veille/adapter-pdf
  discovery/       @veille/discovery — query planner + providers
apps/web/          Next.js 15 app (auth, db, UI)
```

See `CLAUDE.md` for architecture, the milestone roadmap, and operational gotchas.
