# Blockmap(マイクラ統合版 Realm の地図サイト)

## 進め方
- 持ち主は専門家ではない。説明は日本語で、かみ砕いて。一つずつ進める。
- デザインを選ぶときは、画像の候補を並べて見せる。
- 変更は main に直接 push する(プルリクエストは作らない)。
- トークン・合言葉をチャットに貼らない。公開データには HMAC でハッシュ化した ID だけ。ログに名前や ID を出さない。

## 構成
- `js/app.js`(Leaflet。地図・検索・マーク)、`css/style.css`、`index.html`
- `tools/*.py`(ワールド → タイル・items.json)、`tools/realms/*.js`(Realms から取得)
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
  - 見るには招待リンクが必要。リンクは全員共通の1本。漏れても見られるだけなので、基本は作り直さない。
  - 「見る用」と「書き込み用」のリンクは分ける(見る用が漏れても落書きされない)。
  - Microsoft アカウントのログイン情報は持ち主の GitHub に暗号化したまま。リンクやデータには入れない。

## 次にやること
1. 小さく試す:Cloudflare で「招待リンクを持つ人にだけ地図を渡す」が無料で動くか。R2 はカード登録が要る気がするので、カード不要の方法(Workers の静的ファイル+D1)で組めるか。1日10万回の制限が地図の画像に数えられるか。
2. 地図の更新と位置確認の保存先を GitHub のブランチから Cloudflare へ移す。
3. 招待リンクを「見る用」「書き込み用」に分ける。
4. 持ち主向けのかんたん設定ページ。私たち専用の設定(config.json の realmPrice / realmBillingDay / shareUrl)を外す。
