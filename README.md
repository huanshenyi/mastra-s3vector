# Character Memory RAG System

MastraフレームワークとAWS S3Vectorsを使用したキャラクターAIエージェントの思い出RAGシステム。

エピソードから事実を抽出し、各キャラクターが「知っているべき情報」のみをRAGで取得できます。

## 特徴

- **キャラクター視点のRAG**: 各キャラクターは自分が知っている情報のみを取得
- **時系列フィルタ**: 未来のエピソードの情報は取得しない
- **公開/秘密の分類**: 全員が知る情報と本人だけが知る秘密を自動分類
- **AWS S3Vectors**: 2025年12月GAの新サービスでコスト効率の良いベクトル検索

## クイックスタート

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 環境変数の設定

```bash
cp .env.example .env
```

`.env`を編集:
```bash
S3_VECTORS_BUCKET_NAME="your-vector-bucket"
AWS_REGION="us-east-1"
AWS_ACCESS_KEY_ID="..."
AWS_SECRET_ACCESS_KEY="..."
```

### 3. 開発サーバー起動

```bash
npm run dev
```

Mastra Studio: http://localhost:4111

## 開発コマンド

```bash
# 開発サーバー起動
npm run dev

# ビルド
npm run build

# プロダクション起動
npm start

# エピソードをS3Vectorsにインジェスト
npx tsx scripts/ingest-episodes.ts

# 特定のエピソードのみ
npx tsx scripts/ingest-episodes.ts --episode 1

# Lambda関数のビルド
npm run build:lambda
```

## ディレクトリ構成

```
.
├── src/
│   ├── mastra/
│   │   ├── index.ts                 # Mastraインスタンス
│   │   └── character-memory/        # キャラクターメモリRAG
│   │       ├── extract-memory.ts    # LLMで事実を抽出
│   │       ├── ingest-workflow.ts   # インジェストワークフロー
│   │       ├── memory-query-tool.ts # RAG検索ツール
│   │       ├── character-agent.ts   # キャラクターエージェント
│   │       ├── vector-store.ts      # S3Vectorsストア
│   │       └── types.ts             # 型定義
│   ├── lambda/
│   │   └── ingest-handler.ts        # Lambda Handler
│   └── lib/
│       └── bedrock-providers.ts     # Bedrockモデル設定
├── infra/                           # AWS CDK（インフラ）
│   ├── lib/
│   │   ├── app.ts
│   │   └── ingest-stack.ts
│   └── README.md                    # デプロイ手順
├── scripts/
│   ├── ingest-episodes.ts           # ローカルインジェスト
│   └── build-lambda.ts              # Lambdaビルド
├── docs/
│   └── character_memory/            # エピソードファイル
└── package.json
```

## アーキテクチャ

### ローカル開発

```
Episode.md → LLM差分抽出 → S3Vectors → キャラクターエージェント
                (Haiku)                        ↑
                                  RuntimeContext(characterId, episodeNo)
                                               ↓
                                  フィルタ自動適用 → RAG検索
```

### 本番（API Gateway + SQS + Lambda）

```
外部アプリ → API Gateway → SQS → Lambda → S3Vectors
                (API Key)      (DLQ)
```

詳細は [infra/README.md](./infra/README.md) を参照。

## 記憶の分類ルール

| scope | 説明 | 例 |
|-------|------|-----|
| `world` | 公開情報（全員が見える） | 職業、外見、公開の出来事 |
| `character` | 秘密情報（本人のみ） | 内心、秘密の正体、隠された能力 |

## 技術スタック

- **Node.js**: >=20.9.0
- **Mastra**: エージェント、ツール、ワークフロー
- **AWS S3Vectors**: ベクトルストア（2025年12月GA）
- **Amazon Bedrock**: Claude Haiku（抽出）、Titan Embed V2（埋め込み）
- **TypeScript**: ES2022

## デプロイ

AWS CDKを使用してインフラをデプロイ:

```bash
cd infra
npm install
npx cdk bootstrap  # 初回のみ
npx cdk deploy     # S3Vectorsバケットは自動作成
```

詳細は [infra/README.md](./infra/README.md) を参照。

## 関連ドキュメント

- [infra/README.md](./infra/README.md) - インフラ構成・デプロイ手順・コスト見積もり
- [docs/CHARACTER_MEMORY_RAG.md](./docs/CHARACTER_MEMORY_RAG.md) - キャラクターメモリRAGの詳細仕様
- [docs/EPISODE_SYNC_DESIGN.md](./docs/EPISODE_SYNC_DESIGN.md) - DB連携・自動同期の設計

## ライセンス

ISC
