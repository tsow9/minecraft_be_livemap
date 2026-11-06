#!/bin/bash
# The frequent check: who is online and where players are.
# With nobody playing it runs once and ends. While someone plays it keeps going, looking every
# LOOP_SECONDS for a new world save, so positions and the map follow soon after Realms saves.
# It ends after LOOP_BUDGET seconds (starting the next run itself, which picks up at once) or once nobody has played
# for IDLE_EXIT seconds.
set -u
# Messages in the owner's language (repository variable LANGUAGE → BLOCKMAP_LANG): English for "en", else Japanese.
t() { case "${BLOCKMAP_LANG:-ja}" in en*) printf '%s' "$2" ;; *) printf '%s' "$1" ;; esac; }
LOOP_SECONDS=${LOOP_SECONDS:-20}
LOOP_BUDGET=${LOOP_BUDGET:-3000}
IDLE_EXIT=${IDLE_EXIT:-180}

started=$(date +%s)
last_online=0
last_stamp=""
last_map=0
site_url=$(bash tools/site_url.sh)
live_pass=$(python3 tools/site_keys.py --live-pass)
[ -n "$live_pass" ] && echo "::add-mask::$live_pass"
[ -n "$site_url" ] || echo "::warning::$(t 'Cloudflare のサイトの住所がわからないので、位置はサイトに送りません' 'The Cloudflare site address is unknown, so positions are not sent to the site')"

bash tools/vault.sh get live-data live

publish() {
  # The site reads this copy every few seconds.
  if [ -n "$site_url" ] && [ -n "$live_pass" ]; then
    curl -sS --max-time 20 -o /dev/null -w "$(t 'サイトへ送信' 'Sent to the site'): %{http_code}\n" -X POST "$site_url/api/live" \
      -H "X-Passphrase: $live_pass" -H 'Content-Type: application/json' --data-binary @live/live.json || true
  fi
  # Kept (encrypted) for the next run and the map drawing.
  bash tools/vault.sh put live live-data || echo "$(t 'live-data への保存に失敗しました' 'Could not save to live-data')"
}

while :; do
  now=$(date +%s)
  if node tools/realms/live.js members.json live/live.json; then
    world=""
    if [ "$(python3 tools/live_update.py need-world live/live.json members.json)" = "true" ]; then
      # Download only when Realms has saved again since the last look.
      stamp=$(node tools/realms/world_stamp.js) || stamp=""
      if [ -z "$stamp" ] || [ "$stamp" != "$last_stamp" ]; then
        rm -f world.mcworld
        if GITHUB_OUTPUT=/dev/null node tools/realms/download.js world.mcworld members.json; then
          world=world.mcworld
          last_stamp=$stamp
        fi
      else
        echo "$(t 'ワールドの保存は前回のまま' 'The world save has not changed')"
      fi
    fi
    out=$(mktemp)
    GITHUB_OUTPUT=$out python3 tools/live_update.py update live/live.json members.json $world
    publish
    # Redraw the map when live_update asks for it (a new save while playing, or hourly), at most once a minute.
    if grep -q 'run_map=true' "$out" && [ $((now - last_map)) -ge 60 ]; then
      gh workflow run map.yml --ref main -f action='Update map' && last_map=$now
    fi
    rm -f "$out"
    if python3 -c "import json,sys; sys.exit(0 if any(m.get('online') for m in json.load(open('members.json')).get('members', [])) else 1)"; then
      last_online=$now
    fi
  fi
  [ $last_online -eq 0 ] && break                                  # nobody playing: one look is enough
  [ $((now - last_online)) -ge "$IDLE_EXIT" ] && break             # everyone has left
  if [ $((now - started)) -ge "$LOOP_BUDGET" ]; then
    # Someone is still playing: start the next run now (it begins as soon as this one ends), so following them
    # carries on without waiting for the next timer.
    gh workflow run live.yml --ref main >/dev/null 2>&1 && echo "$(t '次の位置確認に引き継ぎます' 'Handing over to the next live check')"
    break
  fi
  sleep "$LOOP_SECONDS"
done
