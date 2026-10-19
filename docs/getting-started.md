# Getting started

[Documentation index](README.md) · [Noema home](../README.md)

## Run

Requires **Node.js 22.13 or newer** with `node:sqlite` support (tested with Node 25.8).

```sh
npm install
npm start
```

Open **http://localhost:3000**. LAN access is enabled by default. Turn it off in **Settings → Security** to accept connections only from this computer. Stop it with Ctrl+C. For development, use `npm run dev`: the Node server runs on port 3000 and Vite serves the frontend on http://127.0.0.1:5173, proxying API requests to Node. `npm start` type-checks and builds the app, then serves the frontend and API together from Node. `npm run build` creates production output in `dist/`; `npm run typecheck` checks TypeScript separately.

To use another port or database:

```sh
PORT=3001 DB_PATH=./data/another.sqlite npm start
```

### Access from other devices on your local network

LAN access defaults to on (`LAN=1`) for the built app and API on port 3000:

```sh
npm start
```

For development, expose the Vite frontend on port 5173 and the Node API together:

```sh
npm run dev
```

Keep the terminal running and open `http://<your-Mac-LAN-IP>:3000` (built app) or `http://<your-Mac-LAN-IP>:5173` (development) on a device connected to the same network. The terminal prints available LAN addresses. Allow incoming Node connections if macOS asks. A guest Wi-Fi network may block connections between devices.

| Setting | Default | Purpose |
| --- | --- | --- |
| `LAN` | `1` | Initial private IPv4 LAN access (`1`/`true` or `0`/`false`). A saved Settings → Security choice takes precedence. |
| `NOEMA_LAN` | Unset | Legacy alias for `LAN`; if supplied, takes precedence over `LAN` for the initial setting. |
| `NOEMA_LAN_HOST` | `0.0.0.0` | Restrict LAN access to a specific private IPv4 interface. Localhost remains available for managing settings. |
| `NOEMA_ALLOWED_HOSTS` | Detected private IPv4 addresses and the machine hostname, including its `.local` name | Replace automatic LAN host detection with a comma-separated list of hostnames/IPs that clients may use. Use bare names without schemes, ports, paths, or wildcards. Localhost and a specific bind address remain allowed. Requires LAN mode. |
| `PORT` | `3000` | Node API/built-app port. The development proxy follows this setting; Vite normally uses 5173 and prints its actual port. |

For example, to allow LAN access only through your Mac's current LAN address:

```sh
NOEMA_LAN=1 NOEMA_LAN_HOST=192.168.1.25 npm run dev
```

Use your own address in place of `192.168.1.25`. Restart after changing environment variables or the Mac's IP. **Settings → Security → Allow LAN connections** applies immediately to the built server and development frontend, and persists across restarts in `<database-path>.network.json`. Turning it off rejects new remote connections and closes existing remote connections; `http://localhost:3000` (or `http://localhost:5173` in development) remains available on the host computer to turn it back on. Pending note edits are saved before the UI changes LAN access. The listeners retain their interface capacity so toggling does not require restarting the server. Before a preference has been saved, start with `LAN=0 npm start` for local-only access.

LAN mode keeps peer-address restrictions, an explicit Host allowlist, and same-origin API checks. It does **not** add user accounts or HTTPS: devices on the allowed network can read and change unlocked vaults, vault locks are shared across devices, and optional AI features use the host Mac's configured credentials. Use it on a trusted network and do not forward these ports through your router. Plain HTTP LAN editing uses cryptographically generated UUIDs even when the browser's HTTPS-only `randomUUID` API is unavailable.

## First launch

The first run seeds a welcome page, a book, two people, and a place. Seeding only happens once per database.
