# 用途別ツール戦略と反省点

更新日：2026-10-02。

## 結論

AIPaintは「すべての画像制作を自前のPaint Coreへ押し込むソフト」にはしない。

AIPaintの役割は、用途を判定し、適切な制作ツールへルーティングし、成果物を共通の検証・保存フローへ戻すオーケストレータである。Pixel Coreはその中の一つの専門ツールとして扱う。

適切な外部ツールが必要な用途で、接続されていないことを理由にPixel Coreへ黙ってフォールバックしてはならない。明示的に `TOOL_UNAVAILABLE` とし、必要なアダプタまたはMCP接続を要求する。

## 何が失敗だったか

初期版では「人間とAIが同じコマンドAPI・同じ描画エンジンを使う」ことを重視した。この原則は、同じ種類のピクセル編集を再現可能にする点では正しい。

問題は、その原則を「すべての素材制作を同じPaint Coreで行う」と拡張してしまったことである。

複雑な素材制作では、本来の視覚的意図が、`pixel.set`、`brush.stroke`、`shape.rect` などの狭い命令へ翻訳される。その時点で、形状、構図、質感、立体、カメラ、筆致などの情報が失われる。自作ツールが能力増幅器ではなく、表現力の上限になった。

さらに、当時は描画品質の反復より、ジョブ形式、manifest、hash、CI、Publisherなどの生成パイプラインを先に作り込んだ。制作ツールでは、まず「作る → 見る → 判断する → 直す」の視覚フィードバックループが成立していなければならない。

## 原則

### 1. 専門ツールを使う

既に成熟した専門ソフトがある領域は、原則としてその能力を利用する。

ドット絵はAIPaint Pixel Core、通常ラスターはラスター編集ソフト、ベクターはベクター編集ソフト、3DはBlender等、複雑な初稿生成は画像生成系を使う。

AIPaint内に簡易Photoshop、簡易Blender、簡易Illustratorを再実装してから素材を作ることを標準経路にしない。

例外として内蔵Blockout Modelerは、プリミティブ配置と変形による形状検討、カメラ確認、OBJ受け渡しだけを担当する。これはBlender代替ではなく、本制作へ渡す前の低コストな3Dラフ工程である。スカルプト、リグ、UV、テクスチャ、Geometry Nodes、アニメーション等へ機能範囲を膨張させない。

### 2. 制約保証と表現生成を分離する

生成系ツールは形、デザイン、質感、構図を作る。

AIPaintはピクセル寸法、パレット、透過、タイル接続、命名、manifest、hash、保存先など、ゲーム素材として必要な制約を検証する。

「描く能力」と「ゲーム素材として正しいことを保証する能力」を同じエンジンに押し込まない。

### 3. 不適切なフォールバックを禁止する

3Dモデルが必要なのにBlenderアダプタが未接続だからといって、Pixel Coreで3Dっぽい絵を作って完了扱いにしない。

ベクター素材が必要なのにベクター編集環境がない場合も同様である。

ツール不足は品質低下で隠さず、実行不能として返す。

### 4. フィードバックループを先に作る

各ツール経路は、最低でも以下を成立させる。

制作 → プレビューまたはレンダリング → 視覚確認 → 修正 → 再プレビュー → 検証 → 保存

自動生成だけ成功しても、プレビューを確認できない経路は完成扱いにしない。

### 5. AIPaintはオーケストレータになる

AIPaintの上位層は用途と制作工程を扱う。下位層の各ツールはアダプタとして接続する。

```text
制作要求
  ↓
Tool Router
  ├─ pixel → AIPaint Pixel Core
  ├─ raster → raster editor adapter
  ├─ vector → vector editor adapter
  ├─ generation → image generation adapter
  └─ 3d → Blender/MCP adapter
  ↓
プレビュー・検証
  ↓
共通成果物管理
```

## 現行ルーティング

`src/tool-router.js` が用途と制作パイプラインを定義する。

現在ローカルで実行可能なのはPixel Coreだけである。その他はアダプタ接続点を持つが、未接続の環境では利用可能と偽装しない。

代表例：

ドット絵スプライト → Pixel Core

ドット絵タイル → Pixel Core

通常ペイント → Raster editor

ベクター素材 → Vector editor

コンセプトアート → Image generation → Raster editor

3Dブロックアウト → AIPaint Blockout Modeler

3Dモデル → Blender/3D modeler

3Dポーズ・デッサン参照 → Blender/3D modeler

3D下絵から2D仕上げ → Blender/3D modeler → Raster editor

3Dテクスチャ制作 → Blender/3D modeler → Raster editor

## アダプタ要件

各外部ツールアダプタは、少なくとも次を満たす。

実行可能性を明示する。

入力をそのツール固有形式へ変換する。

成果物またはプレビューを取得できる。

同じ入力の再実行を追跡できる。

エラー時に別ツールへ黙って切り替えない。

保存と公開は制作実行から分離する。

Blender系ではMCPまたはBlender Python APIを介して、モデル、リグ、カメラ、レンダリングを扱える構成を第一候補とする。任意Python実行を許す構成では、隔離環境と権限分離を必須とする。

## Tool Router API

```javascript
const router = createToolRouter({
  adapters: [
    { id: 'pixel', execute: payload => runPixel(payload) },
    { id: 'blender-3d', execute: payload => runBlender(payload) }
  ]
});

router.selectPurpose('3d-pose-reference');
const route = router.route();
// route.toolId === 'blender-3d'

await router.execute({ payload: { /* tool-specific task */ } });
```

外部アダプタが未接続なら `TOOL_UNAVAILABLE` になる。これは意図した動作である。ブラウザ実行中にMCPブリッジ等が利用可能になった場合は `aipaintToolRouter.registerAdapter({ id, execute })` で登録し、同じルータをそのまま利用可能状態へ切り替える。

## 今後の優先順位

第一に、Browser UIとAgent APIの両方で用途・経路・利用可能性が同じ情報から見えるようにする。

第二に、画像生成、通常ラスター、Blender MCPのアダプタ契約を定義する。

第三に、各アダプタにプレビュー取得と視覚確認の反復を実装する。

第四に、成果物をAIPaint側の検査器へ戻し、寸法、透過、パレット、タイル接続、命名などを用途別に検証する。

最後にPublisherへ渡す。Publisherを制作ツールより先に拡張しない。
