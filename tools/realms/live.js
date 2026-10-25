'use strict'
// Writes the Realm member list (hashed IDs, names, online, last login) for the frequent check.
const fs = require('fs')
const { withSavedLogin, pickOwnedRealm, realmMembers } = require('./common')

async function main () {
  const out = process.argv[2] || 'members.json'
  await withSavedLogin(async (auth, api) => {
    const realm = await pickOwnedRealm(api, auth)
    const members = await realmMembers(api, auth, realm.id)
    fs.writeFileSync(out, JSON.stringify({ fetchedAt: Date.now(), members }))
    console.log(`参加中: ${members.filter(m => m.online).length}人`)
  })
}

main().catch((e) => { console.error('参加者の取得に失敗しました:', e.message); process.exit(1) })
