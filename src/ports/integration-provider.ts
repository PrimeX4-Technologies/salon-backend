import type { IExternalConnector } from "../models/integrations/ExternalConnector.js";
import type { IIntegrationSyncJob } from "../models/integrations/IntegrationSyncJob.js";
import { ApiError } from "../utils/ApiError.js";

export type SafeConnectorConfiguration = Pick<
  IExternalConnector,
  "name" | "provider" | "type" | "scope" | "baseUrl" | "syncPolicies"
> & {
  id: string;
  branchId?: string;
};

export interface IntegrationAdapter {
  readonly provider: string;
  testConnection(input: {
    connector: SafeConnectorConfiguration;
    secretReference: string;
  }): Promise<void>;
  runJob(input: {
    connector: SafeConnectorConfiguration;
    secretReference: string;
    job: Pick<
      IIntegrationSyncJob,
      | "jobId"
      | "direction"
      | "operation"
      | "entityType"
      | "localId"
      | "externalId"
      | "payload"
    >;
  }): Promise<void>;
}

const adapters = new Map<string, IntegrationAdapter>();
const normalizeProvider = (provider: string): string =>
  provider.trim().toLowerCase();

export const registerIntegrationAdapter = (
  adapter: IntegrationAdapter,
): void => {
  const provider = normalizeProvider(adapter.provider);
  if (!provider) throw new Error("An integration provider name is required");
  if (adapters.has(provider)) {
    throw new Error(`Integration provider '${provider}' is already registered`);
  }
  adapters.set(provider, adapter);
};

export const getIntegrationAdapter = (
  provider: string,
): IntegrationAdapter => {
  const normalized = normalizeProvider(provider);
  const adapter = adapters.get(normalized);
  if (!adapter) {
    throw new ApiError(503, "Integration adapter is not configured", {
      code: "INTEGRATION_ADAPTER_NOT_CONFIGURED",
      details: { provider: normalized },
      expose: true,
    });
  }
  return adapter;
};

export const hasIntegrationAdapter = (provider: string): boolean =>
  adapters.has(normalizeProvider(provider));

export const listConfiguredIntegrationProviders = (): string[] =>
  [...adapters.keys()].sort();
