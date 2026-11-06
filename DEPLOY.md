# Deploying to client.keyset.in

The app is a single Next.js server (pages and API together), so only `client.keyset.in` is needed.
It runs in Docker behind the VPS's existing Nginx reverse proxy; Certbot manages HTTPS. The database is MongoDB Atlas.

## 1. MongoDB Atlas

1. Use a cluster (M0 free tier works) and a database user with read/write access.
2. **Network Access:** add the VPS's public IP.
3. Copy the connection string and add the database name before the `?`:
   `mongodb+srv://USER:PASS@cluster.xxxx.mongodb.net/client-portal?retryWrites=true&w=majority`

## 2. DNS

Where keyset.in's DNS is managed (Vercel, today), add an **A record**: `client` → the VPS's public IP.
Check it before step 4: `getent hosts client.keyset.in` should print the VPS IP.

## 3. The server (Ubuntu/Debian with Docker)

```bash
# Docker, if missing
curl -fsSL https://get.docker.com | sh

# Ports 80 and 443 must be open for Nginx and Certbot
sudo ufw allow 80,443/tcp && sudo ufw allow 443/udp   # if ufw is enabled

git clone git@github.com:zaidachhwa/client-portal.git && cd client-portal
cp .env.production.example .env.production
nano .env.production    # MONGODB_URI, CLOUDINARY_URL, RESEND_API_KEY, MAIL_FROM
```

Uploads need `CLOUDINARY_URL` (recommended); without it files go to the `uploads` Docker volume on the server.
`MAIL_FROM` must use a domain verified in Resend (e.g. `portal@keyset.in`).

## 4. Start it

```bash
sudo ss -ltnp | grep ':14002'   # Choose another unused port if this prints a listener
sudo docker compose -f docker-compose.prod.yml up -d --build --remove-orphans
sudo docker compose -f docker-compose.prod.yml logs -f app      # Ctrl+C to stop following
```

The first build takes a few minutes. The app listens only on `127.0.0.1:14002`, leaving public ports 80 and 443 to Nginx.

Install the included Nginx site and request its certificate:

```bash
sudo cp deploy/nginx-client.keyset.in.conf /etc/nginx/sites-available/client.keyset.in
sudo ln -s /etc/nginx/sites-available/client.keyset.in /etc/nginx/sites-enabled/client.keyset.in
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d client.keyset.in
```

Then https://client.keyset.in should load the sign-in page. If the site symlink already exists, skip the `ln` command.

## 5. Create your organization and admin (once)

From any machine with this repo and Node 24+ (your laptop is fine):

```bash
MONGODB_URI="<the Atlas string>" npm run setup
```

It asks for the organization name, your name, email and password, then creates them in the empty database.
It refuses to run twice. **Never run `npm run seed` against production**: it wipes the database for demo data.

Then sign in at https://client.keyset.in and open **Settings** to add your GSTIN, address and state.

## Updating

```bash
cd client-portal && git pull
sudo docker compose -f docker-compose.prod.yml up -d --build --remove-orphans
```

## Useful

- Logs: `sudo docker compose -f docker-compose.prod.yml logs -f app`
- Restart: `sudo docker compose -f docker-compose.prod.yml restart app`
- Retention job (dry run, then apply): `MONGODB_URI=… npm run retention` / `… -- --apply`
