'use strict';
// English for the site's own words (see i18n.js). Game words follow the game's English (Mojang's en_US.lang):
// Overworld, Nether, The End, Nether Portal, Wandering Trader, Novice … Master, game rules, difficulties.
Object.assign(I18N_EN, {
  // dimensions and kinds of places
  '地上': 'Overworld', 'ネザー': 'Nether', 'エンド': 'The End', 'ディメンション': 'Dimension',
  'ピン': 'Pin', '拠点': 'Base', '死んだ場所': 'Death spot', 'ポータル': 'Portal', '鉱山': 'Mine', '畑・トラップ': 'Farm / trap',
  '村': 'Village', 'お気に入り': 'Favorite',
  'デモ 1週目': 'Demo week 1', 'デモ 2週目': 'Demo week 2', 'デモ 3週目': 'Demo week 3',
  'デモ地形(本物の地図はまだ未設定)': 'Demo terrain (the real map is not set up yet)',

  // signing in, members, admin menu
  'この端末に保存できませんでした': 'Could not save on this device',
  '管理者': 'admin', '書き込みOK': 'Can edit', '見るだけ': 'View only',
  '{name} としてログイン中({role})': 'Signed in as {name} ({role})',
  'ログアウト': 'Sign out',
  '<li class="sub">メンバーの情報がまだありません</li>': '<li class="sub">No member information yet</li>',
  '(名前なし)': '(no name)',
  '{name}さんの書き込み': 'Editing by {name}',
  '<li class="sub">一覧を読み込めませんでした</li>': '<li class="sub">Could not load the list</li>',
  '変えられませんでした。もう一度ためしてください': 'Could not change it. Please try again',
  'チェスト': 'Chests', 'ほかの人のペット': "Other players' pets", '見せる': 'Show', '隠す': 'Hide', '{what}を隠す': 'Hide {what}',
  '<li class="sub">設定を読み込めませんでした</li>': '<li class="sub">Could not load the settings</li>',
  '書き込みの許可がなくなりました(管理者に頼んでください)': 'You can no longer edit (ask the admin)',
  '書き込みの許可が切れました。新しい招待リンクを開いてください': 'Your edit access has expired. Open a new invite link',
  '確認中…': 'Checking…',
  '書き込めるようになりました': 'You can edit now',
  'このリンクは使えません。新しい招待リンクをもらってください': 'This link does not work. Ask for a new invite link',
  'うまく確認できませんでした': 'Could not check it',
  '通信できませんでした。電波のよいところでもう一度': 'No connection. Try again where the signal is better',
  '招待リンクを受け取りました(共有の準備ができると書き込めます)': 'Invite link received (you can edit once sharing is ready)',
  '招待リンクを確認しました。ピンや図形を書き込めます': 'Invite link checked. You can add pins and shapes',
  'この招待リンクは使えません。合言葉が合っているか確かめてください': 'This invite link does not work. Check the passphrase',
  '共有サーバーがうまく答えませんでした({status})': 'The sharing server did not answer properly ({status})',
  '通信できませんでした。もう一度リンクを開いてください': 'No connection. Open the link again',
  '書き込みは、管理者が許可したメンバーだけです': 'Only members the admin allows can edit',
  'サイトのURLをコピーしました。Realm のメンバーに送ってください(ログインすれば見られます)':
    'Site URL copied. Send it to the Realm members (they can view it after signing in)',
  '書き込み用の招待リンクをコピーしました。信頼できる仲間にだけ送ってください': 'Invite link for editing copied. Send it only to people you trust',
  'コピーしました: {text}': 'Copied: {text}',
  '管理者メニュー': 'Admin menu', 'サイトのURLをコピー': 'Copy site URL', '地図に出さないもの': 'Hidden from the map',
  'メンバーの書き込み': 'Who can edit', '書き込み用の招待リンクをコピー': 'Copy invite link for editing',
  '書き込むには招待リンクが必要です': 'You need an invite link to edit',
  'ピンや図形はみんなで共有しています。仲間からもらった招待リンクを開けば、この端末で書き込めるようになります(次からは不要)。リンクをここに貼り付けてもOKです。':
    'Pins and shapes are shared with everyone. Open the invite link you got from a friend to edit on this device (only once). You can also paste the link here.',
  '招待リンクを貼り付け': 'Paste the invite link', '招待リンク': 'Invite link',

  // pins, shapes and the editor
  'コピー': 'Copy', '線': 'Line', '手書き': 'Freehand', '多角形': 'Polygon', '四角': 'Rectangle', '円': 'Circle',
  '文字': 'Text', '図形': 'Shape', 'テキスト': 'Text',
  '半径 {r} ブロック': 'Radius {r} blocks',
  '作った人: {name}': 'Made by {name}',
  '削除': 'Delete', '削除しました': 'Deleted', '編集': 'Edit', '新しいピン': 'New pin', 'ピンの編集': 'Edit pin', '新しく追加': 'Add new',
  '「{name}」はもう使われています。別の名前にしてください': '"{name}" is already used. Choose another name',
  '地図をタップすると座標が出ます': 'Tap the map to see coordinates',
  '印をつけたい場所をタップ': 'Tap where you want the pin',
  '文字を置きたい場所をタップ': 'Tap where you want the text',
  '1本指(マウス)でなぞって描く・2本指で拡大縮小': 'Draw with one finger (mouse) · zoom with two fingers',
  'タップで点を足す → 最後の点をもう一度タップで完成': 'Tap to add points → tap the last point again to finish',
  'タップで点を足す → 最初の点をタップで完成': 'Tap to add points → tap the first point to finish',
  '角を1か所タップ → 反対の角をタップ': 'Tap one corner → tap the opposite corner',
  '中心をタップ → 円の端をタップ': 'Tap the center → tap the edge',
  '図形の白い点をドラッグして形を直す': 'Drag the white points to reshape',
  '動かしたいものをドラッグ': 'Drag what you want to move',
  'なぞった所の手書きを消す・2本指で拡大縮小': 'Rub out freehand lines · zoom with two fingers',
  '(Esc・右クリックでやめる)': ' (Esc or right-click to stop)',
  '通常': 'Normal', '形を直す': 'Reshape', '動かす': 'Move', 'ペン': 'Pen', '消しゴム': 'Eraser', '太さ': 'Width',
  'やめる': 'Cancel', '保存': 'Save', '名前': 'Name',

  // coordinates
  'ブロック名やバイオームも表示する': 'Also show the block and biome', '座標だけの表示にする': 'Show coordinates only',
  '座標をコピー': 'Copy coordinates', '座標表示を閉じる': 'Close coordinates', '座標で検索': 'Search by coordinates',
  'X座標': 'X coordinate', 'Z座標': 'Z coordinate', 'この座標へ移動': 'Go to these coordinates',

  // past maps
  '{when}の地図を表示中': 'Showing the map of {when}', 'なし': 'None', '{y}年{m}月': '{m} {y}', '{day}(最新)': '{day} (latest)',
  'その日の地図はないので、{day}の地図を表示しています': 'No map for that day, showing {day}',
  '▶ 再生': '▶ Play', '■ 停止': '■ Stop', '保存した地図が2つ以上になると再生できます': 'Needs two or more saved maps to play',
  '過去の地図': 'Past maps', '日付': 'Date', '最新に戻る': 'Back to latest',
  '日付を選ぶと、その日の地図に戻れます。直近30日は毎日、半年前までは毎週、それより前は毎月の地図が残っています。':
    'Pick a date to see the map of that day. Maps are kept daily for the last 30 days, weekly for half a year, then monthly.',

  // overlays
  '等高線はもう少し拡大すると表示されます': 'Zoom in a little more to see contour lines',
  'スライムチャンクは地上だけで表示されます': 'Slime chunks are shown in the Overworld only',
  'スライムチャンクはもう少し拡大すると表示されます': 'Zoom in a little more to see slime chunks',
  '表示(等高線・スライムチャンク・チャンク線)': 'Show (contour lines, slime chunks, chunk lines)',
  '等高線': 'Contour lines', 'スライムチャンク': 'Slime chunks', 'チャンク線(16ブロック)': 'Chunk lines (16 blocks)',
  '足あと(24時間)': 'Trails (24 hours)', '足あとを表示({n}時間)': 'Trails shown ({n} hours)', '足あとを非表示': 'Trails hidden',

  // search
  'ここで検索': 'Search here', '検索と強調を消す': 'Clear the search and highlights',
  'プレイヤー': 'Player', 'ベッド': 'Bed', '最終死亡地点': 'Last death point', '死亡': 'death', '死亡地点': 'Death point',
  'ネザーゲート': 'Nether Portal', 'ゲート': 'Portal',
  '{what} すべて': '{what} (all)', '{n}匹・地図にまとめて表示': '{n} · show all on the map', '{n}人・地図にまとめて表示': '{n} · show all on the map',
  'エンチャント': 'Enchantment ',
  '村人(無職)': 'Villager (unemployed)', '無職': 'unemployed', '行商人': 'Wandering Trader', '村人': 'Villager',
  '{level}の村人': '{level} villagers', 'レベル{n}': 'Level {n}',
  '新米': 'Novice', '見習い': 'Apprentice', '一人前': 'Journeyman', '熟練者': 'Expert', '達人': 'Master',
  '看板': 'Sign', '吊り看板': 'Hanging Sign', 'ペット': 'Pet', '{owner}のペット': "{owner}'s pets", '名札': 'Name Tag',
  '看板・{n}枚': 'Sign · {n}', '{n}人': '{n}', '{n}件・全{total}個': 'In {n} containers · {total} in all',
  '<div class="sub">取引の情報がありません</div>': '<div class="sub">No trade information</div>',
  '空っぽ': 'Empty', '飼い主: {name}': 'Owner: {name}', 'わからない': 'unknown',
  '一覧に戻る': 'Back to the list', '複数の候補があります': 'Several things are here', '見つかりませんでした': 'Nothing found',

  // nether portals and routes
  'つながり先(推定): {dim}の「{gate}」': 'Linked (estimate): "{gate}" in the {dim}',
  'つながり先を見る': 'Show the linked portal', '{dim}側のゲートはまだ見つかっていません': 'No portal found in the {dim} yet',
  '{dim}のゲート生成目安': 'A portal would appear in the {dim} around', 'その場所を見る': 'Show that place',
  'ネザー座標の換算': 'Nether coordinates', 'ネザーで1ブロック進むと、地上では8ブロック進みます。': '1 block in the Nether is 8 blocks in the Overworld.',
  '地図で見る': 'Show on the map', '今の地図の中心を入れる': 'Use the center of the map', 'ネザーゲートを地図に表示': 'Show Nether Portals on the map',
  '{s}秒': '{s}s', '{m}分': '{m}min ', '走って約{time}': 'About {time} sprinting', '・途中に溶岩あり': ' · lava on the way',
  '行き先を選ぶ': 'Choose destination', '行き先を一覧から選ぶか、地図でタップしてください': 'Pick a destination from the list or tap the map',
  '{n}ブロック': '{n} blocks', 'ネザー経由なら約{n}ブロック': 'About {n} blocks through the Nether', '走って…計算中': 'Sprinting… calculating',
  '行き先を選んでください': 'Choose a destination', '出発': 'From', '行き先': 'To', '閉じる': 'Close',
  '<li class="empty">選べる行き先がありません。地図をタップして選べます</li>': '<li class="empty">No destinations to pick. Tap the map to choose one</li>',

  // game clock
  '昼': 'Day', '夕方': 'Sunset', '夜': 'Night', '朝': 'Sunrise', '雷雨': 'Thunderstorm', '雨': 'Rain', '晴れ': 'Clear',
  'ゲーム内の時刻と天気(だいたい)': 'Time and weather in the game (roughly)',
  'ゲーム内の時刻と天気(最後に遊んだとき)': 'Time and weather in the game (when last played)',

  // players and exploring
  'プレイヤー・参加中の人': 'Players and who is online', '開拓した人(推定)': 'Who explored (estimate)', '描く・編集': 'Draw and edit',
  '記録を始める前': 'Before records began', '(不明)': '(unknown)', '未ログイン': 'Never signed in',
  '{n}分前': '{n} min ago', '{n}時間前': '{n} h ago', '{n}日前': '{n} days ago',
  'プレイ中 ・ 現在地({time} の記録)': 'Playing · here now (as of {time})', '最終ログアウト位置': 'Where they logged out',
  '({time} ごろ)': ' (around {time})', '最後に記録された位置(誰の記録かまだ分かりません)': 'Last recorded place (whose is not known yet)',
  '{names}のベッド': "{names}'s bed", 'リスポーン地点': 'Respawn point', '{name}が最後に死んだ場所': 'Where {name} last died',
  '現在地': 'Here now', 'ログアウト位置': 'Logged out here', '記録': 'Recorded',
  '<li class="sub">まだ記録がありません</li>': '<li class="sub">No records yet</li>',
  '{n} チャンク': '{n} chunks',
  '参加中の人(まだ設定されていません)': 'Online (not set up yet)', '<li class="sub">まだ情報がありません</li>': '<li class="sub">No information yet</li>',
  '参加中の人': 'Online', '{n}人がプレイ中 ・ {time} 時点': '{n} playing · as of {time}', 'プレイ中': 'Playing', '最終ログイン ': 'Last seen ',
  '{time} の記録': 'as of {time}', '地図上の位置': 'Places on the map',
  '死んだ場所を表示': 'Show death spots', 'ベッド(リスポーン地点)を表示': 'Show beds (respawn points)',
  '誰かがプレイ中のあいだは、Realms がワールドを保存するたび(1分くらいごと)に位置を更新します。ログアウトした人は、最後にいた場所を表示します。':
    'While someone is playing, places update each time Realms saves the world (about every minute). Players who logged out are shown where they last were.',
  '新しく地図に増えた場所を、そのとき近くにいた人の色で塗っています。これは記録からの推定です。':
    'New parts of the map are colored by who was nearby at the time. This is an estimate from the records.',

  // Realms information
  'Realms情報': 'Realms info', 'まだ情報がありません。少し待つと表示されます。': 'No information yet. It will show up shortly.',
  'ピース': 'Peaceful', 'イージー': 'Easy', 'ノーマル': 'Normal', 'ハード': 'Hard',
  'サバイバル': 'Survival', 'クリエイティブ': 'Creative', 'アドベンチャー': 'Adventure',
  '死んでも持ち物を失わない': 'Keep Inventory', 'プレイヤー同士の攻撃': 'Friendly Fire', '座標を表示': 'Show Coordinates',
  'モブがブロックを壊す': 'Mob Griefing', 'すぐにリスポーン': 'Immediate Respawn', '朝にするのに寝る人の割合': 'Players sleeping to skip the night',
  '火が燃え広がる': 'Fire Spreads', 'TNTが爆発する': 'TNT Explodes', '体力の自然回復': 'Natural Regeneration',
  '死亡メッセージ': 'Death Messages', '昼と夜が進む': 'Do Daylight Cycle', '天気が変わる': 'Weather Cycle',
  'オン': 'On', 'オフ': 'Off',
  '<h3>状態</h3>': '<h3>Status</h3>', '所有者': 'Owner', 'サーバー': 'Server',
  '<i class="dot on"></i>開いている': '<i class="dot on"></i>Open', '<i class="dot"></i>閉じている': '<i class="dot"></i>Closed',
  '参加中': 'Online', '{n}人・メンバー {m}人': '{n} · {m} members', '・最大 {n}人': ' · up to {n}',
  '期限': 'Expiry', '<span class="warn">切れています</span>': '<span class="warn">Expired</span>',
  '次の支払い': 'Next payment', '{n}円': '¥{n}', '料金': 'Price', '月{n}円': '¥{n} a month', 'バックアップ': 'Backups',
  '{n}個': '{n}', '・最新 {time}': ' · latest {time}',
  '<h3>ワールド</h3>': '<h3>World</h3>', 'スロット{n}': 'Slot {n}', '難易度': 'Difficulty', '・ハードコア': ' · Hardcore',
  'ゲームモード': 'Game Mode', 'チート': 'Cheats', '<h3>ルール</h3>': '<h3>Rules</h3>', '{time} 時点': 'as of {time}',

  // the page around the map
  '新しいバージョンがあります': 'A new version is available', '更新する': 'Update', '最新版に更新しました': 'Updated to the latest version',
  '拡大': 'Zoom in', '縮小': 'Zoom out', '言語': 'Language', '言語設定': 'Language', '{who}・{n}人': '{who} · {n}', 'ほか{n}人': '{n} others', 'バイオーム': 'biome', 'バイオーム・{n}チャンク': 'Biome · {n} chunks',
});
