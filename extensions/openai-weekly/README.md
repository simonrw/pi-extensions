# OpenAI weekly limit

Adds `OpenAI weekly [████████░░] 79% left` to pi's existing footer. Shows the account-wide Codex weekly allowance, not this session's token usage. Remains visible when switching models.

Uses pi's `openai-codex` login, fetches on session start, then waits 60 seconds between requests. Requests time out after 10 seconds. Shutdown and reload cancel polling. No credentials means no indicator; failed requests or missing weekly limits show `OpenAI weekly unavailable`.

Uses the same `/backend-api/wham/usage` endpoint as Codex. This is not a public, stable OpenAI API. Credentials are resolved through pi and are never logged or saved by this extension.

Try this checkout with `pi -e ./extensions/openai-weekly/index.ts`. For the git-installed package, commit and push the change, run `pi update --extensions`, then `/reload` in existing sessions.

Run checks with `npm test` on Node 22.18 or newer. Tests use mocked authentication and HTTP responses; they do not contact OpenAI.
