'use strict'
// Downloads the current Realm world as .mcworld and writes the member list (hashed IDs) next to it.
const crypto = require('crypto')
const fs = require('fs')
const { withSavedLogin, pickOwnedRealm, realmStatus } = require('./common')

async function main () {
  const out = process.argv[2] || 'world.mcworld'
  const membersFile = process.argv[3] || 'members.json'
  await withSavedLogin(async (auth, api) => {
    const realm = await pickOwnedRealm(api, auth)
    const { members, realm: info } = await realmStatus(api, auth, realm.id)
    // Keep the backup and subscription details the member check may have just looked up.
    try {
      const before = JSON.parse(fs.readFileSync(membersFile, 'utf8')).realm || {}
      for (const k of ['backups', 'subscription', 'billing', 'extrasAt']) if (before[k] !== undefined) info[k] = before[k]
    } catch { /* no earlier file */ }
    fs.writeFileSync(membersFile, JSON.stringify({ fetchedAt: Date.now(), members, realm: info }))
    const download = await api.getRealmWorldDownload(realm.id, realm.activeSlot, 'latest')
    const buf = await download.getBuffer()
    fs.writeFileSync(out, buf)
    const hash = crypto.createHash('sha256').update(buf).digest('hex')
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `world_hash=${hash}\n`)
    console.log(`ワールドをダウンロードしました(${(buf.length / 1048576).toFixed(1)} MB、メンバー ${members.length}人)`)
  })
}

main().catch((e) => { console.error('ダウンロードに失敗しました:', e.message); process.exit(1) })
