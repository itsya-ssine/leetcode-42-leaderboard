## Run Locally

```
npm install
npm run dev
```

By default this runs on a local SQLite file (`local.db`) — no setup needed.

## Using a real database (Turso)

`local.db` won't survive a redeploy on most free hosts. To persist data,
point it at a free [Turso](https://turso.tech) database instead:

```
cp .env.example .env
# fill in TURSO_DATABASE_URL and TURSO_AUTH_TOKEN (see .env.example for how)
npm run dev
```

No code changes needed either way — same `@libsql/client` API, just two
env vars.
