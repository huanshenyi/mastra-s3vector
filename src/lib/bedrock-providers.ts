import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";

const isLocal = process.env.IS_LOCAL === "TRUE";

export const bedrock = createAmazonBedrock(
  isLocal
    ? {
        region: "us-east-1",
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        sessionToken: process.env.AWS_SESSION_TOKEN!,
      }
    : {
        region: "us-east-1",
        credentialProvider: fromNodeProviderChain(),
      },
);

/**
 * Bedrockモデルを作成
 * @param modelId モデルID（例: us.anthropic.claude-3-5-sonnet-20241022-v2:0）
 */
export function createBedrockModel(modelId: string) {
  return bedrock(modelId);
}

/**
 * Bedrock埋め込みモデルを作成
 * @param modelId モデルID（例: amazon.titan-embed-text-v2:0）
 */
export function createBedrockEmbeddingModel(modelId: string) {
  return bedrock.textEmbeddingModel(modelId);
}
