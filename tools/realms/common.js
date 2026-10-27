'use strict'
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { Authflow, Titles } = require('prismarine-auth')
const { RealmAPI } = require('prismarine-realms')
const { pack, unpack } = require('./secure-cache')
const { gamertags } = require('./xbox')

const ENC_FILE = path.resolve(process.env.AUTH_FILE || '.auth/token.enc')
const SECRET = process.env.CACHE_KEY
const REALMS_RELYING_PARTY = 'https://pocket.realms.minecraft.net/'

function tempCacheDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mcmap-auth-'))
}

function makeAuth (cacheDir, onCode) {
  return new Authflow('mcmap', cacheDir, { flow: 'live', authTitle: Titles.MinecraftNintendoSwitch, deviceType: 'Nintendo' }, onCode)
}

function makeApi (auth) {
  const options = {}
  if (process.env.MC_VERSION) options.minecraftVersion = process.env.MC_VERSION
  return RealmAPI.from(auth, 'bedrock', options)
}

function snapshotDir (dir) {
  return fs.readdirSync(dir).sort().map(n => n + fs.readFileSync(path.join(dir, n), 'utf8')).join('\n')
}

// Runs fn(auth, api) with the saved login; re-saves the encrypted tokens only if they were refreshed.
async function withSavedLogin (fn) {
  if (!fs.existsSync(ENC_FILE)) {
    throw new Error('ログイン情報がありません。Actions の「地図サイト」から「Realmsにログイン」を実行してください')
  }
  const dir = tempCacheDir()
  try {
    unpack(ENC_FILE, dir, SECRET)
    const before = snapshotDir(dir)
    // Never show a sign-in code from an unattended job; ask for a manual login instead.
    const auth = makeAuth(dir, () => {
      console.error('ログインの有効期限が切れました。「Realmsにログイン」をもう一度実行してください')
      process.exit(1)
    })
    const result = await fn(auth, makeApi(auth))
    if (snapshotDir(dir) !== before) pack(dir, ENC_FILE, SECRET)
    return result
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// Picks the realm this account owns. REALM_NAME narrows it down when there are several.
async function pickOwnedRealm (api, auth) {
  const realms = await api.getRealms()
  const xuid = (await auth.getXboxToken(REALMS_RELYING_PARTY)).userXUID
  let owned = realms.filter(r => (xuid && r.ownerUUID === xuid) || r.member === false)
  if (owned.length === 0) owned = realms
  const wanted = (process.env.REALM_NAME || '').trim()
  if (wanted) owned = owned.filter(r => r.name === wanted)
  if (owned.length === 0) throw new Error('自分が持ち主のRealmが見つかりませんでした')
  if (owned.length > 1) {
    throw new Error(`Realmが${owned.length}個あります。リポジトリの Variables に REALM_NAME(Realmの名前)を設定してください`)
  }
  return owned[0]
}

// Keyed hash so the public data never contains raw Xbox IDs.
function hashId (value) {
  return crypto.createHmac('sha256', SECRET).update(String(value)).digest('hex').slice(0, 16)
}

// Realms reports lastLogin in epoch seconds; accept milliseconds or ISO strings too.
function toMillis (v) {
  if (v == null) return null
  const n = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(v)
  return Number.isFinite(n) ? n : null
}

async function realmMembers (api, auth, realmId) {
  return (await realmStatus(api, auth, realmId)).members
}

// Settings of the Realm worth showing on the map site. No IDs; names are the ones members already see in game.
const RULES = ['keepInventory', 'pvp', 'showCoordinates', 'mobGriefing', 'doImmediateRespawn', 'playersSleepingPercentage',
  'doFireTick', 'tntExplodes', 'naturalRegeneration', 'showDeathMessages', 'doDayLightCycle', 'doWeatherCycle']
function realmInfo (realm) {
  const slot = (realm.slots || []).find(s => s.slotId === realm.activeSlot)
  let opts = {}
  try { opts = typeof slot?.options === 'string' ? JSON.parse(slot.options) : (slot?.options || {}) } catch { opts = {} }
  const settings = opts.worldSettings || {}
  const rules = {}
  for (const k of RULES) {
    const v = settings[k]?.value
    if (typeof v === 'boolean' || typeof v === 'number') rules[k] = v
  }
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return {
    name: String(realm.name || '').slice(0, 100),
    motd: String(realm.motd || '').slice(0, 300),
    open: realm.state === 'OPEN',
    daysLeft: num(realm.daysLeft),
    expired: realm.expired === true,
    maxPlayers: num(realm.maxPlayers),
    slot: num(realm.activeSlot),
    slotName: typeof opts.slotName === 'string' ? opts.slotName.slice(0, 100) : null,
    difficulty: num(opts.difficulty),
    gameMode: num(opts.gameMode),
    hardcore: opts.hardcore === true,
    cheats: opts.cheatsAllowed === true,
    rules
  }
}

// Realm backups: how many, and when the newest was made.
async function realmBackups (api, realm) {
  const backups = await api.getRealmBackups(realm.id, realm.activeSlot)
  const times = backups.map(b => toMillis(b.lastModifiedDate)).filter(Boolean)
  return { count: backups.length, latest: times.length ? Math.max(...times) : null }
}

// Trial: the Realms subscription as an add-on of Minecraft for Windows in the public store catalog (Japan).
async function storeSearch () {
  const get = async (ids) => {
    const res = await fetch(`https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${ids.join(',')}&market=JP&languages=ja-jp&MS-CV=DGU1mcuYo0WMMp+F.1`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()).Products || []
  }
  const out = { related: 0, found: [] }
  try {
    const [game] = await get(['9NBLGGH2JHXJ'])
    const related = (game?.MarketProperties || []).flatMap(m => m.RelatedProducts || []).map(r => r.RelatedProductId).filter(Boolean)
    out.related = related.length
    out.title = String(game?.LocalizedProperties?.[0]?.ProductTitle || '').slice(0, 40)
    for (let i = 0; i < related.length && i < 400; i += 20) {
      for (const p of await get(related.slice(i, i + 20))) {
        const title = String(p.LocalizedProperties?.[0]?.ProductTitle || '')
        if (!/realm/i.test(title)) continue
        const prices = (p.DisplaySkuAvailabilities || []).map(x => {
          const pr = (x.Availabilities || []).map(a => a.OrderManagementData?.Price).find(Boolean)
          return pr ? `${String(x.Sku?.LocalizedProperties?.[0]?.SkuTitle || '').slice(0, 40)}: ${pr.ListPrice} ${pr.CurrencyCode}` : null
        }).filter(Boolean).slice(0, 4)
        out.found.push({ id: p.ProductId, title: title.slice(0, 60), prices })
      }
    }
  } catch (e) { out.error = e.message.slice(0, 80) }
  return out
}

// Members and Realm settings from a single lookup.
async function realmStatus (api, auth, realmId, withBackups = false) {
  const realm = await api.getRealm(realmId)
  const info = realmInfo(realm)
  if (withBackups) {
    info.extrasAt = Date.now()
    try { info.backups = await realmBackups(api, realm) } catch (e) { console.error('バックアップ情報を取得できませんでした:', e.message) }
    try {
      const sub = await api.getRealmSubscriptionInfo(realm.id)
      info.subscription = { start: toMillis(sub.startDate), daysLeft: typeof sub.daysLeft === 'number' ? sub.daysLeft : null, type: String(sub.subscriptionType || '').slice(0, 30) }
    } catch (e) { console.error('契約情報を取得できませんでした:', e.message) }
    // The detailed form (store, end date, renewal period) answers only for some accounts; keep it when it does.
    try {
      const d = await api.rest.get(`/subscriptions/${realm.id}/details`)
      const text = (v) => (v == null ? null : String(v).slice(0, 40))
      info.billing = {
        store: text(d.store), type: text(d.type), renewal: text(d.renewalPeriod),
        start: toMillis(d.startDate), end: toMillis(d.endDate),
        daysLeft: typeof d.daysLeft === 'number' ? d.daysLeft : null,
        product: text(d.productId), variant: text(d.productVariantId)
      }
      info.billing.storeSearch = await storeSearch()
    } catch (e) { console.error('契約の詳細を取得できませんでした:', e.message) }
  }
  return { members: await memberList(auth, realm), realm: info }
}

async function memberList (auth, realm) {
  const players = (realm.players || []).filter(p => p.uuid)
  let names = {}
  try {
    names = await gamertags(auth, players.map(p => p.uuid))
  } catch (e) {
    console.error(e.message)
  }
  return players.map(p => ({
    id: hashId(p.uuid),
    name: names[p.uuid] || p.name || null,
    online: p.online === true,
    lastLogin: toMillis(p.lastLogin)
  }))
}

module.exports = { ENC_FILE, SECRET, REALMS_RELYING_PARTY, tempCacheDir, makeAuth, makeApi, withSavedLogin, pickOwnedRealm, realmMembers, realmStatus }
