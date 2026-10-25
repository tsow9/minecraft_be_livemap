'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const { Authflow, Titles } = require('prismarine-auth')
const { RealmAPI } = require('prismarine-realms')

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

module.exports = { ENC_FILE, SECRET, REALMS_RELYING_PARTY, tempCacheDir, makeAuth, makeApi, pickOwnedRealm }
