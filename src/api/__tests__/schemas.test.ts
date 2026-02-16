import {
  ErrorTrackingIssueSchema,
  ErrorTrackingIssueAggregationsSchema,
  ErrorTrackingIssueAssigneeSchema,
  ErrorTrackingEventSchema,
  ErrorTrackingQueryResponseSchema,
} from '../schemas';

const validIssue = {
  id: 'issue-abc-123',
  first_seen: '2025-01-15T10:30:00Z',
  last_seen: '2025-02-10T14:22:00Z',
  status: 'active',
  aggregations: { occurrences: 42, sessions: 18, users: 12 },
  assignee: { id: 7, type: 'user' },
  description: 'TypeError: Cannot read properties of undefined',
  name: 'TypeError',
  library: 'posthog-js',
  source: 'src/components/Dashboard.tsx',
  function: 'fetchData',
  first_event: {
    uuid: 'evt-111',
    distinct_id: 'user-42',
    timestamp: '2025-01-15T10:30:00Z',
    properties: '{"$browser":"Chrome","$exception_list":[]}',
  },
  last_event: {
    uuid: 'evt-999',
    distinct_id: 'user-77',
    timestamp: '2025-02-10T14:22:00Z',
    properties: '{"$browser":"Firefox","$exception_list":[]}',
  },
};

describe('ErrorTrackingIssueAggregationsSchema', () => {
  it('should parse valid aggregations', () => {
    const result = ErrorTrackingIssueAggregationsSchema.safeParse({
      occurrences: 42,
      sessions: 18,
      users: 12,
    });
    expect(result.success).toBe(true);
  });

  it('should reject missing fields', () => {
    const result = ErrorTrackingIssueAggregationsSchema.safeParse({
      occurrences: 42,
    });
    expect(result.success).toBe(false);
  });
});

describe('ErrorTrackingIssueAssigneeSchema', () => {
  it('should accept numeric id', () => {
    const result = ErrorTrackingIssueAssigneeSchema.safeParse({
      id: 7,
      type: 'user',
    });
    expect(result.success).toBe(true);
  });

  it('should accept string id', () => {
    const result = ErrorTrackingIssueAssigneeSchema.safeParse({
      id: 'user-abc',
      type: 'role',
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid type', () => {
    const result = ErrorTrackingIssueAssigneeSchema.safeParse({
      id: 1,
      type: 'team',
    });
    expect(result.success).toBe(false);
  });
});

describe('ErrorTrackingEventSchema', () => {
  it('should parse a valid event snapshot', () => {
    const result = ErrorTrackingEventSchema.safeParse({
      uuid: 'evt-111',
      distinct_id: 'user-42',
      timestamp: '2025-01-15T10:30:00Z',
      properties: '{"$browser":"Chrome"}',
    });
    expect(result.success).toBe(true);
  });

  it('should reject missing properties field', () => {
    const result = ErrorTrackingEventSchema.safeParse({
      uuid: 'evt-111',
      distinct_id: 'user-42',
      timestamp: '2025-01-15T10:30:00Z',
    });
    expect(result.success).toBe(false);
  });
});

describe('ErrorTrackingIssueSchema', () => {
  it('should parse a fully populated issue', () => {
    const result = ErrorTrackingIssueSchema.safeParse(validIssue);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('issue-abc-123');
      expect(result.data.aggregations?.occurrences).toBe(42);
      expect(result.data.first_event?.uuid).toBe('evt-111');
      expect(result.data.last_event?.uuid).toBe('evt-999');
    }
  });

  it('should parse a minimal issue with only required fields', () => {
    const result = ErrorTrackingIssueSchema.safeParse({
      id: 'issue-minimal',
      first_seen: '2025-01-01T00:00:00Z',
      last_seen: '2025-01-01T00:00:00Z',
      status: 'active',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.aggregations).toBeUndefined();
      expect(result.data.description).toBeUndefined();
      expect(result.data.first_event).toBeUndefined();
    }
  });

  it('should handle null optional fields', () => {
    const result = ErrorTrackingIssueSchema.safeParse({
      id: 'issue-nulls',
      first_seen: '2025-01-01T00:00:00Z',
      last_seen: '2025-01-01T00:00:00Z',
      status: 'resolved',
      description: null,
      name: null,
      library: null,
      source: null,
      function: null,
      assignee: null,
      aggregations: null,
      first_event: null,
      last_event: null,
    });
    expect(result.success).toBe(true);
  });

  it('should reject unknown status values', () => {
    const result = ErrorTrackingIssueSchema.safeParse({
      id: 'issue-unknown-status',
      first_seen: '2025-01-01T00:00:00Z',
      last_seen: '2025-01-01T00:00:00Z',
      status: 'some_future_status',
    });
    expect(result.success).toBe(false);
  });

  it('should reject when required id is missing', () => {
    const result = ErrorTrackingIssueSchema.safeParse({
      first_seen: '2025-01-01T00:00:00Z',
      last_seen: '2025-01-01T00:00:00Z',
      status: 'active',
    });
    expect(result.success).toBe(false);
  });
});

describe('ErrorTrackingQueryResponseSchema', () => {
  it('should parse a response with multiple issues', () => {
    const result = ErrorTrackingQueryResponseSchema.safeParse({
      results: [validIssue, { ...validIssue, id: 'issue-second' }],
      hasMore: true,
      limit: 50,
      offset: 0,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.results).toHaveLength(2);
      expect(result.data.hasMore).toBe(true);
    }
  });

  it('should parse an empty response', () => {
    const result = ErrorTrackingQueryResponseSchema.safeParse({
      results: [],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.results).toHaveLength(0);
    }
  });

  it('should reject when results is missing', () => {
    const result = ErrorTrackingQueryResponseSchema.safeParse({
      hasMore: false,
    });
    expect(result.success).toBe(false);
  });
});
