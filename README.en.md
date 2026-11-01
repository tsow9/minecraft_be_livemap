# Blockmap — a map site for Minecraft Bedrock Realms

[日本語](README.md)

Turns the world you play on your Realm into a map you can open in any phone or PC browser. The map updates itself in the cloud; nothing needs to run on your own computer. It fits in free plans (your Realm subscription aside).

- **Only your Realm's members can see it**: people get in with "Sign in with Microsoft". Nobody else does.
- **Your data stays yours**: the map, what is in chests and where players are live only in your own (free) Cloudflare account. It passes through nobody else's server, the author's included.

## What it does

| | |
|---|---|
| Map | Overworld, Nether, The End. Zoom down to single blocks; see coordinates, height, block and biome |
| Players | Where people are while they play (about every 20 s), beds, last death points, 24-hour trails |
| Search | Coordinates, villagers (profession, level, trades), Wandering Traders, chest contents, signs, pets, biomes |
| Draw | Pins, text, lines, polygons, rectangles, circles, ellipses, snapped to blocks. Shared with your members, marked with who made them |
| Past maps | Go back to the map of any kept day, or play the changes over time |
| Overlays | Contours, slime chunks, chunk lines, Nether coordinate converter, who explored where (estimated), where Nether Portals link |
| Realms info | Open or closed, who is on, difficulty and game rules, next payment day |
| Languages | 日本語 and English (game words use the game's own translations) |

## Getting started (the person setting it up = the Realm's owner)

Only a Realm's owner can download its world, so **the owner** sets this up. About 30 minutes by hand.

You need (all free): the Microsoft account you play Minecraft with, a [GitHub](https://github.com/) account and a [Cloudflare](https://dash.cloudflare.com/sign-up) account.

### 1. Make your own copy of this repository

1. **Use this template** at the top of this page → "Create a new repository"
2. Any name. Leave it **Public** (so GitHub Actions is free; the data is encrypted, so nobody can read it)
3. Do **not** tick "Include all branches"

### 2. Cloudflare

1. Sign in to Cloudflare and open **Workers & Pages** once. If asked for a workers.dev name (subdomain), pick one
   - Your site will be at `https://map.(that name).workers.dev`
2. Profile icon (top right) → "My Profile" → "API Tokens" → **Create Token**
3. **Use template** on "Edit Cloudflare Workers", add one permission row **Account / D1 / Edit**, and create it. Copy the **token** (it is shown only once)
4. Copy the **Account ID** shown on the right of the Workers & Pages page

### 3. Give GitHub the keys

In your copy: **Settings → Secrets and variables → Actions → New repository secret**, add these four.

| Name | Value |
|---|---|
| `REALMS_CACHE_KEY` | About 40 random characters (use a password generator). You never need to remember it |
| `SHARE_PASSPHRASE` | Another, different 40 random characters |
| `CLOUDFLARE_API_TOKEN` | The token from step 2-3 |
| `CLOUDFLARE_ACCOUNT_ID` | The Account ID from step 2-4 |

If you own more than one Realm, also add `REALM_NAME` (the Realm's name) under **Variables** on the same page.

### 4. Sign in to Realms

1. **Actions** in your repository → (the first time, enable workflows) → **地図サイト** on the left → **Run workflow**
2. Choose **Realmsにログイン** ("sign in to Realms") and run it
3. Open the running job → login → the step "Realmsにログイン(下に出るコードを入力してください)"
4. Open https://www.microsoft.com/link, enter the code shown, and sign in with **the Realm owner's account** (within 15 minutes)

### 5. Make the map

1. **Run workflow** again, this time with **地図を更新** ("update the map")
2. When it finishes (a few minutes), the run's summary shows "招待制のサイト: https://map.….workers.dev"
3. Open that address and sign in with Microsoft. You are the site's **admin**

From then on it runs itself: the map every hour (and after each save while someone plays), who is online and where every 10 minutes (every 20 seconds while someone plays).

## Telling your members

- **Admin menu** (the shield on the right) → "Copy site URL", and send the address to your members.
- They open it and sign in with the Microsoft account they play with. That is all.
- Everyone starts as view only. Turn on "Who can edit" in the admin menu for anyone who should add pins and drawings.
- The admin menu also sets the Realm's payment day and price (shown in Realms info) and what to keep off the map (all chests, other players' pets).

## Safety and privacy

- **The Realms sign-in** (step 4) reaches Realms the way Minecraft on Nintendo Switch does (using [prismarine-auth](https://github.com/PrismarineJS/prismarine-auth)). No password is handled. It can act on Xbox Live and Realms, not on your email, OneDrive or payment details. It is kept encrypted with `REALMS_CACHE_KEY`, only in your repository's GitHub cache.
- **Signing in to the site** only checks the gamertag; the Microsoft token is dropped right away. The site keeps a signed-in mark, the gamertag and a hashed ID.
- The map data is on GitHub **only encrypted** (`map-data` and `live-data` branches), and only members get into the site. Only the program is public.
- Recommended: turn on two-step verification for your Microsoft and GitHub accounts. If in doubt, "Sign out everywhere" under your Microsoft account's Security page ends the Realms sign-in (then do step 4 again).
- Realms access uses interfaces Microsoft has not published. A change on their side may stop it working.

## When something goes wrong

Read the message in the run's page under Actions.

| Message | What to do |
|---|---|
| まだ「Realmsにログイン」をしていない (not signed in to Realms yet) | Do step 4 |
| ログイン情報がありません / 有効期限が切れました (no sign-in / it expired) | Do step 4 again |
| Realmが2個以上あります (more than one Realm) | Add `REALM_NAME` (step 3) |
| Cloudflare の Secrets がそろっていない (Cloudflare secrets missing) | Check the four secrets of step 3 |
| 公開先のアドレスがわかりませんでした (address not found) | Do step 2-1 (pick the workers.dev name), then update the map again |
| ブランチをこの鍵で開けませんでした (branch cannot be opened with this key) | If you changed `REALMS_CACHE_KEY`, put it back. Otherwise delete that branch (the map starts over) |
| Updates stopped | GitHub pauses scheduled runs in public repositories after 60 days without activity. Turn them back on under Actions |

## How it works

```
地図サイト / map site (.github/workflows/map.yml; hourly, or started by the live check while people play)
  download the world from Realms (tools/realms)
  → stop if unchanged
  → tiles, items.json and more (tools/render_map.py and others)
  → encrypted into the map-data branch (tools/vault.sh)
  → published as a Cloudflare Worker with static files (worker/, tools/build_site.py)

参加中の人と現在地 / live check (.github/workflows/live.yml; every 10 min, every 20 s while people play)
  members and who is online → while people play, player positions from the world
  → sent to the site's /api/live, and kept encrypted in the live-data branch
```

- `worker/worker.js`: Microsoft sign-in (PKCE; the token is dropped at once), checks members by HMAC'd IDs, stores pins in D1, takes out what the admin hides before sending chest and pet data.
- Map files sit in a folder with an unguessable name that only signed-in pages are told.
- `tools/render_map.py` reads the world's LevelDB in plain Python and colours each column by its top block (with shading and water depth).
- To try it locally: `python tools/build_site.py <map data> _site`, then `python -m http.server` in `_site`.

## Built with

- [Leaflet](https://leafletjs.com/) (BSD-2-Clause), [Leaflet-Geoman](https://geoman.io/) free (MIT)
- [prismarine-auth](https://github.com/PrismarineJS/prismarine-auth) / [prismarine-realms](https://github.com/PrismarineJS/prismarine-realms) (MIT)
- [NumPy](https://numpy.org/) / [Pillow](https://python-pillow.org/)
- Pet faces and the names of items and blocks are made from the official [bedrock-samples](https://github.com/Mojang/bedrock-samples) at each map update; no official art or text is kept in this repository.
- Font: [M PLUS Rounded 1c](https://fonts.google.com/specimen/M+PLUS+Rounded+1c) (Google Fonts)
