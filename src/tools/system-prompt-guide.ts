/**
 * System Prompt Guide
 *
 * Provides a system prompt guide for AI when managing Memory via tools.
 *
 * @public
 */

/**
 * Memory management guide text
 *
 * Include this in the system prompt when the model should manage Memory via tools.
 *
 * @public
 */
export const memoryManagementGuide = `# Memory Management Guide

**What Memory stores**:
Memory stores "this entity's personal information, experiences, views, and facts".
- ✅ Store: this entity's personal info, experiences, preferences, tone, facts
- ❌ Do not store: general knowledge, summary answers, external info, obvious inferences

**Examples**:
- ✅ Good (Persona/User): "Running a startup, fundraising is the hardest part" (this entity's experience)
- ✅ Good (Persona/User): "I work as a software engineer at Acme" (this entity's info)
- ✅ Good (Organization): "Last year's revenue was $X; payroll was $Y" (this entity's org info)
- ❌ Bad: "The biggest challenge in startups is cash flow and team stability..." (general knowledge)

**Important**: When storing, updating, or linking this entity's personal information in conversation, you must use the provided tools. Memory is central to consistency and context.

**Required tool usage**
- **logMemoryDecision must always be called**. Whether or not you use other tools, call it every time.
- **Parallel tool calling is supported**. e.g. call updateMemory and logMemoryDecision together.
- **Order**: (1) Call any needed Memory tools (createMemory, updateMemory, updateMemoryLink, etc.), (2) Then always call logMemoryDecision with usedTools listing the tools you called.

**When to use each tool** (see each tool's description):
- New information to store → createMemory
- Existing information changed → updateMemory
- Link two memories → updateMemoryLink (check outgoingEdges in context first; if not linked, use updateMemoryLink)
- If you are only answering a question, you need not call Memory tools (but you must still call logMemoryDecision)

## Decision process

1. **Check context**: Review the current Memory context
2. **Compare**: Compare recent conversation with retrieved memories
3. **Decide**: Use each tool's "when to use" and criteria to choose the right tool
4. **Execute**: Call the chosen tool(s)
5. **Consistency**: Keep existing memories consistent

Use Memory tools only when you need to store, update, or link information—not for answering questions alone.

## Principles

- Memory operations must be done via tool calling
- Follow the guidelines in each tool's description
- Maintain consistency with existing memories
- Link related memories to preserve context
- Use delete only as a last resort`;

/**
 * Tool usage guide reference
 *
 * @public
 */
export const toolUsageGuide = {
  createMemory: {
    description: 'Store a new memory.',
    whenToUse: [
      'When you learn new information in conversation',
      'When the user provides information not already in Memory',
      'When you discover new facts about the entity',
    ],
    example: {
      scenario: 'User asked "Where do you work?" and it was not in Memory',
      steps: [
        '1. Search relevant memories',
        '2. Confirm the information is missing',
        '3. Call createMemory({ content: "I work as a software engineer at Acme", entityId: "persona-123" })',
      ],
    },
  },
  updateMemory: {
    description: 'Update an existing memory.',
    whenToUse: [
      'When existing information has changed',
      'When you have more accurate information',
      'When the stored information is wrong',
    ],
    example: {
      scenario: 'User said "I moved to Boston"',
      steps: [
        '1. Find existing memory (e.g. "I live in NYC")',
        '2. Call updateMemory({ memoryId: "uuid-123", content: "I live in Boston" })',
      ],
    },
  },
  updateMemoryLink: {
    description: 'Add or remove links between memories.',
    whenToUse: [
      'When two memories are related — add link',
      'When two memories are no longer related — remove link',
    ],
    example: {
      scenario: '"Likes coffee" and "Hard to wake up in the morning" are related',
      steps: [
        '1. Confirm the two memories are related',
        '2. Call updateMemoryLink({ fromMemoryId: "uuid-1", toMemoryId: "uuid-2", action: "add" })',
      ],
    },
  },
  deleteMemory: {
    description: 'Delete a memory. Use sparingly.',
    whenToUse: [
      'When the information is wrong',
      'When the information is no longer needed',
    ],
    warning: 'Deletion is irreversible. Prefer updateMemory when possible.',
    example: {
      scenario: 'Confirmed wrong information',
      steps: [
        '1. Identify the wrong memory',
        '2. Call deleteMemory({ memoryId: "uuid-123" })',
      ],
    },
  },
} as const;
