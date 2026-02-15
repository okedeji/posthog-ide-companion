import {
  DcrResponseSchema,
  OAuthTokenResponseSchema,
  ProjectSchema,
  ProjectListSchema,
  AccountSchema,
} from '../schemas';

// Smoke tests for our API contract, not Zod's validation logic.

describe('auth schemas', () => {
  it('parses a DCR response', () => {
    const result = DcrResponseSchema.parse({
      client_id: 'abc123',
      client_name: 'IDE Companion (VSCode)',
      redirect_uris: ['http://localhost:3000/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
    expect(result.client_id).toBe('abc123');
  });

  it('parses an OAuth token response', () => {
    const result = OAuthTokenResponseSchema.parse({
      access_token: 'phx_abc123',
      refresh_token: 'phx_ref456',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'user:read project:read',
    });
    expect(result.access_token).toBe('phx_abc123');
    expect(result.expires_in).toBe(3600);
  });

  it('parses a paginated project list', () => {
    const result = ProjectListSchema.parse({
      count: 2,
      results: [
        {
          id: 1,
          name: 'Project A',
          api_token: 'phc_a',
          organization: 'Org',
          uuid: 'uuid-a',
        },
        {
          id: 2,
          name: 'Project B',
          api_token: 'phc_b',
          organization: 'Org',
          uuid: 'uuid-b',
        },
      ],
    });
    expect(result.results).toHaveLength(2);
    expect(result.results[0].name).toBe('Project A');
  });

  it('parses a single project', () => {
    const result = ProjectSchema.parse({
      id: 12345,
      name: 'My App',
      api_token: 'phc_abc123',
      organization: 'My Org',
      uuid: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.id).toBe(12345);
  });

  it('parses an account', () => {
    const result = AccountSchema.parse({ id: 'user-123', label: 'Jane Doe' });
    expect(result.id).toBe('user-123');
    expect(result.label).toBe('Jane Doe');
  });
});
