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
      const line = '='.repeat(60)
      console.log(['', line,
        t('  Realms にログイン', '  Sign in to Realms'), '',
        t(`  1. ${res.verification_uri} を開きます`, `  1. Open ${res.verification_uri}`),
        t(`  2. このコードを入力します:  ${res.user_code}`, `  2. Enter this code:  ${res.user_code}`),
        t('  3. Realm のオーナーのアカウントでログインします', "  3. Sign in with the Realm owner's account"),
        t(`  (${Math.round(res.expires_in / 60)} 分以内に)`, `  (within ${Math.round(res.expires_in / 60)} minutes)`), '',
        t('  ※「Minecraft for Nintendo Switch」と表示されますが、正常です。', '  Note: it says "Minecraft for Nintendo Switch". That is expected:'),
        t('    Realms に入るために、Switch 版マイクラと同じ方法でログインしています。', '    Realms is reached the way Minecraft for Switch signs in.'),
        line, ''].join('\n'))
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
