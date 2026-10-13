# E-Library sync server

A small Go server that sits between the **E-Library Parent** desktop app and the child laptops.

- **Parents** sign in from the Parent app to manage content, laptops, time limits and requests.
- **Laptops** check in every minute. They download their library and send back requests, activity, child
  profiles and usage.
- **Uploaded videos and PDFs** are stored on the server. Laptops download them through signed links and keep
  them for offline use.

It is a single binary with a SQLite database in `ELIB_DATA_DIR`. It needs no cgo and no external database.

## Run it

```bash
go run .                                    # http://localhost:8080, data in ./data
go test ./...                               # integration tests
```

| Variable | Default | Meaning |
|---|---|---|
| `ELIB_ADDR` | `:8080` | Listen address |
| `ELIB_DATA_DIR` | `./data` | Database, uploaded files, signing key |
| `ELIB_PUBLIC_URL` | (from request) | Public `https://` address. **Set this in production**: it is used in the file links sent to laptops, and if it changes, laptops re-download every file. |
| `ELIB_ALLOW_SIGNUP` | off | The first account can always be created; set to `1` to allow more parent accounts |
| `ELIB_MAX_UPLOAD_MB` | `2048` | Largest upload |
| `ELIB_SECRET` | generated | Key that signs file links (auto-created in `secret.key`) |

## Deploy (Docker + automatic HTTPS)

```bash
cd deploy
# edit library.example.org in docker-compose.yml and Caddyfile, point DNS at the machine
docker compose up -d
```

Without Docker, use [deploy/elibrary-server.service](deploy/elibrary-server.service) behind Caddy or nginx.
**Always serve it over HTTPS.** The Parent app refuses plain `http://` except on a local network.

Back up `ELIB_DATA_DIR`. It holds the database, the uploaded files and the signing key.

## Security notes

- Parent passwords are hashed with bcrypt. Sessions are random tokens, stored as SHA-256 hashes, that expire
  after 30 days. Changing the password signs out other sessions. Login and registration are rate-limited by
  IP address.
- Each laptop has its own random token, stored hashed. **New token** in the Parent app revokes the old one
  immediately.
- All parent data is scoped to the account, and the tests check that one account cannot read or change
  another's.
- File links are signed with HMAC. They work only as handed out, and stop working when the item is deleted.

## API

The parent endpoints need `Authorization: Bearer <session token>`.

| Method | Path | |
|---|---|---|
| GET | `/api/v1/auth/status` | `{signup_open, has_accounts}` |
| POST | `/api/v1/auth/register`, `/api/v1/auth/login` | `{email, password}` → `{token, email}` |
| POST | `/api/v1/auth/logout`, `/api/v1/auth/password` | |
| GET | `/api/v1/me` | |
| GET/POST | `/api/v1/devices` | POST `{name}` → `{id, token}` (token shown once) |
| PATCH/DELETE | `/api/v1/devices/{id}` | name, `daily_limit_minutes`, `schedule_*` |
| POST | `/api/v1/devices/{id}/token` | new token |
| POST | `/api/v1/devices/{id}/grants` | `{minutes}`: extra time today |
| GET/POST, PATCH/DELETE | `/api/v1/categories[/{id}]`, POST `/api/v1/categories/reorder` | |
| GET/POST, PATCH/DELETE | `/api/v1/content[/{id}]`, POST `/api/v1/content/reorder` | |
| POST | `/api/v1/files` | multipart `file` → `{key}`; use as `file_key` / `thumb_file_key` |
| GET | `/api/v1/requests?status=` | POST `/api/v1/requests/{id}/resolve` `{status}` |
| GET | `/api/v1/activity?device_id=&limit=` | |

The laptop endpoints need `Authorization: Bearer <device token>`. `{hw}` is the laptop's own device ID.

| Method | Path | |
|---|---|---|
| GET | `/api/v1/devices/{hw}/library` | Full manifest: categories, content, request decisions, settings, usage grants |
| POST | `/api/v1/devices/{hw}/events` | `{requests, activity, children, usage, app}` |
| GET | `/files/{key}?sig=…` | Signed download; supports range requests |
