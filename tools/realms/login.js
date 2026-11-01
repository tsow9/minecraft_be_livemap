'use strict'
const { t } = require('./msg')
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
      console.log(t(` スマホかPCで ${res.verification_uri} を開き、`, ` Open ${res.verification_uri} on a phone or PC,`))
      console.log(t(` コード「${res.user_code}」を入力して、Realmsの持ち主のアカウントでログインしてください。`, ` enter the code ${res.user_code} and sign in with the Realm owner's account.`))
      console.log(t(` (${Math.round(res.expires_in / 60)}分以内に入力してください)`, ` (within ${Math.round(res.expires_in / 60)} minutes)`))
      console.log('==================================================')
      console.log('')
    })
    await auth.getXboxToken(REALMS_RELYING_PARTY)
    const realm = await pickOwnedRealm(makeApi(auth), auth)
    pack(dir, ENC_FILE, SECRET)
    console.log(t(`ログインできました。Realm を見つけました(スロット ${realm.activeSlot})。`, `Signed in. Found the Realm (slot ${realm.activeSlot}).`))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

main().catch((e) => { console.error(t('ログインに失敗しました:', 'Sign-in failed:'), e.message); process.exit(1) })
