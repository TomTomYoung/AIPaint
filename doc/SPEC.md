# 現行実装仕様 v0.1.0

2026-09-08。全体設計v1.0に対する最初の動作単位です。全体設計の完了を宣言する文書ではありません。

## 構成

`src/core.js`はDOMを持たないRGBA描画エンジン、`src/agent.js`は画像書き出し・ジョブ実行・操作API、`src/app.js`は日本語UIです。人間の操作、JSON操作、CLIのジョブは共通のPaintCoreを使用します。ドラッグ中の表示は原稿スナップショットを別のPaintCoreで描いた仮プレビューで、確定原稿ではありません。

`index.html`と`style.css`は相対パスのみを使います。アプリに外部CDN、GitHubトークン、外部画像URL、eval、任意コード実行機能はありません。

## 描画規則

初版はpixelモードのみです。座標は左上原点の整数画像ピクセルで、CSSサイズや表示倍率の影響を受けません。最大1024×1024、16レイヤー、全レイヤー合計4,194,304画素です。この値は初期版の独自ガード値で、全体仕様の最終目標値やブラウザの公式上限ではありません。

レイヤーは下から上の配列です。各レイヤーはid、name、visible、locked、opacity、RGBA画像を持ちます。合成はsRGBの8bit RGBAによるnormal source-overです。ロック解除・可視性などのメタデータ操作は可能ですが、ロック中の描画・削除・並べ替えは拒否します。

ペンは整数サイズの正方形スタンプ、補間はBresenhamです。偶数サイズは右・下に1画素多く広がります。同一ストローク内の重複画素に半透明を累積させません。別ストロークは通常のsource-overです。消しゴムはRGBAをすべて0にします。

矩形は[x,x+width)×[y,y+height)です。楕円は外接矩形と画素中心の楕円方程式で判定し、アンチエイリアスを行いません。図形・ブラシのはみ出しはクリップします。pixel.setとバケツ始点の範囲外はエラーです。

バケツは4連結です。許容差は0〜255で、RGBAの全チャンネルの絶対差がそれぞれ許容差以下の場合に一致します。色置換も同じ距離規則です。pixel.set、pixel.setMany、バケツ、色置換はRGBA置換、ブラシと図形はsource-overです。

## 操作API

ブラウザではwindow.paintAgentです。これはJavaScriptの操作口であり、WebMCPツールとしての登録やChatGPTからの直接接続を保証するものではありません。

```javascript
paintAgent.getCapabilities()
paintAgent.getState()
paintAgent.getHistory({ limit: 50 })
paintAgent.applyBatch({ documentId, expectedRevision, batchId, commands })
paintAgent.undo({ documentId, expectedRevision })
paintAgent.redo({ documentId, expectedRevision })
paintAgent.exportProject({ documentId, revision })
await paintAgent.exportImage({ documentId, revision })
await paintAgent.renderPreview({ documentId, revision, maxDimension: 512 })
paintAgent.createDocument({ documentId, width, height, replace: true,
  expectedDocumentId, expectedRevision })
paintAgent.openProject({ bundle, replace: true, expectedDocumentId, expectedRevision })
paintAgent.runJob({ job, replace: true, expectedDocumentId, expectedRevision })
```

exportImageはPNGのBlob、画像サイズ、revision、SHA-256を返します。renderPreviewは最大辺1024以下に縮小でき、dataURLも返します。Blob/dataURLを返したことはGitHub保存成功ではありません。

公開APIの版はpaint-agent/0.1です。引数は現行のAPIであり、全体設計にあるformat、scale、regionなどは後続です。createDocumentで原稿を作り直す場合は未使用documentIdが必要です。openProjectは新documentIdとrevision 0を発行し、古いセッションの命令が新しい原稿に誤適用されることを防ぎます。

## 13種類のコマンド

```text
layer.add: id, name
layer.remove: layerId
layer.reorder: layerId, index
layer.setProperties: layerId, properties{name?,visible?,locked?,opacity?}
pixel.set: layerId, x, y, color
pixel.setMany: layerId, pixels[{x,y,color}]
brush.stroke: layerId, points[{x,y}], size, color
eraser.stroke: layerId, points[{x,y}], size
shape.line: layerId, x, y, x2, y2, color, size?
shape.rect: layerId, x, y, width, height, fill
shape.ellipse: layerId, x, y, width, height, fill
fill.bucket: layerId, x, y, color, tolerance?
color.replace: layerId, from, to, tolerance?
```

色は#RRGGBBAAです。未知のフィールド・命令・小数座標などを拒否します。正式なJSON Schemaファイルは未実装で、現状はcore.jsとagent.jsの厳密な許可リスト検証を使用します。

## トランザクションと履歴

一括操作は全コマンドの検証後に独立したステージング画像へ適用し、全成功の場合のみ反映します。一つのbatchはUndo一回分です。expectedRevisionとdocumentIdの両方が一致しなければ変更しません。

成功した編集とUndo/Redoでrevisionが1増え、以前の番号は再利用しません。同じbatchId・同じ正規化入力の再送は以前の適用番号を返して二重描画しません。同じid・異なる入力はIDEMPOTENCY_CONFLICTです。Undo後の再送も再適用しません。

Undo/Redo合計50状態または32 MiBを上限とし、古い状態から落とします。再送記録は最大2000batchかつ400万文字で、超過時は黙って記録を削除せずエラーにします。記録は現在のページセッション内だけで、ディスクへの永続化は未実装です。

## 原稿とジョブ

原稿はpaint-project/0.1、rgba8-base64形式の各レイヤースナップショットをJSON内に持ちます。コマンド履歴だけには依存しません。PNGパス参照型の最終Bundleとは区別し、後続の移行でこの版を読めなくしないでください。

ジョブはpaint-job/1のうち、rendererProfile=pixel-v0.1、source.kind=blankのみ対応します。完成図の寸法、透過の有無、alpha>0画素のRGB種類数を検査します。サンプルはexamples/slime.jsonです。runJobは別エンジンで検査まで済ませた後に現原稿を置換し、失敗したジョブで原稿を失いません。

CLIは公開UIと同じソースをローカルHTTP配信してPlaywrightで実行します。PNG・プレビュー・レイヤーPNG・原稿・コマンド・manifestを出力し、PNGバイト列のハッシュをブラウザ側と受信側で照合します。manifestは各ファイルのハッシュ、復号前エンジンRGBAのハッシュ、アプリソースのハッシュ、ブラウザ版を記録します。実行時のSHA固定プロファイル管理とGitHub Publisherは後続です。

## 未実装の境界

WebMCP、別リポジトリへの投稿、Actionsジョブ投入受付、PR生成、保存後のGitHub読み戻し、永続的なjobId重複排除は未実装です。preparePublishはPUBLISH_UNAVAILABLEを返します。

通常ペイントモード、画像インポート・変形、選択範囲、減色、ポリゴン、複数原稿管理、PNG参照型原稿Bundle、厳密なビルドSHA配信、リージョンプレビューは後続です。getCapabilitiesは実装済み部分だけを返します。
