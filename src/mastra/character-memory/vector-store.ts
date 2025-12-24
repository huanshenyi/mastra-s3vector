/**
 * S3Vectorsを使用したキャラクターメモリのベクトルストア
 */
import { S3Vectors } from '@mastra/s3vectors';

// インデックス名
export const CHARACTER_MEMORY_INDEX = 'character-memory';

// 埋め込みモデルの次元数（Amazon Titan Embed V2）
export const EMBEDDING_DIMENSION = 1024;

/**
 * S3Vectorsストアを初期化
 */
export function createCharacterMemoryStore(): S3Vectors {
  const bucketName = process.env.S3_VECTORS_BUCKET_NAME;
  if (!bucketName) {
    throw new Error('S3_VECTORS_BUCKET_NAME environment variable is required');
  }

  return new S3Vectors({
    vectorBucketName: bucketName,
    clientConfig: {
      region: process.env.AWS_REGION || 'us-east-1',
    },
    // 大きなテキストフィールドはフィルタリング対象外にする
    nonFilterableMetadataKeys: ['text'],
  });
}

/**
 * インデックスを作成（存在しない場合のみ）
 */
export async function ensureIndex(store: S3Vectors): Promise<void> {
  await store.createIndex({
    indexName: CHARACTER_MEMORY_INDEX,
    dimension: EMBEDDING_DIMENSION,
    metric: 'cosine',
  });
}

/**
 * ベクトルIDを生成
 * 形式: vec:{episodeId}:v{version}:{scope}:{characterId}:{factIndex}
 */
export function generateVectorId(
  episodeId: string,
  version: number,
  scope: string,
  characterId: string | undefined,
  factIndex: number
): string {
  return `vec:${episodeId}:v${version}:${scope}:${characterId || 'world'}:${factIndex}`;
}
