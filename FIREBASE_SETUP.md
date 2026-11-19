# wobまんちゃんのコインラッシュ！ — Firebaseオンラインランキング導入手順

## 現在の状態

現在は **この端末のランキング** だけが動作します。Firebase SDKの追加、Firebaseへの接続、プロジェクト作成、データ送信、課金設定、デプロイは行っていません。
この手順は今後の実装・設定に向けた案内です。設定値を書くだけで自動接続する仕組みは入れていません。

## 1. 自分で設定を確認する

1. [Firebase Console](https://console.firebase.google.com/) で利用するGoogleアカウントとプロジェクトを決めます。
2. Webアプリを登録します。Analyticsはこのランキングに必須ではありません。
3. Cloud Firestoreのリージョンと利用プランを確認します。認証やサーバー処理、ホスティングを含め、利用予定サービスの料金と制限を確認してください。
4. 有料プランへの変更や請求先の紐付けが必要な場合は、その時点で利用者自身が判断します。現在のローカルゲームを動かすために行う必要はありません。

参考：[Firebaseの利用プラン](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)、[Firestoreの料金](https://firebase.google.com/docs/firestore/pricing)。

## 2. 本人を識別する認証を設定する

Firebase Authenticationでログイン方式を決めます。名前は表示名に使い、プレイヤーの識別には認証UIDを使います。
匿名認証は開始しやすい一方、別端末・別ブラウザ・ブラウザデータ削除後も同一人物として扱いたい場合は、Googleなどのログイン方式やアカウント引き継ぎを用意します。
現在の端末内プレイヤーIDを、そのままオンラインの本人確認に使わないでください。

参考：[匿名認証](https://firebase.google.com/docs/auth/web/anonymous-auth)、[認証とFirestoreルール](https://firebase.google.com/docs/firestore/security/get-started)。

## 3. 自己ベストを1人1ステージ1件で保存する

推奨する構造の例：

```text
players/{uid}
  displayName: 2〜12文字の表示名

stages/{stageId}/bests/{uid}
  uid: Firebase AuthenticationのUID
  displayName: 表示名
  score: 0以上の整数
  achievedAt: サーバーが付けた記録時刻
  order: そのステージで自己ベストを更新した順序番号

stages/{stageId}/meta/counter
  nextOrder: 次の順序番号
```

stageIdは現在の `meadow`・`park`・`pond`・`plaza` を維持します。

新しい結果が古い自己ベストより高い場合だけ更新します。同点や低い結果では、得点・記録時刻・順序番号を変更しません。表示名を変えるときも、順位を決める時刻や順序は変更しません。
取得と更新をトランザクションでまとめ、同時更新で高いスコアを低いスコアが上書きしないようにします。

厳密な同点の先着順には、信頼できるサーバー処理でカウンターと自己ベストを同じトランザクション内で更新し、`order` を割り当てる方式を推奨します。サーバー時刻だけでは同時刻の記録を一意に並べられない場合があるためです。サーバー処理に使うサービスと課金条件は、導入時に確認してください。

参考：[Firestoreのトランザクション](https://firebase.google.com/docs/firestore/manage-data/transactions)、[サーバー時刻](https://firebase.google.com/docs/firestore/manage-data/add-data#server_timestamp)。

## 4. TOP30のクエリーとインデックスを用意する

Firebase SDKを導入した後の取得処理の形は、次のとおりです（現時点では実行されません）。

```js
const top30Query = query(
  collection(db, "stages", stageId, "bests"),
  orderBy("score", "desc"),
  orderBy("order", "asc"),
  limit(30)
);
```

`score` 降順・`order` 昇順の複合インデックスを作成します。上位30件だけを読み、常時リスナーの利用頻度や追加のプロフィール読み込みも料金計算に含めて検討します。

参考：[並べ替えと件数制限](https://firebase.google.com/docs/firestore/query-data/order-limit-data)、[インデックス管理](https://firebase.google.com/docs/firestore/query-data/indexing)。

## 5. 公開する前にアクセス制御を実装する

- Firestoreを「誰でも書き込み可」の状態で公開しないでください。
- ユーザーは自分のUIDのプロフィールだけを変更できるようにします。
- 順位用のスコア・順序番号をサーバー管理にする場合、ブラウザからの直接書き込みを拒否し、認証済みの送信先を通します。
- ユーザー名の長さ、許可するフィールド、スコアの形式を送信先でも検証します。
- ブラウザが申告するスコアは改変可能です。認証やSecurity Rulesだけではプレイ結果の正当性は証明できないため、公開ランキングの運用に応じてリプレイ検証などを検討します。
- サービスアカウントの秘密鍵をブラウザ用ファイルに入れないでください。

参考：[Firestoreのセキュリティルール](https://firebase.google.com/docs/firestore/security/get-started)、[安全でないルールの修正](https://firebase.google.com/docs/firestore/security/insecure-rules)。

## 6. 現在の保存処理をアダプターで差し替える

[ranking.js](./ranking.js) の `LocalRankingRepository` と同じインターフェースを持つ `FirestoreRankingRepository` を、新しいファイルとして実装します。
[script.js](./script.js) の `rankingRepository` を作っている1行が差し替え箇所です。ゲームの移動・コイン・ステージの処理は変更せずに済みます。

| API | 役割・戻り値 |
| --- | --- |
| `getProfile()` | 現在の `{ id, name }` または `null` |
| `listPlayers()` | 選択可能なプレイヤーの配列。オンラインではアカウント切り替え仕様に合わせる |
| `saveProfile(name, createNew)` | 登録・名前変更後の `{ id, name }`。オンラインでは認証UIDをidに使う |
| `selectPlayer(id)` | 本人確認を伴うアカウント切り替え後のプロフィール |
| `submitScore({ stageId, playerId, score })` | 検証・自己ベスト更新後に `{ improved, entry, persistent }` を返す |
| `listTop(stageId, limit)` | `{ playerId, name, score, rank, order, achievedAt }` の配列。最大30件 |

すべてPromiseを返します。ローカル実装ですでにこの形で利用しています。保存中のリスタートに備え、ゲーム開始時のプレイヤーIDと終了時のスコアを固定して送信します。

実装時は認証状態、通信失敗、重複送信、読み込み失敗の扱いも追加してください。
現在は画面に「この端末のランキング」と明記しています。オンライン接続を実装・確認した段階で、ランキング見出し、説明文、保存結果メッセージをオンライン用へ変更します。接続に失敗してローカルへ切り替える場合は、表示も「この端末」に戻してください。

## 7. ローカル記録を保持したまま動作確認する

1. 開発用プロジェクトやエミュレーターで、2人以上のログイン・同点・自己ベスト更新を確認します。
2. 複数端末、通信切断、再接続、連打、同時送信を確認します。
3. Android ChromeとiPhone Safariの実機で操作・音声を確認します。
4. 利用量・料金条件を確認し、公開の承認後にHTTPS環境へ配置します。

オンラインSDKを導入する段階では、通常のHTTP/HTTPSで配信する環境を用意します。現時点のローカルゲームは引き続きダブルクリックで起動できます。

ローカル記録は `coin-hop-best-v1`・`coin-hop-best-v2`・`coin-hop-ranking-v1` に残します。タイトル変更やオンライン移行のために削除・改名しないでください。本人確認のない過去のローカル記録をオンラインへ自動送信することも避け、引き継ぐ範囲は利用者が決める形にします。
