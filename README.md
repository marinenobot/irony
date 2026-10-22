# 集結計算機 / irony

GitHub Pagesで配信する静的アプリです。ビルドやnpm installは不要です。
ローカルでは `python3 -m http.server 8000` を実行し、`http://localhost:8000` を開いてください。
ES Modulesを使うため、HTMLファイルの直接ダブルクリックでは動作しません。

## 変更する場所

| 変更内容 | ファイル |
| --- | --- |
| ページ・入力欄のHTML | `index.html` |
| 画面イベント・集結主一覧・設定保存・画面の組み立て | `app.js` |
| 着弾時刻ページ | `js/ui/landing.js` |
| スイッチページ | `js/ui/switch.js` |
| iPhone操作デモ | `js/ui/demo.js` |
| 時刻の計算式 | `js/domain/timing.js` |
| 座標別の行軍時間と検索 | `js/domain/march.js` |
| プレイヤーIDからの取得・代替名簿取得 | `js/api/players.js` |
| Firebase同期 | `js/api/rally-sync.js` |
| 接続先などの設定 | `js/config.js` |
| Oracle中継用Worker（別途デプロイ） | `worker/worker.js` |

`app.js` がAPIと計算関数を読み込み、結果を画面に反映します。
`js/api` と `js/domain` はDOMや画面のIDを参照しません。
APIを変更するときは、下記の入出力を維持するか、API層で変換してください。
UI側でレスポンス形式やFirebaseの保存パスを扱わない構成です。

## APIの入出力

| 操作 | 入力 | 出力 |
| --- | --- | --- |
| `createPlayerApi().getPlayer(id)` | ゲームIDの文字列 | `{name, avatar}` / 見つからなければ `null` |
| `connectRallySync(config)` | Firebase設定 | 接続済み同期API |
| `publishRoster(names)` | 名前の配列 | Promise |
| `subscribeRoster(callback)` | 名前の配列を受け取る関数 | 購読解除関数 |
| `publishDepartures(records, previousKeys)` | `{key, name, departureTime}` の配列と旧キー配列 | Promise |
| `subscribeMember(key, callback)` | エンコードした名前と記録を受け取る関数 | 購読解除関数 |
| `removeMember(key)` | エンコードした名前 | Promise |
| `now()` | なし | サーバー時刻差を反映したUnixミリ秒 |

通信エラーはPromiseの拒否としてUIへ返します。通知文言と画面表示はUI側が決めます。
既存の `activeRally/roster`、`activeRally/members` と保存形式は維持しています。
名前のキーは従来どおり `encodeURIComponent(name)` です。
プレイヤー取得は従来どおり直接APIを試し、通信失敗時に `members.json` へフォールバックします。
Workerへの接続先変更・Workerのデプロイは、この整理には含みません。

## CSS

`style.css` は読み込み順を定義する入口です。

| 順序 | ファイル | 内容 |
| --- | --- | --- |
| 1 | `css/00-base.css` | 初期トークン・基本要素・共通部品 |
| 2 | `css/10-members.css` | 集結主一覧の基本スタイル |
| 3 | `css/20-pages.css` | 各ページ・タブの基本スタイル |
| 4 | `css/30-layout.css` | アプリ全体・モーダル等 |
| 5 | `css/40-responsive.css` | モバイル向けレイアウト調整 |
| 6 | `css/50-compatibility.css` | 既存の後勝ち調整・デモ等 |
| 7 | `css/60-themes.css` | 最終テーマ定義と関連スタイル |

表示を保つため、元のCSSの規則・順序はそのままです。
この分割で過去の上書きをすべて統合したわけではありません。
既存スタイルを修正するときは後段の上書きも確認し、末尾に修正を追加し続けないでください。
色の最終定義は主に `60-themes.css`、旧トークンの初期値は `00-base.css` にあります。

## 確認

Node.js 18以降で `npm test` を実行します。外部サービスへの接続・書き込みは行いません。
テストは日付をまたぐ着弾計算、行軍バフの組み合わせ、同期データの形式、
購読解除、プレイヤー取得失敗時の代替処理を確認します。

画面変更時は3タブ、5テーマ、名前・ID入力、座標とバフの連動、
保存からの復元、行の追加・削除も確認してください。

## この整理で実施した検証

- `npm test`: 7件成功。
- Chromiumで変更前後を比較。390px・1024pxの2幅、5テーマ、3タブの計30通りで、DOMの寸法と主要な計算済みスタイルが一致。テーマ切替アニメーションは比較時に無効化。
- 3タブの計算結果、集結主の追加・削除、保存からの復元、模擬APIによるID取得が成功。
- Firebase SDKを模擬して、送信データ、端末名の変更、旧購読の解除、期限切れデータの削除が変更前と一致。
- 本番Firebaseへの接続・書き込み、外部APIへの実リクエスト、公開サイトへのデプロイは未実施。
- 実機Safari・iPhoneのPiP・通知の検証は未実施。
