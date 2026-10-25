'use strict'
// Downloads the current Realm world as .mcworld using the saved login, then re-saves refreshed tokens.
const crypto = require('crypto')
const fs = require('fs')
const { pack, unpack } = require('./secure-cache')
const { ENC_FILE, SECRET, tempCacheDir, makeAuth, makeApi, pickOwnedRealm } = require('./common')

async function main () {
  const out = process.argv[2] || 'world.mcworld'
  if (!fs.existsSync(ENC_FILE)) {
    throw new Error('ログイン情報がありません。Actions の「地図サイト」から「Realmsにログイン」を実行してください')
  }
  const dir = tempCacheDir()
  try {
    unpack(ENC_FILE, dir, SECRET)
    // Never show a sign-in code from the unattended job; ask for a manual login instead.
    const auth = makeAuth(dir, () => {
      console.error('ログインの有効期限が切れました。「Realmsにログイン」をもう一度実行してください')
      process.exit(1)
    })
    const api = makeApi(auth)
    const realm = await pickOwnedRealm(api, auth)
    const download = await api.getRealmWorldDownload(realm.id, realm.activeSlot, 'latest')
    const buf = await download.getBuffer()
    fs.writeFileSync(out, buf)
    pack(dir, ENC_FILE, SECRET)
    const hash = crypto.createHash('sha256').update(buf).digest('hex')
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `world_hash=${hash}\n`)
    console.log(`ワールドをダウンロードしました(${(buf.length / 1048576).toFixed(1)} MB)`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

main().catch((e) => { console.error('ダウンロードに失敗しました:', e.message); process.exit(1) })
