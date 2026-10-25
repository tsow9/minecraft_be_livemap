'use strict'
// Packs the login token folder into one AES-256-GCM encrypted file and back.
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const MAGIC = Buffer.from('MCMAPv1')

function keyFrom (secret, salt) {
  if (!secret || secret.length < 20) {
    throw new Error('合言葉(REALMS_CACHE_KEY)が設定されていないか、短すぎます(20文字以上必要)')
  }
  return crypto.scryptSync(secret, salt, 32)
}

function pack (dir, outFile, secret) {
  const salt = crypto.randomBytes(16)
  const key = keyFrom(secret, salt)
  const files = {}
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isFile()) files[ent.name] = fs.readFileSync(path.join(dir, ent.name), 'utf8')
  }
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(JSON.stringify(files), 'utf8'), cipher.final()])
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]))
}

function unpack (inFile, dir, secret) {
  const data = fs.readFileSync(inFile)
  if (!data.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('ログイン情報のファイルが壊れています')
  let p = MAGIC.length
  const salt = data.subarray(p, p += 16)
  const iv = data.subarray(p, p += 12)
  const tag = data.subarray(p, p += 16)
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyFrom(secret, salt), iv)
  decipher.setAuthTag(tag)
  let json
  try {
    json = Buffer.concat([decipher.update(data.subarray(p)), decipher.final()]).toString('utf8')
  } catch {
    throw new Error('ログイン情報を開けませんでした。合言葉(REALMS_CACHE_KEY)を変えた場合は、もう一度ログインしてください')
  }
  fs.mkdirSync(dir, { recursive: true })
  for (const [name, content] of Object.entries(JSON.parse(json))) {
    fs.writeFileSync(path.join(dir, path.basename(name)), content, { mode: 0o600 })
  }
}

module.exports = { pack, unpack }
