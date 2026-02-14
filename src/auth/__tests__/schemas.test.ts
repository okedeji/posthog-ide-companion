import {
  DcrResponseSchema,
  OAuthTokenResponseSchema,
  ProjectSchema,
  ProjectListSchema,
  AccountSchema,
} from '../schemas';

describe('DcrResponseSchema', () => {
  const valid = {
    client_id: 'abc123',
    client_name: 'IDE Companion (VSCode)',
    redirect_uris: ['http://localhost:3000/callback'],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };

  it('should parse a valid DCR response', () => {
    const result = DcrResponseSchema.parse(valid);
    expect(result.client_id).toBe('abc123');
    expect(result.redirect_uris).toHaveLength(1);
  });

  it('should reject when client_id is missing', () => {
    const { client_id: _, ...invalid } = valid;
    expect(() => DcrResponseSchema.parse(invalid)).toThrow();
  });

  it('should strip unknown fields', () => {
    const extended = { ...valid, extra_field: 'ignored' };
    const result = DcrResponseSchema.parse(extended);
    expect(result).not.toHaveProperty('extra_field');
  });
});

describe('OAuthTokenResponseSchema', () => {
  const valid = {
    access_token: 'phx_abc123',
    refresh_token: 'phx_ref456',
    expires_in: 3600,
    token_type: 'Bearer',
    scope: 'user:read project:read',
  };

  it('should parse a valid token response', () => {
    const result = OAuthTokenResponseSchema.parse(valid);
    expect(result.access_token).toBe('phx_abc123');
    expect(result.expires_in).toBe(3600);
  });

  it('should reject when access_token is missing', () => {
    const { access_token: _, ...invalid } = valid;
    expect(() => OAuthTokenResponseSchema.parse(invalid)).toThrow();
  });

  it('should reject when expires_in is not a number', () => {
    const invalid = { ...valid, expires_in: 'not-a-number' };
    expect(() => OAuthTokenResponseSchema.parse(invalid)).toThrow();
  });
});

describe('ProjectSchema', () => {
  const valid = {
    id: 12345,
    name: 'My App',
    api_token: 'phc_abc123',
    organization: 'My Org',
    uuid: '550e8400-e29b-41d4-a716-446655440000',
  };

  it('should parse a valid project', () => {
    const result = ProjectSchema.parse(valid);
    expect(result.id).toBe(12345);
    expect(result.name).toBe('My App');
  });

  it('should reject when id is not a number', () => {
    const invalid = { ...valid, id: 'not-a-number' };
    expect(() => ProjectSchema.parse(invalid)).toThrow();
  });

  it('should reject when name is missing', () => {
    const { name: _, ...invalid } = valid;
    expect(() => ProjectSchema.parse(invalid)).toThrow();
  });
});

describe('ProjectListSchema', () => {
  it('should parse a valid paginated project list', () => {
    const valid = {
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
    };
    const result = ProjectListSchema.parse(valid);
    expect(result.count).toBe(2);
    expect(result.results).toHaveLength(2);
  });

  it('should parse an empty project list', () => {
    const valid = { count: 0, results: [] };
    const result = ProjectListSchema.parse(valid);
    expect(result.results).toHaveLength(0);
  });

  it('should reject when results is not an array', () => {
    const invalid = { count: 0, results: 'not-an-array' };
    expect(() => ProjectListSchema.parse(invalid)).toThrow();
  });
});

describe('AccountSchema', () => {
  it('should parse a valid account', () => {
    const valid = { id: 'user-123', label: 'Jane Doe' };
    const result = AccountSchema.parse(valid);
    expect(result.id).toBe('user-123');
    expect(result.label).toBe('Jane Doe');
  });

  it('should reject when id is missing', () => {
    expect(() => AccountSchema.parse({ label: 'Jane Doe' })).toThrow();
  });
});
