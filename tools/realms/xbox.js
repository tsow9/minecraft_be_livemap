'use strict'
// Looks up Xbox gamertags for a list of XUIDs.
const fetch = require('node-fetch')

async function gamertags (auth, xuids) {
  const ids = [...new Set(xuids.filter(id => /^\d+$/.test(String(id))))]
  if (ids.length === 0) return {}
  const token = await auth.getXboxToken('http://xboxlive.com')
  const res = await fetch('https://profile.xboxlive.com/users/batch/profile/settings', {
    method: 'POST',
    headers: {
      Authorization: `XBL3.0 x=${token.userHash};${token.XSTSToken}`,
      'x-xbl-contract-version': '2',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ userIds: ids, settings: ['Gamertag'] })
  })
  if (!res.ok) throw new Error(`名前の取得に失敗しました (${res.status})`)
  const out = {}
  for (const user of (await res.json()).profileUsers || []) {
    const tag = (user.settings || []).find(s => s.id === 'Gamertag')
    if (tag) out[user.id] = tag.value
  }
  return out
}

module.exports = { gamertags }
