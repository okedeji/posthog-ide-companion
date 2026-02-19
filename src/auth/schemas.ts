import { z } from 'zod';

// POST /oauth/register (RFC 7591)
export const DcrResponseSchema = z.object({
  client_id: z.string(),
  client_name: z.string(),
  redirect_uris: z.array(z.string()),
  grant_types: z.array(z.string()),
  response_types: z.array(z.string()),
  token_endpoint_auth_method: z.string(),
});

// POST /oauth/token
export const OAuthTokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
  token_type: z.string(),
  scope: z.string(),
});

// Shown in the VSCode Accounts menu
export const AccountSchema = z.object({
  id: z.string(),
  label: z.string(),
});

export type DcrResponse = z.infer<typeof DcrResponseSchema>;
export type OAuthTokenResponse = z.infer<typeof OAuthTokenResponseSchema>;
export type PostHogAccount = z.infer<typeof AccountSchema>;
