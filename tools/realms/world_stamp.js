'use strict'
// Prints a short stamp of the Realm's latest saved world without downloading it, so the frequent
// check can tell whether Realms has saved again. If the file cannot be asked about, the stamp
// changes every minute instead, which makes the caller download at most once a minute.
const fetch = require('node-fetch')
const { withSavedLogin, pickOwnedRealm } = require('./common')

async function main () {
  await withSavedLogin(async (auth, api) => {
    const realm = await pickOwnedRealm(api, auth)
    const download = await api.getRealmWorldDownload(realm.id, realm.activeSlot, 'latest')
    let stamp = ''
    try {
      const res = await fetch(download.downloadUrl, {
        method: 'HEAD',
        headers: download.token ? { Authorization: `Bearer ${download.token}` } : {}
      })
      const h = (k) => res.headers.get(k) || ''
      if (res.ok && (h('etag') || h('last-modified'))) stamp = [h('etag'), h('last-modified'), h('content-length')].join('|')
    } catch { /* falls back below */ }
    console.log(stamp || `size ${download.size} at ${Math.floor(Date.now() / 60000)}`)
  })
}

main().catch((e) => { console.error('保存状態の確認に失敗しました:', e.message); process.exit(1) })
