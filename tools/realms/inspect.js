'use strict'
// Diagnostics: shows what the Realms API returns about members, without printing names or IDs.
const { withSavedLogin, pickOwnedRealm, realmMembers } = require('./common')

async function main () {
  await withSavedLogin(async (auth, api) => {
    const realm = await pickOwnedRealm(api, auth)
    const full = await api.getRealm(realm.id)
    const players = full.players || []
    console.log('Realmの項目:', Object.keys(full).join(', '))
    console.log('メンバー数:', players.length)
    if (players[0]) console.log('メンバーの項目:', Object.keys(players[0]).join(', '))
    console.log('lastLogin の形:', typeof players[0]?.lastLogin)
    const members = await realmMembers(api, auth, realm.id)
    console.log('online=true の人数:', members.filter(m => m.online).length)
    console.log('名前を取得できた人数:', members.filter(m => m.name).length, '/', members.length)
    console.log('最終ログインが分かる人数:', members.filter(m => m.lastLogin).length)
  })
}

main().catch((e) => { console.error('診断に失敗しました:', e.message); process.exit(1) })
