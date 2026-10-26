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
    // Realm settings for the info panel: values only for plain settings, never names or IDs.
    const plain = (v) => (typeof v === 'number' || typeof v === 'boolean' || v == null ? v : `(${typeof v} ${String(v).length}文字)`)
    for (const k of ['state', 'daysLeft', 'expired', 'expiredTrial', 'gracePeriod', 'worldType', 'maxPlayers', 'activeSlot', 'defaultPermission', 'member', 'subscriptionRefreshStatus']) {
      console.log(`  ${k}:`, ['state', 'worldType', 'defaultPermission', 'subscriptionRefreshStatus'].includes(k) ? full[k] : plain(full[k]))
    }
    console.log('slots の形:', Array.isArray(full.slots) ? `${full.slots.length}個` : typeof full.slots)
    for (const slot of full.slots || []) {
      let opts = slot.options
      try { if (typeof opts === 'string') opts = JSON.parse(opts) } catch { opts = {} }
      console.log(`  slot ${slot.slotId}:`, Object.entries(opts || {}).map(([k, v]) => `${k}=${typeof v === 'string' && !/^(difficulty|gameMode|worldType)$/.test(k) ? `(${v.length}文字)` : JSON.stringify(v)}`).join(', '))
    }
    try {
      const sub = await api.getRealmSubscriptionInfo?.(realm.id)
      console.log('subscription の項目:', sub ? Object.keys(sub).join(', ') : 'なし')
      if (sub) console.log('  startDate:', sub.startDate, new Date(sub.startDate < 1e12 ? sub.startDate * 1000 : sub.startDate).toISOString(), 'daysLeft:', sub.daysLeft, 'type:', sub.subscriptionType)
    } catch (e) { console.log('subscription 取得失敗:', e.message) }
    try {
      const backups = await api.getRealmBackups(realm.id, full.activeSlot)
      console.log('バックアップ数:', backups.length, backups[0] ? `最新の項目: ${Object.keys(backups[0]).join(', ')}` : '')
    } catch (e) { console.log('バックアップ取得失敗:', e.message) }
    const members = await realmMembers(api, auth, realm.id)
    console.log('online=true の人数:', members.filter(m => m.online).length)
    console.log('名前を取得できた人数:', members.filter(m => m.name).length, '/', members.length)
    console.log('最終ログインが分かる人数:', members.filter(m => m.lastLogin).length)
  })
}

main().catch((e) => { console.error('診断に失敗しました:', e.message); process.exit(1) })
