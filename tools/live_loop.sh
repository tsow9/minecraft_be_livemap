#!/bin/bash
# The frequent check: who is online and where players are.
# With nobody playing it runs once and ends. While someone plays it keeps going, looking every
# LOOP_SECONDS for a new world save, so positions and the map follow soon after Realms saves.
# It ends after LOOP_BUDGET seconds (the next run takes over) or once nobody has played for IDLE_EXIT seconds.
set -u
LOOP_SECONDS=${LOOP_SECONDS:-20}
LOOP_BUDGET=${LOOP_BUDGET:-3000}
IDLE_EXIT=${IDLE_EXIT:-180}

started=$(date +%s)
last_online=0
last_stamp=""
last_map=0
owner=$(echo "$GITHUB_REPOSITORY_OWNER" | tr '[:upper:]' '[:lower:]')
share_url=$(python3 -c "import json; print(json.load(open('config.json')).get('shareUrl') or '')")

mkdir -p live
if git fetch -q --depth 1 origin live-data; then git archive FETCH_HEAD | tar -x -C live; fi

publish() {
  # Single force-pushed commit so the branch never grows.
  (
    cd live
    rm -rf .git
    git init -q -b live-data
    git add live.json
    git -c user.name='github-actions[bot]' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
      commit -q -m "参加中の人と現在地 $(date -u '+%F %H:%M:%S')"
    git push -q -f "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" live-data
  ) || echo "live-data への保存に失敗しました"
  # The site reads this copy every few seconds.
  if [ -n "$share_url" ] && [ -n "${SHARE_PASSPHRASE:-}" ]; then
    curl -sS --max-time 20 -o /dev/null -w '共有サーバー: %{http_code}\n' -X POST "$share_url/live" \
      -H "Origin: https://$owner.github.io" -H "X-Passphrase: $SHARE_PASSPHRASE" \
      -H 'Content-Type: application/json' --data-binary @live/live.json || true
  fi
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
        echo "ワールドの保存は前回のまま"
      fi
    fi
    out=$(mktemp)
    GITHUB_OUTPUT=$out python3 tools/live_update.py update live/live.json members.json $world
    publish
    # Redraw the map when live_update asks for it (a new save while playing, or hourly), at most once a minute.
    if grep -q 'run_map=true' "$out" && [ $((now - last_map)) -ge 60 ]; then
      gh workflow run map.yml --ref main -f action=地図を更新 && last_map=$now
    fi
    rm -f "$out"
    if python3 -c "import json,sys; sys.exit(0 if any(m.get('online') for m in json.load(open('members.json')).get('members', [])) else 1)"; then
      last_online=$now
    fi
  fi
  [ $last_online -eq 0 ] && break                                  # nobody playing: one look is enough
  [ $((now - last_online)) -ge "$IDLE_EXIT" ] && break             # everyone has left
  [ $((now - started)) -ge "$LOOP_BUDGET" ] && break                # hand over to the next run
  sleep "$LOOP_SECONDS"
done
