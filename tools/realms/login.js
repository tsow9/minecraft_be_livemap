'use strict'
// One-time sign-in: shows a code to enter at microsoft.com/link, then saves the encrypted tokens.
const fs = require('fs')
const { pack } = require('./secure-cache')
const { ENC_FILE, SECRET, REALMS_RELYING_PARTY, tempCacheDir, makeAuth, makeApi, pickOwnedRealm } = require('./common')

async function main () {
  const dir = tempCacheDir()
  try {
    const auth = makeAuth(dir, (res) => {
      console.log('')
      console.log('==================================================')
      console.log(` スマホかPCで ${res.verification_uri} を開き、`)
      console.log(` コード「${res.user_code}」を入力して、Realmsの持ち主のアカウントでログインしてください。`)
      console.log(` (${Math.round(res.expires_in / 60)}分以内に入力してください)`)
      console.log('==================================================')
      console.log('')
    })
    await auth.getXboxToken(REALMS_RELYING_PARTY)
    const realm = await pickOwnedRealm(makeApi(auth), auth)
    pack(dir, ENC_FILE, SECRET)
    console.log(`ログインできました。Realm を見つけました(スロット ${realm.activeSlot})。`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

main().catch((e) => { console.error('ログインに失敗しました:', e.message); process.exit(1) })
