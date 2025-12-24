/**
 * エピソードIngestスクリプト
 *
 * docs/character_memory配下のエピソードファイルを読み込み、
 * S3Vectorsにベクトル化して保存する
 *
 * 使用方法:
 *   npx tsx scripts/ingest-episodes.ts
 *   npx tsx scripts/ingest-episodes.ts --episode 1  # 特定のエピソードのみ
 */
import 'dotenv/config';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { ingestEpisode } from '../src/mastra/character-memory';

const EPISODES_DIR = join(process.cwd(), 'docs/character_memory');

interface IngestResult {
  episodeId: string;
  episodeNo: number;
  version: number;
  factsCount: number;
  vectorIds: string[];
}

async function loadEpisode(episodeNo: number): Promise<{ text: string; id: string }> {
  const filePath = join(EPISODES_DIR, `${episodeNo}.md`);
  const text = readFileSync(filePath, 'utf-8');
  return {
    text,
    id: `episode-${episodeNo}`,
  };
}

async function getAvailableEpisodes(): Promise<number[]> {
  const files = readdirSync(EPISODES_DIR);
  return files
    .filter(f => f.endsWith('.md'))
    .map(f => parseInt(f.replace('.md', ''), 10))
    .filter(n => !isNaN(n))
    .sort((a, b) => a - b);
}

async function ingestAllEpisodes(): Promise<void> {
  const episodes = await getAvailableEpisodes();
  console.log(`Found ${episodes.length} episodes: ${episodes.join(', ')}`);

  const results: IngestResult[] = [];

  for (const episodeNo of episodes) {
    console.log(`\n--- Processing Episode ${episodeNo} ---`);

    const { text, id } = await loadEpisode(episodeNo);
    console.log(`Loaded ${text.length} characters`);

    const result = await ingestEpisode(id, episodeNo, text, 1);
    results.push(result);

    console.log(`Extracted ${result.factsCount} facts`);
    console.log(`Created ${result.vectorIds.length} vectors`);
  }

  // 結果サマリー
  console.log('\n=== Ingest Summary ===');
  for (const r of results) {
    console.log(`Episode ${r.episodeNo}: ${r.factsCount} facts, ${r.vectorIds.length} vectors`);
  }

  const totalFacts = results.reduce((sum, r) => sum + r.factsCount, 0);
  const totalVectors = results.reduce((sum, r) => sum + r.vectorIds.length, 0);
  console.log(`Total: ${totalFacts} facts, ${totalVectors} vectors`);
}

async function ingestSingleEpisode(episodeNo: number): Promise<void> {
  console.log(`--- Processing Episode ${episodeNo} ---`);

  const { text, id } = await loadEpisode(episodeNo);
  console.log(`Loaded ${text.length} characters`);

  const result = await ingestEpisode(id, episodeNo, text, 1);

  console.log(`Extracted ${result.factsCount} facts`);
  console.log(`Created ${result.vectorIds.length} vectors`);
  console.log(`Vector IDs:`);
  for (const vid of result.vectorIds) {
    console.log(`  - ${vid}`);
  }
}

// メイン処理
async function main() {
  const args = process.argv.slice(2);
  const episodeIndex = args.indexOf('--episode');

  if (episodeIndex !== -1 && args[episodeIndex + 1]) {
    const episodeNo = parseInt(args[episodeIndex + 1], 10);
    if (isNaN(episodeNo)) {
      console.error('Invalid episode number');
      process.exit(1);
    }
    await ingestSingleEpisode(episodeNo);
  } else {
    await ingestAllEpisodes();
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
