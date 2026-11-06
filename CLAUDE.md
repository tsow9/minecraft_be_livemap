# Blockmap(マイクラ統合版 Realm の地図サイト)

## 進め方
- 持ち主は専門家ではない。説明は日本語で、かみ砕いて。一つずつ進める。
- デザインを選ぶときは、画像の候補を並べて見せる。
- 変更は main に直接 push する(プルリクエストは作らない)。
- ワークフロー(.github/workflows)を変えたら、push 前に YAML を読み込み、値が空(null)の項目(例:中身のない `env:`)がないか確かめる。GitHub はファイルごと拒否し、実行が1件も始まらなくなる(2026-11-01 に約17時間、地図の更新が止まった)。push 後は Actions の実行名が「Map site」になっているか(ファイル名のままなら拒否されている)を見る。
- トークン・合言葉をチャットに貼らない。公開データには HMAC でハッシュ化した ID だけ。ログに名前や ID を出さない。

## 構成
- `js/app.js`(Leaflet。地図・検索・マーク)、`css/style.css`、`index.html`
- `tools/*.py`(ワールド → タイル・items.json)、`tools/realms/*.js`(Realms から取得)
- 英語対応:`js/i18n.js`(言語の判定・`tl()`・ページの固定文字の置き換え)と `js/i18n-en.js`(日本語の文 → 英語の辞書)。言語はブラウザの設定で決まり、隅の小さな「言語設定」ボタン(PCは右上、スマホは左下。押すと 日本語 / English を選べる)で切り替えられる。ゲームの言葉(アイテム・ブロック・動物・職業・エンチャント・ゲームルール・難易度など)は公式の en_US.lang の訳を使う(items.json の `en`、blocks.json の `en`)。バイオームは js/biomes.js の BIOME_EN。
- `tools/pet_faces.py`:ペットの顔は地図を更新するたびに公式の bedrock-samples から作り、items.json の `faces` に入れる。公式の絵はリポジトリに入れない。見た目は「少し明るく・色6段階・目鼻口の黒は残す」、ウマ系は首の傾きを半分(15度)
- `.github/workflows/map.yml`(地図の更新・Cloudflare への公開・GitHub Pages)、`live.yml`(10分おきの位置確認。サイトの /api/live に送る)
- Actions の名前・ボタン・手順名は英語(Map site / Live players、Update map / Sign in to Realms / Publish site only / Diagnose)。実行中のメッセージはリポジトリ変数 LANGUAGE で切り替え(省略時は日本語、en で英語。tools/msg.py、tools/realms/msg.js、シェルの t())。地図の日付のタイムゾーンは TIMEZONE(省略時 Asia/Tokyo)。Sign in to Realms が成功すると、続けて Update map を自動で起動する。サインイン中は、入力するコード(のちに「signed-in」)を login-code ブランチの code.json に置き(tools/login_code.sh → info_branch.sh、終わったら削除)、セットアップページがそれを表示する。さらに、Sign in to Realms は最初に cloudflare ジョブでサイト(Worker)を先に公開し(まだ無いときだけ。地図は空)、手で始めた実行(Sign in / Update map)は進み具合(starting・code・signed-in・downloading・drawing・publishing・done・〜-failed)を tools/setup_status.sh でサイトの /api/setup に送る(位置確認と同じ鍵。D1 の kv 'setup'、リポジトリ名は HMAC でなく sha256 の先頭16桁 r だけ)。描いている途中は render_map.py が detail(read・items・overworld・nether・end・save)も送り、セットアップページの進み具合に細かく出す。新しいサイトで地図がまだないあいだは、地図サイトがデモの地形ではなく「地図を作っています」を出し、5秒ごとに確かめて地図が来たらすぐ表示する。セットアップページはまずサイトの /api/setup を2秒ごとに見て(回数制限なし)、見られないときだけ GitHub の API(1時間60回まで)に戻る。完成したら localStorage に覚える。サイトを公開したら site-info ブランチの site.json に正確なアドレスを置く。What to do の初期値は Sign in to Realms。手で始めた実行は run-name で「Sign in to Realms」などと題が付く。トークンがあってまだログインしていないサイトは、live.yml の tools/auto_signin.sh が自動でサインインを始める(実行中・10分以内なら重ねない。コードの期限切れやトークンの直しは自動でやり直す。全部で24回まで)。新しいコピーでは setup.yml が、最初の push から最大45分、30秒ごとに小さな実行(probe)を起こしてトークンの登録を確かめ、登録されたらすぐサインインを始める(Secret の追加を知らせる合図が GitHub にないため。tools/setup_wait.sh)。私たちのリポジトリでは動かない。セットアップページは取り消された実行(Run workflow の二度押し)を無視し、ジョブが failure のときだけ失敗と出す。鍵がないときのサインインは realms_key.sh --required ではっきり止まる
- Realm を 2 つ以上持っていて REALM_NAME がないとき:login.js はログイン情報を先に保存し、持ち主の Realm の名前を setup_status で pick-realm としてサイトに出す(公開のログやブランチには出さない。/api/setup はアドレスを知っていれば読めるので、選ぶまでの間だけ)。セットアップページで選ぶと /api/setup/pick(示した名前だけ受け付ける)が D1 の kv 'realm_pick' に残し、login.js が続きを行う(15分待つ)。realms_key.sh が realm_pick を REALM_PICK として各ジョブへ渡す。REALM_NAME が優先
- Realm のワールド(スロット):tools/worlds.py。最初に地図にしたワールド(world.json の slot)はデータの直下、ほかは worlds/<slot>/ に、それぞれ地図・過去の地図・検索データ。worlds.json に一覧({active, list:[{slot,name,dir,at}]})。遊ぶワールドが変わると必ず描き直して公開。Worker はページに BLOCKMAP_WORLDS を渡し、/api/world?w=<slot> でそのワールドの items.json。ページは遊んでいるワールド(またはこの訪問中に選んだもの、sessionStorage)を開き、2つ以上あれば右下の日付が「🌍 名前・日付」になって押すと一覧(案C)。ピン・図形はほかのワールドで作ると w=<slot> を持ち、表示だけ分ける(同期は全部まとめて)。ほかのワールドを見ているときはプレイヤーの位置・ベッド・死亡地点・足あとを出さない
- バージョン:リポジトリ直下の VERSION(今は 0.9.2)。build_site.py が config.json の release とページの meta blockmap-release に入れ、開いているページは release が変わったときだけ「新しいバージョンがあります」を出す(細かい更新では出さない。ファイル名の ?v= はビルドごと)。公開リポジトリは60日変更がないと定期実行が止まるので、update ジョブが毎日 UTC 3時台に map.yml・live.yml を enable し直す
- 自動処理の設定ファイルは変えない(配ったコピーは自動更新で .github/workflows を書き換えられないため):map.yml・live.yml・setup.yml はリポジトリを取ってきて tools/ci/run.sh map|live|setup を動かすだけ(secrets は4つを名前で渡す。toJSON(secrets) でまとめて渡すと GitHub が「怪しい」として承認待ちで止める。vars は toJSON。外部の action は使わない)。tools/ci/frozen.sha256 と違うと pages.yml(私たちのリポジトリだけ。GitHub Pages とリリース)が失敗する。やることを足すときは run.sh 側で。Realms のログイン情報は Actions キャッシュではなくサイトの D1(kv 'realms_auth'、tools/ci/d1.py)
- 更新:VERSION を上げて main に push すると pages.yml が v<VERSION> のリリースを作る。コピーの位置確認が最新リリースを /api/release でサイトに伝え、管理者にだけ帯「新しいバージョン … があります」(押すと管理者メニューの「Blockmap のバージョン」)。「更新する」→ /api/update → 次の位置確認が Map site の Update Blockmap を起動 → tools/ci/update.sh apply がリリースの中身(.github 以外)を取り込んで push し、新しい run.sh refresh で地図とサイトを作り直す。上流は tools/ci/upstream
- 地図サイトの「設定」ボタン(元「言語設定」):言語とタイムゾーンを人ごとに選ぶ(localStorage の blockmap.lang・blockmap.tz。時刻の表示は tzParts で選んだタイムゾーン、日付ごとの地図の名前はそのまま)。管理者が設定で変えたときだけ、サイト全体(/api/prefs)にも送る(開くたびには送らない)
- 言語とタイムゾーン:Variables の LANGUAGE・TIMEZONE がなければ、管理者の地図ページ(/api/prefs、管理者のみ)かセットアップページ(/api/setup/prefs、管理者のが無いときだけ)のブラウザの言語・タイムゾーンを D1 の kv 'prefs' に置き、run.sh の get_key が BLOCKMAP_LANG・TZ にする。セットアップページの Variables の欄はなくした
- GitHub の schedule はほとんど動かない(新しいリポジトリは数時間に1回、私たちのも1時間おきが6〜8時間おき。私たちのリポジトリは外部のタイマーが毎分 live.yml を起動している)。そこで Worker の cron(*/10、wrangler.template.toml の [triggers])が live.yml を workflow_dispatch する。トークンは管理者メニュー「自動更新のタイマー」で管理者が貼る fine-grained PAT(Actions: write、そのリポジトリだけ)。D1 の kv 'timer'(token・ok・status・last)、/api/timer(管理者のみ。トークンは返さない)。GH_REPO は wrangler の vars
- データの置き場所:`map-data` ブランチ(タイル・items.json)、`live-data` ブランチ(live.json)。どちらも `tools/vault.sh` で暗号化(鍵は REALMS_CACHE_KEY)。中身は暗号文だけ
- GitHub Pages:「移転しました」のページ、login.html(全サイト共通のログイン中継)、privacy.html・terms.html(日英。legal.css/legal.js)、setup.html(セットアップページ。setup.css/setup.js。5手順:リポジトリ→トークン作成→トークン登録→Realms ログイン→仲間にリンク。リポジトリ名だけ localStorage。言語は地球儀+今の言語のメニュー。日本語は word-break: auto-phrase で文節改行。手順4は GitHub の公開 API で Map site の実行を見て、コードの場所→地図作成中→完成を表示。匿名の利用統計を GoatCounter(https://blockmap.goatcounter.com、持ち主のアカウント)に送る:ページ表示と setup/… のイベント(create-repo・repo-entered・token・secret・run・open-site・status-code/building/making/done/login-failed/map-failed)。リポジトリ名や名前は送らない。privacy.html の #setup に記載)だけ。地図のデータは置かない。ログイン画面の下からポリシーと規約へリンク
- Secrets:必須は CLOUDFLARE_API_TOKEN の1つだけ。暗号化の鍵(CACHE_KEY)は tools/realms_key.sh が各ジョブの最初に用意する:Secret の REALMS_CACHE_KEY があればそれ(私たちのリポジトリ)、なければ Cloudflare の D1(blockmap-share の kv 'realms_key')に初回だけランダムに作って保存し、以後読み出す。Worker はこの行を外に出さない。CLOUDFLARE_ACCOUNT_ID は省略可(トークンのアカウントを tools/cloudflare.sh で調べる)。SHARE_PASSPHRASE も省略可(REALMS_CACHE_KEY から作る。私たちのリポジトリは設定済みのものを使い続ける)。workers.dev のサブドメインが未設定なら、GitHub の持ち主名から自動で決める
- Realms の契約更新日は API の値が当てにならない。支払日・料金・通貨は管理者メニューで持ち主が入力する(Worker の /api/settings、D1 の kv 'settings'。選択はブラウザ標準のメニューを使わず、行の下に開く自作のリスト)。私たちの Realm は毎月26日・930円

## ほかの人に配る方針(決定済み)
- 無料で配り、寄付を受ける。寄付した人だけの特典は付けない(マイクラの利用ガイドライン)。
- 配り方:各自の GitHub と Cloudflare の無料枠を使い、セットアップページで導入を自動化する。サーバーを私たちが持ったり、アカウントを預かったりはしない。
- 「公式とは関係ありません」の注意書きは、いったん入れない。
- 見せる範囲(案C):
  - 地図・チェスト・位置などのデータは全部、持ち主の Cloudflare に置く。GitHub にはデータを置かず、リポジトリはプログラムだけの公開にする(Actions を無料で回すため)。
  - 入るときは「Microsoft でログイン」。Realm のメンバーだけが見られる(招待リンクは廃止)。仲間にはサイトの住所を送るだけ。
  - 管理者はサイトを立てた人(地図が Realms から取るのに使っているアカウント = realm.ownerXid)。メンバーは最初は見るだけで、管理者が「管理者メニュー」(管理者だけに出るボタン)の一覧で人ごとに書き込みをオンにする。ピンには作った人のゲーマータグを Worker 側で付ける。
  - ログインの仕組み:このプロジェクトとして Azure にアプリを1つ登録(クライアント ID は worker/wrangler.template.toml の MS_CLIENT_ID、個人用 Microsoft アカウントのみ、モバイル/デスクトップのリダイレクト URI = GitHub Pages の login.html)。配った各サイトはこの1つを共通で使い、login.html(中継ページ)経由で戻る。PKCE の秘密は各サイトの Worker が持つ。Xbox の XSTS でゲーマータグと XUID を得て、トークンはすぐ捨てる。
  - メンバーの照合:tools/realms/common.js がメンバーごとに xid = HMAC(MEMBER_KEY, XUID) を live.json に入れ、Worker は同じ MEMBER_KEY で照合する(MEMBER_KEY は REALMS_CACHE_KEY から作る)。
  - ワールドのプレイヤーの記録とメンバーは、player_<id> の MsaId(XUID から作るゲーム内 ID)で確実に結びつける(tools/players.py)。
  - 実装済み: `worker/`(Cloudflare Worker + D1、住所は https://<サイト名>.<Cloudflare のサブドメイン>.workers.dev。サイト名(Worker 名)はリポジトリ名から tools/site_name.sh で作り、D1 は「<サイト名>-share」。私たちのリポジトリだけは blockmap(D1 blockmap-share)。1つの Cloudflare アカウントに Realm ごとのサイトを置ける(Realm ごとに別名のリポジトリ+REALM_NAME)。持ち主は自分のサブドメインを blockmap から別の名前に変える(一時 map.blockmap… にしていた)。map.yml の cloudflare ジョブで公開。鍵は REALMS_CACHE_KEY から `tools/site_keys.py` で作り、公開ログでは伏せ字にする。SHARE_PASSPHRASE は位置確認が Worker に送るときだけ使う。
  - 「管理者メニュー」で、地図に出さないもの(チェスト全部/ほかの人のペット)を選べる。管理者も含め全員に効く。items.json は秘密のフォルダ(ITEMS_DIR、ページには教えない)に置き、Worker の /api/world が隠す分を抜いて渡す。チェストは置いた人が記録されないので「全部隠す」だけ。
  - Microsoft アカウントのログイン情報は持ち主の GitHub に暗号化したまま。リンクやデータには入れない。

## 次にやること
1. (済)招待制のサイトを Cloudflare に作る。今の GitHub Pages のサイトは、持ち主が困らないよう切り替えまで残す。
2. (済)切り替え:ブランチの暗号化、位置確認の送り先を新しい Worker に、GitHub Pages は「移転しました」と login.html だけ、古い share/(blockmap-share Worker)を削除。
3. (済)私たち専用の設定を外し、古いサイト用のコード(合言葉・招待リンク・liveUrl)を app.js から外した。
4. 説明書・プライバシーポリシー・利用規約、セットアップページ。公開前に持ち主と手順を通しで確認する(リポジトリ名を blockmap 以外にすれば同じ Cloudflare アカウントでも試せる。blockmap にすると私たちのサイトと重なるので、別のアカウントで)。
