'use strict'
const { t } = require('./msg')
// One-time sign-in: shows a code to enter at microsoft.com/link, then saves the encrypted tokens.
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { pack } = require('./secure-cache')
const { ENC_FILE, SECRET, REALMS_RELYING_PARTY, tempCacheDir, makeAuth, makeApi, ownedRealms, pickOwnedRealm } = require('./common')

// Puts what the setup page should show on the "login-code" branch (tools/login_code.sh). Never stops the sign-in.
function tellSetupPage (info) {
  try { execFileSync('bash', [path.join(__dirname, '..', 'login_code.sh'), 'put', JSON.stringify(info)], { stdio: 'ignore', timeout: 30000 }) } catch {}
}

// The owner has two or more Realms and has not said which to map: the setup page lists their names (through the site
// only, never in the public log or branches) and the owner picks one there; the site keeps the choice.
// Returns the name picked, or '' when there is no site to ask through or nobody picked within 15 minutes.
async function askWhichRealm (names) {
  const site = (process.env.SITE_URL || '').replace(/\/$/, '')
  if (!site) return ''
  try {
    execFileSync('bash', [path.join(__dirname, '..', 'setup_status.sh'), JSON.stringify({ state: 'pick-realm', realms: names })], { stdio: 'ignore', timeout: 30000 })
  } catch { return '' }
  console.log(t(`Realm が ${names.length} 個あります。セットアップページで、地図にする Realm を選んでください(15 分以内)。`,
    `There are ${names.length} Realms. Pick the one to map on the setup page (within 15 minutes).`))
  const until = Date.now() + 15 * 60 * 1000
  while (Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 3000))
    try {
      const s = await (await fetch(`${site}/api/setup`, { cache: 'no-store' })).json()
      if (s.state === 'picked' && names.includes(s.pick)) return s.pick
    } catch { /* try again */ }
  }
  return ''
}

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
      tellSetupPage({ state: 'code', code: res.user_code, uri: res.verification_uri, expires: Date.now() + res.expires_in * 1000 })
    })
    await auth.getXboxToken(REALMS_RELYING_PARTY)
    tellSetupPage({ state: 'signed-in' })
    const api = makeApi(auth)
    const owned = await ownedRealms(api, auth)
    if (owned.length > 1 && !(process.env.REALM_NAME || process.env.REALM_PICK || '').trim()) {
      pack(dir, ENC_FILE, SECRET)  // kept first: picking a Realm needs no second sign-in
      const picked = await askWhichRealm(owned.map((r) => String(r.name || '').slice(0, 100)).filter(Boolean))
      if (picked) {
        process.env.REALM_PICK = picked
        console.log(t('地図にする Realm が選ばれました。', 'The Realm to map was picked.'))
      }
    }
    const realm = await pickOwnedRealm(api, auth)
    pack(dir, ENC_FILE, SECRET)
    console.log(t(`ログインできました。Realm を見つけました(スロット ${realm.activeSlot})。`, `Signed in. Found the Realm (slot ${realm.activeSlot}).`))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

main().catch((e) => { console.error(t('ログインに失敗しました:', 'Sign-in failed:'), e.message); process.exit(1) })
