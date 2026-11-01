# Blockmap — マイクラ統合版 Realm の地図サイト

[English](README.en.md)

Realm で遊んでいるワールドを、スマホや PC のブラウザで見られる地図にします。地図はクラウドで自動更新され、自分の PC を動かしておく必要はありません。費用は無料の範囲で収まります(Realm の月額は別)。

- **見られるのは Realm のメンバーだけ**:サイトに入るときは「Microsoft でログイン」。メンバー以外は入れません。
- **データはあなたのもの**:地図・チェストの中身・プレイヤーの位置は、あなたの Cloudflare(無料)にだけ置かれます。作者を含め、ほかの誰のサーバーも通りません。

## できること

| | |
|---|---|
| 地図 | 地上・ネザー・エンド。ブロック単位まで拡大でき、座標・高さ・ブロック名・バイオームがわかる |
| プレイヤー | 遊んでいる人の現在地(約20秒ごと)、ベッド、最後に死んだ場所、24時間の足あと |
| 探す | 座標、村人(職業・レベル・取引)、行商人、チェストの中身、看板、ペット、バイオームを検索 |
| 描く | ピン・文字・線・多角形・四角・円・楕円。ブロックにぴったり合う。仲間と共有され、作った人の名前が付く |
| 過去の地図 | 日付を選んで昔の地図に戻れる。再生ボタンで移り変わりを見られる |
| 便利な表示 | 等高線、スライムチャンク、チャンク線、ネザー座標の換算、開拓した人(推定)、ネザーゲートのつながり先 |
| Realms情報 | 開いているか、参加中の人数、難易度・ルール、次の支払い日 |
| 言語 | 日本語・English(ゲームの言葉は公式の訳) |

## はじめる(サイトを立てる人 = Realm の持ち主)

ワールドをダウンロードできるのは Realm の持ち主だけなので、**持ち主本人**が設定します。手作業で 30 分ほどです。

