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
  const realm = await api.getRealm(realmId)
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

module.exports = { ENC_FILE, SECRET, REALMS_RELYING_PARTY, tempCacheDir, makeAuth, makeApi, withSavedLogin, pickOwnedRealm, realmMembers }
