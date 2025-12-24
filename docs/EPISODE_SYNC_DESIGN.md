# エピソード同期システム設計

## 要件
- **ソース**: DBにエピソードを保存
- **ユーザー**: エンドユーザーがエピソード作成・更新
- **遅延**: 数分OK

## アーキテクチャ

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  ユーザー   │────▶│   API      │────▶│   DB       │────▶│   Queue    │
│  (作成/更新) │     │  エンドポイント│     │  (episodes) │     │  (ingest)  │
└─────────────┘     └─────────────┘     └─────────────┘     └──────┬──────┘
                                                                    │
                                                                    ▼
                                                           ┌─────────────┐
                                                           │  Worker    │
                                                           │  (Ingest)  │
                                                           └──────┬──────┘
                                                                    │
                                                                    ▼
                                                           ┌─────────────┐
                                                           │  S3Vectors │
                                                           └─────────────┘
```

## 実装オプション

### オプションA: シンプル版（推奨）
1. DBにエピソード保存時、`sync_status: 'pending'`フラグを立てる
2. 定期的にpendingをスキャンしてIngest
3. 完了後`sync_status: 'synced'`に更新

**メリット**: 既存のMastraワークフローを活用
**デメリット**: ポーリング方式

### オプションB: キュー版（AWS SQS/Redis使用）
1. DBにエピソード保存
2. SQS/Redisにジョブをenqueue
3. Workerがdequeueして処理

**メリット**: スケーラブル、リトライ容易
**デメリット**: インフラ追加

### オプションC: DB トリガー版
1. DBのトリガーでLambda/Webhook起動
2. 直接Ingest処理

**メリット**: リアルタイムに近い
**デメリット**: DB依存

## 選択: PostgreSQL + シンプル版

MVP段階ではシンプル版で十分。必要に応じてキュー版に移行可能。

## セットアップ

### パッケージ追加
```bash
npm install @mastra/pg pg
```

### 環境変数
```bash
DATABASE_URL=postgresql://user:pass@host:5432/dbname
```

## DBスキーマ

```sql
CREATE TABLE episodes (
  id TEXT PRIMARY KEY,
  episode_no INTEGER NOT NULL UNIQUE,
  content TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  sync_status TEXT DEFAULT 'pending',  -- pending/synced/failed
  synced_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_episodes_sync_status ON episodes(sync_status);
```

## 実装ファイル

| ファイル | 説明 |
|---------|------|
| `src/mastra/episodes/db.ts` | PostgreSQL接続・クエリ |
| `src/mastra/episodes/api.ts` | CRUD API (Mastra Server) |
| `src/mastra/episodes/sync-worker.ts` | 定期同期Worker |

## API設計

```typescript
// POST /api/episodes - 作成
// PUT /api/episodes/:id - 更新
// GET /api/episodes - 一覧
// DELETE /api/episodes/:id - 削除

// POST /api/episodes/sync - 手動同期トリガー
```

## 同期Workerのフロー

```typescript
async function syncPendingEpisodes() {
  // 1. pending状態のエピソードを取得
  const pending = await db.query("SELECT * FROM episodes WHERE sync_status = 'pending'");

  for (const ep of pending) {
    // 2. 古いベクトルを削除（version管理）
    await deleteEpisodeVectors(ep.id);

    // 3. Ingest実行
    await ingestEpisode(ep.id, ep.episode_no, ep.content, ep.version);

    // 4. ステータス更新
    await db.query("UPDATE episodes SET sync_status = 'synced', synced_at = NOW() WHERE id = $1", [ep.id]);
  }
}

// 2分ごとに実行
setInterval(syncPendingEpisodes, 2 * 60 * 1000);
```

## 更新時の処理

```typescript
async function updateEpisode(id: string, content: string) {
  await db.query(`
    UPDATE episodes
    SET content = $1,
        version = version + 1,
        sync_status = 'pending',
        updated_at = NOW()
    WHERE id = $2
  `, [content, id]);
}
```

## sync_statusの状態遷移

```
作成/更新 → pending → (Worker処理) → synced
                          ↓
                       failed (エラー時)
```

## 次のステップ

1. PostgreSQL接続設定
2. episodesテーブル作成
3. CRUD API実装
4. sync-worker実装
5. テスト
