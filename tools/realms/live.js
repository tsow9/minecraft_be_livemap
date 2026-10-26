'use strict'
// Writes the Realm member list (hashed IDs, names, online, last login) and Realm settings for the frequent check.
const fs = require('fs')
const { withSavedLogin, pickOwnedRealm, realmStatus } = require('./common')

async function main () {
  const out = process.argv[2] || 'members.json'
  await withSavedLogin(async (auth, api) => {
    const realm = await pickOwnedRealm(api, auth)
    // Backups and the subscription change rarely: look them up when the last answer is over 15 minutes old.
    let last = 0
    try { last = JSON.parse(fs.readFileSync(process.argv[3] || '', 'utf8')).realm?.extrasAt || 0 } catch { /* first run */ }
    const { members, realm: info } = await realmStatus(api, auth, realm.id, Date.now() - last > 15 * 60 * 1000)
    fs.writeFileSync(out, JSON.stringify({ fetchedAt: Date.now(), members, realm: info }))
    console.log(`参加中: ${members.filter(m => m.online).length}人`)
  })
}

main().catch((e) => { console.error('参加者の取得に失敗しました:', e.message); process.exit(1) })
