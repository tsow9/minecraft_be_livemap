'use strict'
// Writes the Realm member list (hashed IDs, names, online, last login) and Realm settings for the frequent check.
const fs = require('fs')
const { withSavedLogin, pickOwnedRealm, realmStatus } = require('./common')

async function main () {
  const out = process.argv[2] || 'members.json'
  await withSavedLogin(async (auth, api) => {
    const realm = await pickOwnedRealm(api, auth)
    // Backups change rarely, so they are looked up only every 15 minutes (the site keeps the last answer).
    const { members, realm: info } = await realmStatus(api, auth, realm.id, new Date().getMinutes() % 15 === 0)
    fs.writeFileSync(out, JSON.stringify({ fetchedAt: Date.now(), members, realm: info }))
    console.log(`参加中: ${members.filter(m => m.online).length}人`)
  })
}

main().catch((e) => { console.error('参加者の取得に失敗しました:', e.message); process.exit(1) })
