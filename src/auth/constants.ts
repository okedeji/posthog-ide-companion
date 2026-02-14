/** PostHog cloud region — determines API base URL and OAuth endpoints. */
export type CloudRegion = 'us' | 'eu';

/** Base URLs for each PostHog cloud region. */
export const CLOUD_URLS: Record<CloudRegion, string> = {
  us: 'https://us.posthog.com',
  eu: 'https://eu.posthog.com',
};

/** OAuth callback path on the localhost server. */
export const OAUTH_CALLBACK_PATH = '/callback';

/** OAuth scopes requested during authorization. */
export const OAUTH_SCOPES = ['user:read', 'project:read'];

/** Maximum time to wait for OAuth callback (ms). */
export const OAUTH_TIMEOUT_MS = 120_000;

/** VSCode authentication provider ID. */
export const AUTH_PROVIDER_ID = 'posthog';

/** VSCode authentication provider display label. */
export const AUTH_PROVIDER_LABEL = 'PostHog';

/** Client name sent during Dynamic Client Registration. */
export const DCR_CLIENT_NAME = 'IDE Companion (VSCode)';
