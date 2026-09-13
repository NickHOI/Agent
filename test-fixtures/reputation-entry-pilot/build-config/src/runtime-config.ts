export type RuntimeConfig = {
  environment: "development" | "production";
  auditEventsEnabled: boolean;
};

export function createRuntimeConfig(environment: RuntimeConfig["environment"]): RuntimeConfig {
  return {
    environment,
    auditEventsEnabled: environment === "production",
  };
}
