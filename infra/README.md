# Episode Ingest Infrastructure

API Gateway + SQS + Lambda によるエピソード自動インジェスト基盤。

## データ構造

```
ユーザー
  └─ 物語 (Story)          ← 1物語 = 1 S3Vectorsインデックス
       └─ エピソード1
       └─ エピソード2
       └─ ...
```

## アーキテクチャ

```
外部アプリ → API Gateway → SQS → Lambda → S3Vectors
                (API Key)      (DLQ)     (インデックス: character-memory-{storyId})
```

## デプロイ手順

### 1. 依存関係のインストール

```bash
# プロジェクトルートで
npm install

# infra ディレクトリで
cd infra
npm install
```

### 2. Lambda関数のビルド

```bash
# プロジェクトルートで
npm run build:lambda
```

### 3. CDKデプロイ

```bash
cd infra

# 初回のみ: CDK Bootstrap
npx cdk bootstrap

# デプロイ（S3Vectorsバケットは自動作成）
npx cdk deploy

# オプション: バケット名を指定する場合
export S3_VECTORS_BUCKET_NAME="your-vector-bucket-name"
npx cdk deploy
```

**注意**: S3Vectorsバケットはスタックで自動作成されます。名前を指定しない場合、AWSが自動生成します。

### 4. APIキーの取得

デプロイ後、出力されたAPIキーIDを使用してAPIキーを取得:

```bash
aws apigateway get-api-key --api-key <ApiKeyId> --include-value
```

## API仕様

### POST /ingest

エピソードをインジェストキューに追加。

**Headers:**
- `x-api-key`: APIキー（必須）
- `Content-Type`: application/json

**Body:**
```json
{
  "action": "create",
  "storyId": "story-abc123",
  "episodeId": "episode-3",
  "episodeNo": 3,
  "version": 1,
  "text": "エピソードの本文テキスト..."
}
```

| フィールド | 説明 |
|-----------|------|
| `storyId` | 物語ID。S3Vectorsインデックス名 `character-memory-{storyId}` に使用 |
| `episodeId` | エピソードの一意識別子 |
| `episodeNo` | エピソード番号（時系列フィルタに使用） |
| `version` | バージョン番号 |
| `text` | エピソード本文（最大10,000文字） |

**Response:** `202 Accepted`
```json
{
  "message": "Accepted",
  "messageId": "xxx-xxx-xxx"
}
```

## アプリ側での使用例

```typescript
const response = await fetch('https://xxx.execute-api.us-east-1.amazonaws.com/prod/ingest', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': process.env.INGEST_API_KEY,
  },
  body: JSON.stringify({
    action: 'create',
    storyId: story.id,                    // 物語ID
    episodeId: `episode-${episodeNo}`,
    episodeNo,
    version: 1,
    text: episodeText,
  }),
});

if (response.status === 202) {
  console.log('Ingest queued successfully');
}
```

## 監視

- **CloudWatch Logs**: Lambda実行ログ
- **DLQ**: 処理失敗メッセージ（3回リトライ後に移動）

## コスト見積もり

### インフラ（リクエストあたり）
| サービス | 料金 |
|---------|------|
| API Gateway | ~$3.50/100万リクエスト |
| SQS | ~$0.40/100万リクエスト |
| Lambda | ~$0.20/100万リクエスト (512MB, 30秒平均) |

### S3 Vectors（2025年12月GA）
| 項目 | 料金 |
|------|------|
| ストレージ | $0.06/GB/月 |
| アップロード (PUT) | $0.20/GB |
| クエリ | $2.5/100万APIコール |
| クエリデータ処理 | $0.002-0.004/TB |

### Bedrock（LLM抽出 + 埋め込み）
| モデル | 料金 |
|--------|------|
| Claude Sonnet（抽出用） | 入力$3/100万トークン、出力$15/100万トークン |
| Titan Embed V2（埋め込み用） | $0.0002/1000トークン |

### トータル概算（1エピソード10,000文字の場合）

| 処理 | 内訳 | 概算コスト |
|------|------|-----------|
| **インジェスト（1エピソード）** | LLM抽出 + 埋め込み + PUT | ~$0.04 |
| **ストレージ（1エピソード/月）** | ~30KB × $0.06/GB | ~$0.000002 |
| **クエリ（1回）** | API + データ処理 | ~$0.0000025 |

#### 例: 100物語 × 10エピソード = 1,000エピソード
| 項目 | コスト |
|------|--------|
| 初期インジェスト | ~$40 |
| 月額ストレージ（30MB） | ~$0.002 |
| 月間クエリ10万回 | ~$0.25 |

参考: [Amazon S3 Vectors](https://aws.amazon.com/s3/features/vectors/)
