# Deploy frontend on Vercel

This deployment contains only the static frontend. Audio requests go directly
from the visitor's browser to the backend exposed by Cloudflare Tunnel.

## Configure the backend

Edit `config.js` before deploying:

```js
window.BWE_API_BASE_URL = "https://your-stable-backend-domain.example.com";
```

Do not include `/restore` at the end. The URL must use HTTPS and must not end
with a slash.

For a temporary Quick Tunnel URL:

```js
window.BWE_API_BASE_URL = "https://example.trycloudflare.com";
```

Quick Tunnel URLs change when the tunnel restarts. A named Cloudflare Tunnel
with a hostname such as `api.modelbwe.com` avoids redeploying the frontend.

## Deploy

Upload the contents of the `vercel-frontend` package to a Vercel project, or
run these commands inside that folder:

```bash
npx vercel
npx vercel --prod
```

Vercel provides a free `vercel.app` URL. A custom domain can then be added from
Project Settings > Domains.

## Availability

The Vercel page remains online independently. Restoration works only while all
of these are running:

- The Windows computer.
- WSL.
- `python server.py`.
- `cloudflared`.
