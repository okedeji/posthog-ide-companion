import { z } from 'zod';

/**
 * Dynamic Client Registration response.
 * Returned by POST /oauth/register (RFC 7591).
 */
export const DcrResponseSchema = z.object({
  client_id: z.string(),
  client_name: z.string(),
  redirect_uris: z.array(z.string()),
  grant_types: z.array(z.string()),
  response_types: z.array(z.string()),
  token_endpoint_auth_method: z.string(),
});

/**
 * OAuth token response.
 * Returned by POST /oauth/token.
 */
export const OAuthTokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
  token_type: z.string(),
  scope: z.string(),
});

/**
 * PostHog project.
 * From GET /api/projects/ list results.
 */
export const ProjectSchema = z.object({
  id: z.number(),
  name: z.string(),
  api_token: z.string(),
  organization: z.string(),
  uuid: z.string(),
});

/** Paginated project list response. */
export const ProjectListSchema = z.object({
  count: z.number(),
  results: z.array(ProjectSchema),
});

/**
 * Account info stored alongside the auth session.
 * Used to display the user's identity in the VSCode Accounts menu.
 */
export const AccountSchema = z.object({
  id: z.string(),
  label: z.string(),
});

// Derive TypeScript types from Zod schemas (single source of truth)
export type DcrResponse = z.infer<typeof DcrResponseSchema>;
export type OAuthTokenResponse = z.infer<typeof OAuthTokenResponseSchema>;
export type PostHogProject = z.infer<typeof ProjectSchema>;
export type PostHogAccount = z.infer<typeof AccountSchema>;
