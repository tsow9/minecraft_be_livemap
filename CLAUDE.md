# Blockmap(マイクラ統合版 Realm の地図サイト)

## 進め方
- 持ち主は専門家ではない。説明は日本語で、かみ砕いて。一つずつ進める。
- デザインを選ぶときは、画像の候補を並べて見せる。
- 変更は main に直接 push する(プルリクエストは作らない)。
- トークン・合言葉をチャットに貼らない。公開データには HMAC でハッシュ化した ID だけ。ログに名前や ID を出さない。

## 構成
- `js/app.js`(Leaflet。地図・検索・マーク)、`css/style.css`、`index.html`
- `tools/*.py`(ワールド → タイル・items.json)、`tools/realms/*.js`(Realms から取得)
- 英語対応:`js/i18n.js`(言語の判定・`tl()`・ページの固定文字の置き換え)と `js/i18n-en.js`(日本語の文 → 英語の辞書)。言語はブラウザの設定で決まり、隅の小さな「日本語 / EN」(PCは右上、スマホは左下)で切り替えられる。ゲームの言葉(アイテム・ブロック・動物・職業・エンチャント・ゲームルール・難易度など)は公式の en_US.lang の訳を使う(items.json の `en`、blocks.json の `en`)。バイオームは js/biomes.js の BIOME_EN。
- `tools/pet_faces.py`:ペットの顔は地図を更新するたびに公式の bedrock-samples から作り、items.json の `faces` に入れる。公式の絵はリポジトリに入れない。見た目は「少し明るく・色6段階・目鼻口の黒は残す」、ウマ系は首の傾きを半分(15度)
- `.github/workflows/map.yml`(地図の更新)、`live.yml`(10分おきの位置確認)、`share/`(Cloudflare Worker:ピン共有)
- 今のデータの置き場所:`map-data` ブランチ(タイル・items.json)、`live-data` ブランチ(live.json)
- Secrets:REALMS_CACHE_KEY、CLOUDFLARE_API_TOKEN、CLOUDFLARE_ACCOUNT_ID、SHARE_PASSPHRASE
- Realms の契約更新日は API の値が当てにならない。手動設定の「毎月26日」が正しい

## ほかの人に配る方針(決定済み)
- 無料で配り、寄付を受ける。寄付した人だけの特典は付けない(マイクラの利用ガイドライン)。
- 配り方:各自の GitHub と Cloudflare の無料枠を使い、かんたん設定ページで導入を自動化する。サーバーを私たちが持ったり、アカウントを預かったりはしない。
- 「公式とは関係ありません」の注意書きは、いったん入れない。
- 見せる範囲(案C):
  - 地図・チェスト・位置などのデータは全部、持ち主の Cloudflare に置く。GitHub にはデータを置かず、リポジトリはプログラムだけの公開にする(Actions を無料で回すため)。
  - 入るときは「Microsoft でログイン」。Realm のメンバーだけが見られる(招待リンクは廃止)。仲間にはサイトの住所を送るだけ。
  - 管理者はサイトを立てた人(地図が Realms から取るのに使っているアカウント = realm.ownerXid)。メンバーは最初は見るだけで、管理者が「管理者メニュー」(管理者だけに出るボタン)の一覧で人ごとに書き込みをオンにする。ピンには作った人のゲーマータグを Worker 側で付ける。
  - ログインの仕組み:このプロジェクトとして Azure にアプリを1つ登録(クライアント ID は worker/wrangler.template.toml の MS_CLIENT_ID、個人用 Microsoft アカウントのみ、モバイル/デスクトップのリダイレクト URI = GitHub Pages の login.html)。配った各サイトはこの1つを共通で使い、login.html(中継ページ)経由で戻る。PKCE の秘密は各サイトの Worker が持つ。Xbox の XSTS でゲーマータグと XUID を得て、トークンはすぐ捨てる。
  - メンバーの照合:tools/realms/common.js がメンバーごとに xid = HMAC(MEMBER_KEY, XUID) を live.json に入れ、Worker は同じ MEMBER_KEY で照合する(MEMBER_KEY は REALMS_CACHE_KEY から作る)。
  - ワールドのプレイヤーの記録とメンバーは、player_<id> の MsaId(XUID から作るゲーム内 ID)で確実に結びつける(tools/players.py)。
  - 実装済み: `worker/`(Cloudflare Worker + D1、https://blockmap.blockmap.workers.dev)。map.yml の cloudflare ジョブで公開。鍵は REALMS_CACHE_KEY から `tools/site_keys.py` で作り、公開ログでは伏せ字にする。SHARE_PASSPHRASE は位置確認が Worker に送るときだけ使う。
  - 「管理者メニュー」で、地図に出さないもの(チェスト全部/ほかの人のペット)を選べる。管理者も含め全員に効く。items.json は秘密のフォルダ(ITEMS_DIR、ページには教えない)に置き、Worker の /api/world が隠す分を抜いて渡す。チェストは置いた人が記録されないので「全部隠す」だけ。
  - Microsoft アカウントのログイン情報は持ち主の GitHub に暗号化したまま。リンクやデータには入れない。

## 次にやること
1. (済)招待制のサイトを Cloudflare に作る。今の GitHub Pages のサイトは、持ち主が困らないよう切り替えまで残す。
2. 切り替え(持ち主が新しいサイトを色々確認して「大丈夫」と言うまで保留。それまでは今の GitHub Pages のサイトも残す):map-data / live-data ブランチを暗号化(リポジトリは公開なので今は丸見え)、位置確認の送り先を新しい Worker に、GitHub Pages は「移転しました」だけ、古い share/(blockmap-share Worker)を片づける。
3. 持ち主向けのかんたん設定ページ。私たち専用の設定(config.json の realmPrice / realmBillingDay / shareUrl)を外す。
