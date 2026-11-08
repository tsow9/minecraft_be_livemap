# Chizuya

[日本語](README.md)

A map of your Minecraft Bedrock Realm, in the browser. The map updates itself in the cloud; no PC needs to stay on.

![Chizuya (a village: villagers, chests and a trade)](docs/screenshot-en.webp)

- Only the Realm's members can see the map (sign in with Microsoft).
- The map and other data are stored only in your own Cloudflare account.
- Runs on the free plans of GitHub and Cloudflare.

## Features

- **Map**: Overworld, Nether and The End. Zoom in to single blocks and see coordinates, height, block and biome.
- **Players**: positions while playing (about every 20 seconds), beds, last death points and 24-hour trails.
- **Search**: coordinates, villagers (profession, level, trades), Wandering Traders, chest contents, signs, pets and biomes.
- **Drawing**: pins, text, lines, polygons, rectangles, circles and ellipses, snapped to blocks and shared with members.
- **Past maps**: go back to any saved day, or play the changes in order.
- **Worlds**: if the Realm switches between worlds (slots), each keeps its own map; switch from the date in the corner. Pins and drawings belong to their world.
- **Overlays**: contours, slime chunks, chunk lines, Nether coordinate converter, who explored where (estimated), Nether Portal links.
- **Realms info**: server status, players online, difficulty, game rules and the next payment day.
- **Languages**: Japanese and English (game terms use the official translations).

## Requirements

