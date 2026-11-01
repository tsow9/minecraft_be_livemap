'use strict'
// Diagnostics: shows what the Realms API returns about members, without printing names or IDs.
const { withSavedLogin, pickOwnedRealm, realmMembers } = require('./common')

async function main () {
  await withSavedLogin(async (auth, api) => {
    const realm = await pickOwnedRealm(api, auth)
    const full = await api.getRealm(realm.id)
    const players = full.players || []
    console.log('Realm fields:', Object.keys(full).join(', '))
    console.log('Members:', players.length)
    if (players[0]) console.log('Member fields:', Object.keys(players[0]).join(', '))
    console.log('lastLogin type:', typeof players[0]?.lastLogin)
    // Realm settings for the info panel: values only for plain settings, never names or IDs.
    const plain = (v) => (typeof v === 'number' || typeof v === 'boolean' || v == null ? v : `(${typeof v}, ${String(v).length} chars)`)
    for (const k of ['state', 'daysLeft', 'expired', 'expiredTrial', 'gracePeriod', 'worldType', 'maxPlayers', 'activeSlot', 'defaultPermission', 'member', 'subscriptionRefreshStatus']) {
      console.log(`  ${k}:`, ['state', 'worldType', 'defaultPermission', 'subscriptionRefreshStatus'].includes(k) ? full[k] : plain(full[k]))
    }
    console.log('slots:', Array.isArray(full.slots) ? `${full.slots.length} items` : typeof full.slots)
    for (const slot of full.slots || []) {
      let opts = slot.options
      try { if (typeof opts === 'string') opts = JSON.parse(opts) } catch { opts = {} }
      console.log(`  slot ${slot.slotId}:`, Object.entries(opts || {}).map(([k, v]) => `${k}=${typeof v === 'string' && !/^(difficulty|gameMode|worldType)$/.test(k) ? `(${v.length}文字)` : JSON.stringify(v)}`).join(', '))
    }
    try {
      const sub = await api.getRealmSubscriptionInfo?.(realm.id)
      console.log('subscription fields:', sub ? Object.keys(sub).join(', ') : 'none')
      if (sub) console.log('  startDate:', sub.startDate, new Date(sub.startDate < 1e12 ? sub.startDate * 1000 : sub.startDate).toISOString(), 'daysLeft:', sub.daysLeft, 'type:', sub.subscriptionType)
    } catch (e) { console.log('subscription failed:', e.message) }
    try {
      const backups = await api.getRealmBackups(realm.id, full.activeSlot)
      console.log('Backups:', backups.length, backups[0] ? `latest fields: ${Object.keys(backups[0]).join(', ')}` : '')
    } catch (e) { console.log('backups failed:', e.message) }
    const members = await realmMembers(api, auth, realm.id)
    console.log('online=true:', members.filter(m => m.online).length)
    console.log('with a name:', members.filter(m => m.name).length, '/', members.length)
    console.log('with lastLogin:', members.filter(m => m.lastLogin).length)
  })
}

main().catch((e) => { console.error('Diagnosis failed:', e.message); process.exit(1) })
