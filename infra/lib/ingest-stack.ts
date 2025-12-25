import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3vectors from 'aws-cdk-lib/aws-s3vectors';
import { Construct } from 'constructs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface IngestStackProps extends cdk.StackProps {
  /** ベクトルバケット名（省略時は自動生成） */
  vectorBucketName?: string;
}

export class IngestStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: IngestStackProps) {
    super(scope, id, props);

    // S3 Vectors Bucket
    const vectorBucket = new s3vectors.CfnVectorBucket(this, 'VectorBucket', {
      vectorBucketName: props.vectorBucketName,
      encryptionConfiguration: {
        sseType: 'AES256',
      },
    });

    // Dead Letter Queue
    const dlq = new sqs.Queue(this, 'IngestDLQ', {
      queueName: 'episode-ingest-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    // Main SQS Queue
    const queue = new sqs.Queue(this, 'IngestQueue', {
      queueName: 'episode-ingest-queue',
      visibilityTimeout: cdk.Duration.seconds(120), // Lambda timeout x 2
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 3,
      },
    });

    // Lambda Function
    const ingestHandler = new lambda.Function(this, 'IngestHandler', {
      functionName: 'episode-ingest-handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda-dist')),
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      environment: {
        S3_VECTORS_BUCKET_NAME: vectorBucket.attrVectorBucketArn.split(':').pop() || '',
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Grant S3 Vectors access
    ingestHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3vectors:*'],
      resources: [
        vectorBucket.attrVectorBucketArn,
        `${vectorBucket.attrVectorBucketArn}/*`,
      ],
    }));

    // Grant Bedrock access
    ingestHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: ['*'],
    }));

    // SQS Event Source
    ingestHandler.addEventSource(new lambdaEventSources.SqsEventSource(queue, {
      batchSize: 1, // Process one episode at a time (LLM is slow)
    }));

    // API Gateway
    const api = new apigateway.RestApi(this, 'IngestApi', {
      restApiName: 'Episode Ingest API',
      description: 'API for ingesting episodes into S3Vectors',
      deployOptions: {
        stageName: 'prod',
      },
    });

    // API Key
    const apiKey = api.addApiKey('IngestApiKey', {
      apiKeyName: 'episode-ingest-api-key',
    });

    // Usage Plan
    const usagePlan = api.addUsagePlan('IngestUsagePlan', {
      name: 'Episode Ingest Usage Plan',
      throttle: {
        rateLimit: 10,
        burstLimit: 20,
      },
    });
    usagePlan.addApiKey(apiKey);
    usagePlan.addApiStage({ stage: api.deploymentStage });

    // IAM Role for API Gateway to send messages to SQS
    const apiGatewayRole = new iam.Role(this, 'ApiGatewayRole', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
    });
    queue.grantSendMessages(apiGatewayRole);

    // POST /ingest - API Gateway to SQS Integration
    const ingestResource = api.root.addResource('ingest');
    ingestResource.addMethod('POST', new apigateway.AwsIntegration({
      service: 'sqs',
      path: `${cdk.Aws.ACCOUNT_ID}/${queue.queueName}`,
      integrationHttpMethod: 'POST',
      options: {
        credentialsRole: apiGatewayRole,
        requestParameters: {
          'integration.request.header.Content-Type': "'application/x-www-form-urlencoded'",
        },
        requestTemplates: {
          'application/json': 'Action=SendMessage&MessageBody=$util.urlEncode($input.body)',
        },
        integrationResponses: [
          {
            statusCode: '202',
            responseTemplates: {
              'application/json': '{"message": "Accepted", "messageId": "$input.path(\'$.SendMessageResponse.SendMessageResult.MessageId\')"}',
            },
          },
        ],
      },
    }), {
      apiKeyRequired: true,
      methodResponses: [
        {
          statusCode: '202',
          responseModels: {
            'application/json': apigateway.Model.EMPTY_MODEL,
          },
        },
      ],
    });

    // Outputs
    new cdk.CfnOutput(this, 'VectorBucketArn', {
      value: vectorBucket.attrVectorBucketArn,
      description: 'S3 Vectors Bucket ARN',
    });

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'API Gateway URL',
    });

    new cdk.CfnOutput(this, 'ApiKeyId', {
      value: apiKey.keyId,
      description: 'API Key ID (use AWS CLI to get the actual key value)',
    });

    new cdk.CfnOutput(this, 'QueueUrl', {
      value: queue.queueUrl,
      description: 'SQS Queue URL',
    });

    new cdk.CfnOutput(this, 'DlqUrl', {
      value: dlq.queueUrl,
      description: 'Dead Letter Queue URL',
    });
  }
}