- The Realm owner's Microsoft account (only the owner can download the world)
- A [GitHub](https://github.com/) account (free)
- A [Cloudflare](https://dash.cloudflare.com/sign-up) account (free)

## Setup

Takes about 30 minutes. The [setup page](https://tsow9.github.io/minecraft_be_livemap/setup.html) opens each screen in turn and makes the keys for you; the steps are the same as below.

### 1. Create the repository

1. Select **Use this template** → **Create a new repository** at the top of this page.
2. Keep it **Public** ([why](#why-a-public-repository)).
3. Leave **Include all branches** unchecked.
4. The repository's name (e.g. `chizuya`) becomes the start of your site's address.

### 2. Prepare Cloudflare

1. In the Cloudflare dashboard, go to **My Profile** → **API Tokens** → **Create Token**.
2. Choose the **Edit Cloudflare Workers** template, add the permission **Account / D1 / Edit**, and create the token. Copy it (it is shown only once).

The site will be at `https://<repository name>.<subdomain>.workers.dev`. You can choose the subdomain on the **Workers & Pages** page; if you have not, one is chosen from your GitHub username (shown in the run's log).

### 3. Add the token

In the new repository, go to **Settings** → **Secrets and variables** → **Actions** → **New repository secret** and add:

| Name | Secret |
|---|---|
| `CLOUDFLARE_API_TOKEN` | The token from step 2 |

The key that encrypts the data is made automatically on the first run and kept in the site's Cloudflare database.

Only if needed, also add these (`CLOUDFLARE_ACCOUNT_ID` under **Secrets**, the rest under **Variables**).

| Name | Value |
|---|---|
| `LANGUAGE` | The language of the messages in the Actions runs (`ja` or `en`). If left out: the language of the browser the admin views the map site in (before that, the setup page's) |
| `TIMEZONE` | The time zone for the map's dates, e.g. `America/New_York`. If left out: the admin's browser's |
| `REALM_NAME` | The name of the Realm this site maps (as in Minecraft's list of Realms). Even with two or more Realms it is usually not needed: you pick one on the setup page after signing in. Use it to change the choice later |
| `CLOUDFLARE_ACCOUNT_ID` | If one Cloudflare sign-in reaches several accounts (for example, you were invited to someone else's): the ID of the one to use. Not needed for accounts made with separate email addresses |

### 4. Sign in to Realms

1. Once the token is added, signing in starts by itself in about a minute. To start at once: **Actions** tab → **Map site** → **Run workflow** → the green **Run workflow** (What to do: **Sign in to Realms**).
2. Wait 2–3 minutes (the site is put up first): the [setup page](https://tsow9.github.io/minecraft_be_livemap/setup.html) shows the code (so does the running **login** job in Actions, in a box).
3. Enter the code at https://www.microsoft.com/link.
4. Sign in with the Realm owner's account (within 15 minutes). Afterwards Microsoft says "Minecraft for Nintendo Switch"; that is expected ([why](#security-and-privacy)).
5. Once signed in, making the map starts by itself. A few minutes later the run's Summary shows "Site: https://chizuya.….workers.dev".
6. Open that address and sign in with Microsoft. The person who set it up is the admin.

The [setup page](https://tsow9.github.io/minecraft_be_livemap/setup.html) shows where the code is and how the map is getting on.

From then on it updates automatically.

| What | How often |
|---|---|
| Map | Every hour (each time the world is saved while someone plays) |
| Players online and positions | Every 10 minutes (every 20 seconds while someone plays) |

## Why a public repository

**Why it must be public**: the map updates and the player checks run on GitHub Actions, which is free without limit for public repositories but limited to 2,000 minutes a month for private ones. Chizuya uses about 4,000 minutes a month on its 10-minute checks alone, so a private repository would stop updating partway through the month.

**Why that is safe**: only the program and encrypted data are public.

| What is public | What it contains |
|---|---|
| The program | The same as this repository |
| The `map-data` and `live-data` branches | Encrypted data, unreadable without the key |
| Actions run history | Whether runs succeeded, and counts. Normal runs show no gamertags or coordinates. The site's address is shown, but only the Realm's members can sign in |
| Your GitHub username | Shown as the repository's owner |

The secrets (keys), the Realms sign-in (encrypted, in Cloudflare) and what is on the site are not public.

## Usage

### Mapping two or more Realms

Make one repository for each Realm, with different names (step 1). Which Realm each maps is picked on the setup page after signing in (or set with `REALM_NAME`). The same GitHub and Cloudflare accounts, and the same token, can be used. Each Realm gets its own site (`https://chizuya.….workers.dev`, `https://chizuya-survival.….workers.dev` and so on), with its own map, members and drawings.

### Inviting members

1. In the **Admin menu** (the shield icon on the right), select **Copy site URL** and send it to your members.
2. Members open the address and sign in with the Microsoft account they play Minecraft with.

### Update timer (recommended)

GitHub's 10-minute and hourly runs can be hours late. Under **Update timer** in the admin menu, add a GitHub token that may only start this repository's runs (fine-grained, Actions: Read and write), and the site starts the live check every 10 minutes itself (the live check updates the map hourly).

### Updating to a new version

When a new version is out, the admin sees "Version … is out" at the bottom of the map site. Press it, and in the admin menu under **Chizuya version** press **Update**: the site moves to the new version in 10 to 20 minutes, with no GitHub screens.

### Admin menu

| Item | What it does |
|---|---|
| Realm payment | Payment day, price and currency, shown in Realms info |
| Hidden from the map | Hides all chests or other players' pets (for everyone, admin included) |
| Who can edit | Members start as view only. Choose who can add pins and drawings |

## Security and privacy

- **Signing in to Realms**: Realms has no public API, so this tool uses [prismarine-auth](https://github.com/PrismarineJS/prismarine-auth) to sign in as the official Minecraft app for Nintendo Switch, a method used by many unofficial tools. Sign-in uses a code, so no password is handled. Access is limited to Xbox Live and Realms; email, OneDrive and payment details are out of reach. The sign-in is encrypted with a key and kept only in the site's Cloudflare database; the key is in the site's Cloudflare database (or the `REALMS_CACHE_KEY` secret).
- **Signing in to the site**: used only to check the gamertag; the Microsoft token is discarded right after. The site keeps the sign-in state, the gamertag and a hashed ID.
- **Where data is stored**: the map, chests and positions are stored in Cloudflare. The `map-data` and `live-data` branches on GitHub hold them only in encrypted form.
- **Recommended**: turn on two-step verification for your Microsoft and GitHub accounts. To revoke the Realms sign-in, use **Security** → **Sign out everywhere** in your Microsoft account (then repeat step 4 to resume).
- Changes on Microsoft's side may stop the Realms download from working.

## Troubleshooting

Check the message shown in the Actions run (in English when the `LANGUAGE` variable is `en`).

| Message | Fix |
|---|---|
| Not signed in to Realms yet | Run step 4 |
| Not signed in / The sign-in has expired | Run step 4 again |
| There are 2 Realms | Pick one in step 4 of the setup page, or add `REALM_NAME` (step 3) |
| The Cloudflare secrets are not all set / Could not find the Cloudflare account / Could not get the key from Cloudflare | Check the token (step 3) and its permissions (step 2) |
| Could not find the site's address | Choose a subdomain under **Workers & Pages** in Cloudflare, then update the map again |
| The … branch cannot be opened with this key | The key has changed (for example, the Cloudflare database was made again). Delete that branch and the map is rebuilt from scratch |
| Scheduled updates stopped | GitHub may pause scheduled runs in public repositories after 60 days without activity. Re-enable them in Actions |

## How it works

```
Map site (.github/workflows/map.yml)
  download the world from Realms (tools/realms)
  → stop if nothing changed
  → build tiles, items.json and more (tools/render_map.py and others)
  → encrypt into the map-data branch (tools/vault.sh)
  → publish as a Cloudflare Worker with static files (worker/, tools/build_site.py)

Live players (.github/workflows/live.yml)
  get members and who is online → while playing, read player positions from the world
  → send to the site's /api/live and keep an encrypted copy in the live-data branch
```

- `worker/worker.js`: Microsoft sign-in (PKCE), member checks by HMAC'd IDs, pin storage (D1), and hiding what the admin chose to hide.
- Map files are kept in a folder with an unguessable name, given only to signed-in pages.
- `tools/render_map.py`: reads the world's LevelDB in Python and colours each column by its top block (with shading and water depth).
- To preview locally, run `python tools/build_site.py <map data> _site`, then `python -m http.server` in `_site`.

## Acknowledgements

- [Leaflet](https://leafletjs.com/) (BSD-2-Clause), [Leaflet-Geoman](https://geoman.io/) free (MIT)
- [prismarine-auth](https://github.com/PrismarineJS/prismarine-auth), [prismarine-realms](https://github.com/PrismarineJS/prismarine-realms) (MIT)
- [NumPy](https://numpy.org/), [Pillow](https://python-pillow.org/)
- [M PLUS Rounded 1c](https://fonts.google.com/specimen/M+PLUS+Rounded+1c) (Google Fonts)
- Pet faces and item/block names are generated from the official [bedrock-samples](https://github.com/Mojang/bedrock-samples) at each map update. No official images or text are included in this repository.

## Privacy and terms

The sites' [Privacy Policy](https://tsow9.github.io/minecraft_be_livemap/privacy.html) and [Terms of Use](https://tsow9.github.io/minecraft_be_livemap/terms.html) are also linked from the sign-in screen.

## License

[MIT License](LICENSE)

Bundled libraries such as Leaflet and Leaflet-Geoman keep their own licenses (see the LICENSE files in `vendor/`).

