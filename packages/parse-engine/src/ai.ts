/**
 * AI Gateway setup.
 * Provides the gateway provider and model factory for all LLM calls.
 */
import { createGateway, type GatewayProvider } from "@ai-sdk/gateway";
import { env } from "./env.js";

let _gateway: GatewayProvider | undefined;

export function getGateway(): GatewayProvider {
  if (!_gateway) {
    _gateway = createGateway({ apiKey: env.aiGatewayApiKey });
  }
  return _gateway;
}

export function getGatewayModel(modelStr: string): ReturnType<GatewayProvider> {
  return getGateway()(modelStr);
}
