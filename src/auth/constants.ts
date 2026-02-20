export type CloudRegion = 'us' | 'eu';

export const CLOUD_URLS: Record<CloudRegion, string> = {
  us: 'https://us.posthog.com',
  eu: 'https://eu.posthog.com',
};

export const OAUTH_CALLBACK_PATH = '/callback';
export const OAUTH_SCOPES = [
  'user:read',
  'project:read',
  'query:read',
  'feature_flag:read',
  'feature_flag:write',
  'experiment:read',
  'experiment:write',
  'insight:read',
  'insight:write',
  'dashboard:read',
  'dashboard:write',
  'survey:read',
  'survey:write',
  'error_tracking:read',
  'error_tracking:write',
  'session_recording:read',
  'person:read',
  'annotation:read',
];
export const OAUTH_TIMEOUT_MS = 120_000;
export const AUTH_PROVIDER_ID = 'posthog';
export const AUTH_PROVIDER_LABEL = 'PostHog';
export const DCR_CLIENT_NAME = 'IDE Companion (VSCode)';
