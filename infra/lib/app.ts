#!/usr/bin/env node
import 'source-map-support/register.js';
import * as cdk from 'aws-cdk-lib';
import { IngestStack } from './ingest-stack.js';

const app = new cdk.App();

// Get optional vector bucket name (if not provided, AWS will auto-generate)
const vectorBucketName = process.env.S3_VECTORS_BUCKET_NAME || app.node.tryGetContext('vectorBucketName');

new IngestStack(app, 'EpisodeIngestStack', {
  vectorBucketName,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
});
