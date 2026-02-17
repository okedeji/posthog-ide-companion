import { createSystemPromptBuilder } from '../prompts';

describe('SystemPromptBuilder', () => {
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
});
