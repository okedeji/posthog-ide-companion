import { createSystemPromptBuilder, FOUNDATION_PROMPT } from '../prompts';

describe('FOUNDATION_PROMPT', () => {
  it('should contain AI identity', () => {
    expect(FOUNDATION_PROMPT).toContain('AI assistant');
  });

  it('contains core behavior rules', () => {
    expect(FOUNDATION_PROMPT).toContain('Explain your work');
    expect(FOUNDATION_PROMPT).toContain('Ask for clarification');
    expect(FOUNDATION_PROMPT).toContain('Summarize when done');
    expect(FOUNDATION_PROMPT).toContain('Never modify without approval');
  });

  it('should contain tool usage guidelines', () => {
    expect(FOUNDATION_PROMPT).toContain('Tool Usage Guidelines');
  });
});

describe('SystemPromptBuilder', () => {
  it('includes the foundation prompt by default', () => {
    const builder = createSystemPromptBuilder();
    const prompt = builder.build();
    expect(prompt).toContain('AI assistant');
  });

  it('should add sections in priority order', () => {
    const builder = createSystemPromptBuilder();
    builder.addSection({ key: 'low', content: 'LOW_PRIORITY', priority: 200 });
    builder.addSection({
      key: 'high',
      content: 'HIGH_PRIORITY',
      priority: 10,
    });

    const prompt = builder.build();
    expect(prompt.indexOf('HIGH_PRIORITY')).toBeLessThan(
      prompt.indexOf('LOW_PRIORITY'),
    );
  });

  it('places foundation before all other sections', () => {
    const builder = createSystemPromptBuilder();
    builder.addSection({
      key: 'feature',
      content: 'FEATURE_SECTION',
      priority: 1,
    });

    const prompt = builder.build();
    expect(prompt.indexOf('AI assistant')).toBeLessThan(
      prompt.indexOf('FEATURE_SECTION'),
    );
  });

  it('should overwrite sections with the same key', () => {
    const builder = createSystemPromptBuilder();
    builder.addSection({ key: 'test', content: 'Original' });
    builder.addSection({ key: 'test', content: 'Replacement' });

    const prompt = builder.build();
    expect(prompt).toContain('Replacement');
    expect(prompt).not.toContain('Original');
  });

  it('does not allow removing the foundation section', () => {
    const builder = createSystemPromptBuilder();
    const removed = builder.removeSection('foundation');

    expect(removed).toBe(false);
    expect(builder.build()).toContain('AI assistant');
  });

  it('should remove non-foundation sections', () => {
    const builder = createSystemPromptBuilder();
    builder.addSection({ key: 'temp', content: 'Temporary' });
    const removed = builder.removeSection('temp');

    expect(removed).toBe(true);
    expect(builder.build()).not.toContain('Temporary');
  });

  it('returns false when removing a nonexistent section', () => {
    const builder = createSystemPromptBuilder();
    expect(builder.removeSection('nonexistent')).toBe(false);
  });

  it('should default priority to 100', () => {
    const builder = createSystemPromptBuilder();
    builder.addSection({ key: 'a', content: 'SECTION_A', priority: 50 });
    builder.addSection({ key: 'b', content: 'SECTION_B' }); // default 100

    const prompt = builder.build();
    // Foundation (0) -> A (50) -> B (100)
    expect(prompt.indexOf('SECTION_A')).toBeLessThan(
      prompt.indexOf('SECTION_B'),
    );
  });

  it('joins sections with double newlines', () => {
    const builder = createSystemPromptBuilder();
    builder.addSection({ key: 'extra', content: 'EXTRA', priority: 10 });

    const prompt = builder.build();
    expect(prompt).toContain('\n\nEXTRA');
  });

  it('should support method chaining', () => {
    const builder = createSystemPromptBuilder();
    const result = builder
      .addSection({ key: 'a', content: 'A' })
      .addSection({ key: 'b', content: 'B' });

    expect(result).toBe(builder);
  });

  it('returns registered section keys', () => {
    const builder = createSystemPromptBuilder();
    builder.addSection({ key: 'errors', content: 'Error analysis' });
    builder.addSection({ key: 'chat', content: 'Chat mode' });

    expect(builder.keys).toContain('foundation');
    expect(builder.keys).toContain('errors');
    expect(builder.keys).toContain('chat');
  });
});
