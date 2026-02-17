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
