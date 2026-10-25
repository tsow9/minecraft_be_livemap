'use strict'
// Downloads the current Realm world as .mcworld and writes the member list (hashed IDs) next to it.
const crypto = require('crypto')
const fs = require('fs')
const { withSavedLogin, pickOwnedRealm, realmMembers } = require('./common')

async function main () {
  const out = process.argv[2] || 'world.mcworld'
  const membersFile = process.argv[3] || 'members.json'
  await withSavedLogin(async (auth, api) => {
    const realm = await pickOwnedRealm(api, auth)
    const members = await realmMembers(api, auth, realm.id)
    fs.writeFileSync(membersFile, JSON.stringify({ fetchedAt: Date.now(), members }))
    const download = await api.getRealmWorldDownload(realm.id, realm.activeSlot, 'latest')
    const buf = await download.getBuffer()
    fs.writeFileSync(out, buf)
    const hash = crypto.createHash('sha256').update(buf).digest('hex')
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `world_hash=${hash}\n`)
    console.log(`ワールドをダウンロードしました(${(buf.length / 1048576).toFixed(1)} MB、メンバー ${members.length}人)`)
  })
}

main().catch((e) => { console.error('ダウンロードに失敗しました:', e.message); process.exit(1) })
