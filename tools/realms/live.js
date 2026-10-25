'use strict'
// Writes who is online right now (names only) for the site's "参加中" panel.
const fs = require('fs')
const { withSavedLogin, pickOwnedRealm, realmMembers } = require('./common')

async function main () {
  const out = process.argv[2] || 'live.json'
  await withSavedLogin(async (auth, api) => {
    const realm = await pickOwnedRealm(api, auth)
    const members = await realmMembers(api, auth, realm.id)
    const data = {
      updatedAt: new Date().toISOString(),
      members: members
        .filter(m => m.name)
        .map(m => ({ name: m.name, online: m.online, lastLogin: m.lastLogin }))
        .sort((a, b) => (b.online - a.online) || ((b.lastLogin || 0) - (a.lastLogin || 0)))
    }
    fs.writeFileSync(out, JSON.stringify(data, null, 1))
    console.log(`参加中: ${data.members.filter(m => m.online).length}人`)
  })
}

main().catch((e) => { console.error('参加者の取得に失敗しました:', e.message); process.exit(1) })
