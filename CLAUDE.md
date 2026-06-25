# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

小希 AI 温柔女友版 — an AI-companion web app. Frontend: React 19 + Vite 8 (`src/`). Backend: Express + SQLite (`backend/`). `shared/` holds config imported by both. The LLM is an OpenAI-compatible API that **falls back to a local rule-based reply when no key is set**; voice via MiniMax TTS; optional Bocha web search.

## Commands

- `npm run verify` — **the release gate; treat work as done only when this is green.** Runs in order: `check:secrets` → `lint` (`eslint .`) → `npm test` (frontend Vitest) → `npm --prefix backend test` (backend `node --test`) → `npm run build`.
- Frontend dev: `npm run dev` (Vite on :5173, proxies `/api` → :3000). Backend dev: `npm --prefix backend run dev` (`node --watch server.js` on :3000). The two run in separate terminals.
- One frontend test file: `npx vitest run src/<path>.test.jsx`. One backend test file: `node --test backend/tests/<name>.test.js`.
- Backend tests need no manual setup: each file boots the app on an ephemeral port against a temp SQLite DB and runs without an OpenAI key.

## Architecture

- **`backend/` is layered — place new files by responsibility:** `routes/` (only register HTTP endpoints), `services/` (domain logic; with `services/ai/` and `services/memory/` subdomains), `core/` (db, logger, middleware, httpUtils, appError, envUtils, resolveUser), `config/`. `server.js` / `app.js` stay at root; `app.js` applies middleware and registers every `*Routes` module.
- **Two `gameConfig.js` files (easy to confuse):** `shared/gameConfig.js` is the source catalogs (food/gift items, tasks, themes, relationship tiers); `backend/config/gameConfig.js` re-exports it and adds record-form maps. Frontend + `shared` consumers import `shared/gameConfig.js`; backend domain code usually imports `backend/config/gameConfig.js`.
- **Auth:** `core/resolveUser.js` resolves `req.userId`. A bound account must present a `Bearer` HMAC token (server-side revocation via `token_version`); guests are identified by `body.userId`. Endpoints requiring an account guard on `req.accountId` (others work for guests too).

## Conventions

- **Unified API envelope** — success: `{ ok: true, ...data }`; failure: `{ ok: false, error: { code, message } }`. Throw `AppError(status, code, message)` (`core/appError.js`); never hand-roll error responses.
- **React imports** — components use `import * as React from 'react';` then `const { useState } = React;`. Test files use `import React from 'react';` + `void React;`. (`src/hooks/` modules use named `react` imports.)
- **Backend tests use per-file process isolation** (`node --test`): env vars set at the top of a test file (e.g. `REQUIRE_REGISTRATION_OTP`, `OTP_DEV_ECHO`) only affect that file — the way to opt one file into a gated behavior.
- **Env-gated features default OFF and must stay off in production:** `ALLOW_SIMULATED_PAYMENT`, `REQUIRE_REGISTRATION_OTP`, `OTP_DEV_ECHO`. Backend config lives in `backend/.env` (gitignored); `backend/.env.example` documents every knob.

## Reference

- `IMPROVEMENT_LEDGER.md` — running log of every change, decision, and review verdict. Skim it for current status and rationale before large work.
- `backend/API.md` (endpoint contracts) and `backend/OPERATIONS.md` (deploy/ops) are kept current — read them instead of guessing API shapes or ops steps.
