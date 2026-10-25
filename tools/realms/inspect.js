'use strict'
// Diagnostics: shows what the Realms API returns about members, without printing names or IDs.
const fs = require('fs')
const { pack, unpack } = require('./secure-cache')
const { ENC_FILE, SECRET, tempCacheDir, makeAuth, makeApi, pickOwnedRealm } = require('./common')
const { gamertags } = require('./xbox')

async function main () {
  const dir = tempCacheDir()
  try {
    unpack(ENC_FILE, dir, SECRET)
    const auth = makeAuth(dir, () => { console.error('ログインが必要です'); process.exit(1) })
    const api = makeApi(auth)
    const realm = await pickOwnedRealm(api, auth)
    const full = await api.getRealm(realm.id)
    const players = full.players || []
    console.log('Realmの項目:', Object.keys(full).join(', '))
    console.log('メンバー数:', players.length)
    if (players[0]) console.log('メンバーの項目:', Object.keys(players[0]).join(', '))
    console.log('online=true の人数:', players.filter(p => p.online === true).length)
    const ids = players.map(p => p.uuid || p.xuid).filter(Boolean)
    const names = await gamertags(auth, ids)
    console.log('名前を取得できた人数:', Object.keys(names).length, '/', ids.length)
    pack(dir, ENC_FILE, SECRET)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

main().catch((e) => { console.error('診断に失敗しました:', e.message); process.exit(1) })
