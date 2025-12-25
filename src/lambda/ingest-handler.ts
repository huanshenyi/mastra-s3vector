/**
 * Lambda Handler for Episode Ingest
 *
 * SQSイベントを受け取り、エピソードをS3Vectorsにインジェストする
 */
import type { SQSEvent, SQSRecord, Context } from 'aws-lambda';
import { ingestEpisode } from '../mastra/character-memory/ingest-workflow.js';

interface IngestMessage {
  action: 'create' | 'update';
  storyId: string;
  episodeId: string;
  episodeNo: number;
  version: number;
  text: string;
}

export async function handler(event: SQSEvent, context: Context): Promise<void> {
  console.log(`Received ${event.Records.length} records`);

  for (const record of event.Records) {
    await processRecord(record);
  }
}

async function processRecord(record: SQSRecord): Promise<void> {
  const startTime = Date.now();

  try {
    const message: IngestMessage = JSON.parse(record.body);

    console.log(`Processing story: ${message.storyId}, episode: ${message.episodeId} (action: ${message.action})`);
    console.log(`Episode text length: ${message.text.length} characters`);

    // Update の場合、既存のベクトルを削除してから再作成する
    // （現在はupsertで上書きされるため、削除は不要）

    const result = await ingestEpisode(
      message.episodeId,
      message.episodeNo,
      message.text,
      message.version,
      message.storyId
    );

    const duration = Date.now() - startTime;

    console.log(`Successfully ingested episode ${message.episodeId}`);
    console.log(`  - Facts: ${result.factsCount}`);
    console.log(`  - Vectors: ${result.vectorIds.length}`);
    console.log(`  - Duration: ${duration}ms`);
  } catch (error) {
    console.error(`Failed to process record:`, error);
    throw error; // Re-throw to trigger SQS retry
  }
}