用意するもの(どれも無料):Microsoft アカウント(マイクラ用)、[GitHub](https://github.com/) アカウント、[Cloudflare](https://dash.cloudflare.com/sign-up) アカウント。

### 1. このリポジトリを自分用に複製する

1. このページの上の **Use this template** →「Create a new repository」
2. 名前は自由。**Public**(公開)のままにする(GitHub Actions を無料で使うため。データは暗号化されるので、公開でも中身は見えません)
3. 「Include all branches」には**チェックを入れない**

### 2. Cloudflare の準備

1. Cloudflare にログインし、左のメニューの **Workers & Pages** を一度開く。workers.dev の名前(サブドメイン)を聞かれたら決める
   - サイトの住所は `https://map.(決めた名前).workers.dev` になります
2. 右上の人のアイコン →「My Profile」→「API Tokens」→ **Create Token**
3. 「Edit Cloudflare Workers」テンプレートの **Use template** を押し、権限に **Account / D1 / Edit** を1行追加して作成。表示された**トークン**を控える(一度しか表示されません)
4. Workers & Pages の画面の右側にある **Account ID** を控える

### 3. GitHub に鍵を登録する

複製したリポジトリの **Settings → Secrets and variables → Actions → New repository secret** で、次の4つを登録します。

| Name | 入れるもの |
|---|---|
| `REALMS_CACHE_KEY` | 40 文字くらいのでたらめな文字列(パスワード生成機能などで作る)。覚えておく必要はありません |
| `SHARE_PASSPHRASE` | 上とは別の、40 文字くらいのでたらめな文字列 |
| `CLOUDFLARE_API_TOKEN` | 手順 2-3 のトークン |
| `CLOUDFLARE_ACCOUNT_ID` | 手順 2-4 の Account ID |

Realm を 2 つ以上持っている人だけ、同じ画面の **Variables** に `REALM_NAME`(使う Realm の名前)を追加します。

### 4. Realms にログインする

1. リポジトリの **Actions** →(初めてなら「I understand…」を押して有効にする)→ 左の **地図サイト** → **Run workflow**
2. 「やること」を **Realmsにログイン** にして実行
3. 実行中の項目 → login →「Realmsにログイン(下に出るコードを入力してください)」を開く
4. 表示された https://www.microsoft.com/link を開いてコードを入れ、**Realm の持ち主のアカウント**でログインする(15 分以内)

### 5. 地図を作る

1. もう一度 **Run workflow** で、「やること」を **地図を更新** にして実行
2. 数分で終わると、実行結果のページに「招待制のサイト: https://map.….workers.dev」と出ます
3. そのサイトを開いて「Microsoft でログイン」。あなたは**管理者**として入れます

あとは自動です。地図は 1 時間ごと(誰かが遊んでいる間は保存のたび)に、参加中の人と位置は 10 分ごと(遊んでいる間は 20 秒ごと)に更新されます。

## 仲間に知らせる

- 右の **管理者メニュー**(盾のアイコン)の「サイトのURLをコピー」で住所をコピーして、仲間に送ります。
- 仲間はその住所を開いて、マイクラで使っている Microsoft アカウントでログインするだけです。
- 最初はみんな「見るだけ」です。ピンや図形を書き込ませたい人は、管理者メニューの「メンバーの書き込み」でオンにします。
- 管理者メニューではほかに、Realm の支払日と料金(Realms情報に出ます)、地図に出さないもの(チェスト全部・ほかの人のペット)を設定できます。

## 安全とプライバシー

- **Realm 用のログイン**(手順 4)は、Switch 版マイクラと同じ方法で Realms に入ります([prismarine-auth](https://github.com/PrismarineJS/prismarine-auth) を使用)。パスワードは扱いません。できるのは Xbox Live と Realms の操作で、メール・OneDrive・支払い情報には届きません。ログイン情報は `REALMS_CACHE_KEY` で暗号化して GitHub のキャッシュにだけ置きます。
- **サイトに入るときのログイン**は、ゲーマータグを確かめるだけです。確かめたら Microsoft の鍵はすぐ捨てます。サイトに残るのは、ログイン済みの印・ゲーマータグ・ハッシュ化した ID だけです。
- 地図などのデータは、GitHub には**暗号化した形でだけ**置かれ(`map-data`・`live-data` ブランチ)、サイトにはメンバーしか入れません。公開されるのはプログラムだけです。
- おすすめ:Microsoft アカウントと GitHub アカウントの 2 段階認証をオンにする。心配なときは、Microsoft アカウントの「セキュリティ」→「すべての場所からサインアウト」で、Realm 用のログインを無効にできます(その後は手順 4 をやり直す)。
- Realms の仕組みは公式に公開されていないものを使っています。Microsoft の変更で動かなくなる可能性があります。

## うまく動かないとき

Actions の画面(実行結果)に出る文字を見てください。

| 出る文字 | 対処 |
|---|---|
| まだ「Realmsにログイン」をしていない | 手順 4 を行う |
| ログイン情報がありません / 有効期限が切れました | 手順 4 をもう一度行う |
| Realmが2個以上あります | 手順 3 の `REALM_NAME` を追加する |
| Cloudflare の Secrets がそろっていない | 手順 3 の 4 つを確かめる |
| 公開先のアドレスがわかりませんでした | 手順 2-1(workers.dev の名前を決める)を行ってから、もう一度「地図を更新」 |
| ブランチをこの鍵で開けませんでした | `REALMS_CACHE_KEY` を変えた場合は元に戻す。戻せないときは、そのブランチを削除する(地図は作り直しになります) |
| 自動更新が止まっている | 公開リポジトリは 60 日間動きがないと GitHub が自動実行を止めることがあります。Actions の画面で再開してください |

## 仕組み(詳しい人向け)

```
地図サイト(.github/workflows/map.yml、1時間ごと/遊んでいる間は位置確認から起動)
  Realms からワールドをダウンロード(tools/realms)
  → 前回と同じなら終わり
  → タイル・items.json などを作る(tools/render_map.py ほか)
  → 暗号化して map-data ブランチへ(tools/vault.sh)
  → Cloudflare Worker と静的ファイルとして公開(worker/、tools/build_site.py)

参加中の人と現在地(.github/workflows/live.yml、10分ごと。遊んでいる間は20秒ごとに続ける)
  Realms のメンバーとオンライン状態 → 遊んでいる間はワールドからプレイヤーの位置を読む
  → サイトの /api/live に送る。暗号化して live-data ブランチにも保存
```

- `worker/worker.js`:Microsoft ログイン(PKCE。トークンはすぐ捨てる)、メンバーの照合(HMAC した ID)、ピンの保存(D1)、チェストなどの情報から隠すものを抜いて渡す。
- 地図のファイルは推測できない名前のフォルダに置き、ログインした人のページにだけその名前を教えます。
- `tools/render_map.py`:ワールドの LevelDB を Python だけで読み、各列の一番上のブロックの色で描きます(陰影・水深つき)。
- 手元で試すには `python tools/build_site.py <地図データ> _site` のあと `_site` で `python -m http.server`。

## 使っているもの

- [Leaflet](https://leafletjs.com/)(BSD-2-Clause)、[Leaflet-Geoman](https://geoman.io/) free(MIT)
- [prismarine-auth](https://github.com/PrismarineJS/prismarine-auth) / [prismarine-realms](https://github.com/PrismarineJS/prismarine-realms)(MIT)
- [NumPy](https://numpy.org/) / [Pillow](https://python-pillow.org/)
- ペットの顔・アイテムやブロックの名前は、地図を更新するたびに公式の [bedrock-samples](https://github.com/Mojang/bedrock-samples) から作ります。公式の絵や文はこのリポジトリに入れていません。
- 文字:[M PLUS Rounded 1c](https://fonts.google.com/specimen/M+PLUS+Rounded+1c)(Google Fonts)
