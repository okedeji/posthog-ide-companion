import { z } from 'zod';

export const ProjectSchema = z.object({
  id: z.number(),
  name: z.string(),
  api_token: z.string(),
  organization: z.string(),
  uuid: z.string(),
});

export const ProjectListSchema = z.object({
  count: z.number(),
  results: z.array(ProjectSchema),
});

export type PostHogProject = z.infer<typeof ProjectSchema>;

// Error tracking (queried via POST /query/ with ErrorTrackingQuery)

export const ErrorTrackingIssueAggregationsSchema = z.object({
  occurrences: z.number(),
  sessions: z.number(),
  users: z.number(),
});

export const ErrorTrackingIssueAssigneeSchema = z.object({
  id: z.union([z.string(), z.number()]),
  type: z.enum(['user', 'role']),
});

export const ErrorTrackingEventSchema = z.object({
  uuid: z.string(),
  distinct_id: z.string(),
  timestamp: z.string(),
  properties: z.string(), // JSON string - stack trace, browser info, etc.
});

// Mirrors ErrorTrackingIssue from posthog/schema.py
export const ErrorTrackingIssueSchema = z.object({
  id: z.string(),
  first_seen: z.string(),
  last_seen: z.string(),
  status: z.enum([
    'active',
    'resolved',
    'archived',
    'pending_release',
    'suppressed',
  ]),
  aggregations: ErrorTrackingIssueAggregationsSchema.nullable().optional(),
  assignee: ErrorTrackingIssueAssigneeSchema.nullable().optional(),
  description: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  library: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  function: z.string().nullable().optional(),
  first_event: ErrorTrackingEventSchema.nullable().optional(),
  last_event: ErrorTrackingEventSchema.nullable().optional(),
});

export const ErrorTrackingQueryResponseSchema = z.object({
  results: z.array(ErrorTrackingIssueSchema),
  hasMore: z.boolean().nullable().optional(),
  limit: z.number().nullable().optional(),
  offset: z.number().nullable().optional(),
  columns: z.array(z.string()).nullable().optional(),
});

export type ErrorTrackingIssueAggregations = z.infer<
  typeof ErrorTrackingIssueAggregationsSchema
>;
export type ErrorTrackingIssueAssignee = z.infer<
  typeof ErrorTrackingIssueAssigneeSchema
>;
export type ErrorTrackingEvent = z.infer<typeof ErrorTrackingEventSchema>;
export type ErrorTrackingIssue = z.infer<typeof ErrorTrackingIssueSchema>;
export type ErrorTrackingQueryResponse = z.infer<
  typeof ErrorTrackingQueryResponseSchema
>;

// Feature flags — POST/PATCH /api/projects/{id}/feature_flags/

export const FeatureFlagGroupSchema = z.object({
  rollout_percentage: z.number().optional(),
  properties: z.array(z.unknown()).optional(),
  variant: z.string().nullable().optional(),
});

export const FeatureFlagFiltersSchema = z.object({
  groups: z.array(FeatureFlagGroupSchema).optional(),
  multivariate: z.unknown().nullable().optional(),
  payloads: z.record(z.string()).optional(),
});

export const FeatureFlagSchema = z.object({
  id: z.number(),
  key: z.string(),
  name: z.string(),
  active: z.boolean(),
  deleted: z.boolean().optional(),
  filters: FeatureFlagFiltersSchema.optional(),
  tags: z.array(z.string()).optional(),
  created_at: z.string().optional(),
});

export type FeatureFlag = z.infer<typeof FeatureFlagSchema>;
export type FeatureFlagFilters = z.infer<typeof FeatureFlagFiltersSchema>;
export type FeatureFlagGroup = z.infer<typeof FeatureFlagGroupSchema>;

// Experiments — POST/PATCH /api/projects/{id}/experiments/

export const ExperimentVariantSchema = z.object({
  key: z.string(),
  name: z.string().optional(),
  rollout_percentage: z.number(),
});

export const ExperimentSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().nullable().optional(),
  feature_flag_key: z.string(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  archived: z.boolean().optional(),
  conclusion: z.string().nullable().optional(),
  conclusion_comment: z.string().nullable().optional(),
  parameters: z
    .object({
      feature_flag_variants: z.array(ExperimentVariantSchema).optional(),
      rollout_percentage: z.number().optional(),
    })
    .nullable()
    .optional(),
  created_at: z.string().optional(),
});

export type Experiment = z.infer<typeof ExperimentSchema>;
export type ExperimentVariant = z.infer<typeof ExperimentVariantSchema>;

// Insights — POST/PATCH /api/projects/{id}/insights/

export const InsightSchema = z.object({
  id: z.number(),
  short_id: z.string(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  filters: z.record(z.unknown()).optional(),
  query: z.unknown().nullable().optional(),
  dashboards: z.array(z.number()).nullable().optional(),
  created_at: z.string().optional(),
});

export type Insight = z.infer<typeof InsightSchema>;

// Dashboards — POST /api/projects/{id}/dashboards/

export const DashboardSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().nullable().optional(),
  created_at: z.string().optional(),
});

export type Dashboard = z.infer<typeof DashboardSchema>;

// GET /api/users/@me/
export const UserInfoSchema = z.object({
  distinct_id: z.string().optional(),
  email: z.string().optional(),
  first_name: z.string().optional(),
});
