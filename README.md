# AIPaint

人間とAIが同じコマンドAPI・同じ描画エンジンを使う、HTML + JavaScriptのペイントソフトです。GitHub Pagesのプロジェクト用サブパスから、ビルドなしで動作する構成です。

## 初期版 v0.1.0

ドット描画を先に実装しています。ペン、消しゴム、直線、塗りつぶし矩形・楕円、バケツ、ピクセル指定、色置換、レイヤー、Undo/Redo、PNG出力、レイヤー付き原稿JSONの保存・復元、ブラウザ内自動保存、JSON命令、サンプルジョブを備えます。

GitHubへの画像保存とWebMCPによる直接操作は未接続です。通常ペイントモード、画像素材の取り込み・変形、選択範囲、減色なども後続です。全体仕様v1.0の完成版ではありません。

## 起動

GitHub上の初期化は済んでいます。手元でgit initを行う必要はありません。

GitHub Pagesでは Settings → Pages → Deploy from a branch → main → /(root) を指定します。公開設定と公開URLの実アクセス確認は、ソースコードのコミットとは別です。

ローカルではリポジトリをcloneした後、HTTPサーバーを使います。

```sh
git clone https://github.com/TomTomYoung/AIPaint.git
cd AIPaint
python -m http.server 8000 --bind 127.0.0.1
```

ブラウザで http://127.0.0.1:8000/ を開きます。file://での直接起動は対象外です。アプリ実行時のnpm依存・外部CDN・APIキーはありません。

## 試す

画面右の「サンプルジョブ：スライム」で、2レイヤーのサンプルを描画できます。原稿を変更した後は「編集可能な原稿を保存」でレイヤー付きJSONを保存してください。PNGには画面UIや透過背景の市松模様は入りません。

```javascript
const s = paintAgent.getState();
paintAgent.applyBatch({
  documentId: s.documentId,
  expectedRevision: s.revision,
  batchId: 'example-001',
  commands: [{ type: 'shape.rect', layerId: 'ink', x: 10, y: 10,
    width: 20, height: 20, fill: '#4DBB83FF' }]
});
```

## テストと自動描画

Node.js 22以上でコアのテストを実行します。npm installは不要です。

```sh
npm test
```

ブラウザ統合テストと自動描画にはPython 3.10以上、Playwright、Chromiumを使います。Pythonは開発・自動実行用で、公開アプリの必須要件ではありません。

```sh
python -m pip install -r requirements-dev.txt
python -m playwright install chromium
python tests/browser_test.py
python scripts/render.py examples/slime.json --output outputs
```

自動描画はPNG、プレビュー、原稿JSON、レイヤーPNG、コマンド、ハッシュ付きmanifestを保存します。既存の同じ素材版を上書きしません。結果はrenderedであり、GitHub格納済みを意味するstoredにはしません。

## 文書

[仕様・進捗・引き継ぎの入口](doc/README.md)

[設計原本（Notion）](https://app.notion.com/p/AI-Paint-3d5c3c1966b3808cacf3f06fcf242688)
