/**
 * Memory Tool Definitions
 *
 * Tool definitions in OpenAI Function Calling format for AI to manage Memory via tool calling.
 *
 * @public
 */

/**
 * OpenAI Function Calling tool definition type
 *
 * @public
 */
export interface OpenAIToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}

/**
 * createMemory Tool Definition
 *
 * Create a new memory. Use when storing newly learned or generated information in conversation.
 *
 * @public
 */
export const createMemoryTool: OpenAIToolDefinition = {
  type: 'function',
  function: {
    name: 'createMemory',
    description: `Store a new memory.

**What Memory stores**:
Memory stores "this entity's personal information, experiences, views, and facts".
- ✅ Store: this entity's personal info, experiences, preferences, tone, facts
- ❌ Do not store: general knowledge, summary answers, external info

**When to use**:
- You learn this entity's personal info, experience, or view for the first time in conversation
- The user provides their personal information
- You discover a fact about this entity that is not already in Memory

**Criteria**:
- User asked "Where do you work?", Memory had no job info, user said "I work at Acme" → createMemory({ content: "I work as a software engineer at Acme" })
- User asked "What's the hardest part of running a startup?" and shared their experience → createMemory with that experience
- ❌ User asked about startups but you have no entity-specific info and only general knowledge → do not create memory

**Notes**:
- Check for duplicates; if similar content exists, consider updateMemory.
- Use relatedMemoryIds to link to relevant existing memories.
- You are storing this entity's personal info/experience/view, not generating an answer to a question.

**Examples**:
- ✅ Good: createMemory({ content: "Fundraising is the hardest part of running my startup", entityId: "persona-001" })
- ✅ Good: createMemory({ content: "Currently working on a microservices project", entityId: "user-123" })
- ❌ Bad: createMemory({ content: "The biggest challenges in startups are cash flow, team stability...", entityId: "..." }) — general knowledge`,
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description:
            'Memory content (natural language). Store this entity\'s personal info, experience, view, or fact. Do not store general knowledge or summaries. E.g. "Commute from X to Y takes one hour by train."',
        },
        entityId: {
          type: 'string',
          description:
            'Entity ID this memory belongs to (e.g. persona ID, user ID). Plain text.',
        },
        relatedMemoryIds: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional list of existing memory UUIDs to link to. Use UUIDs from the Memory context, e.g. ["abc-123-def-456"]. Do not use labels like "mem-1".',
        },
      },
      required: ['content', 'entityId'],
    },
  },
};

/**
 * updateMemory Tool Definition
 *
 * Update an existing memory. Use when information has changed or you have more accurate info.
 *
 * @public
 */
export const updateMemoryTool: OpenAIToolDefinition = {
  type: 'function',
  function: {
    name: 'updateMemory',
    description: `Update an existing memory.

**What Memory stores**:
Memory stores "this entity's personal information, experiences, views, and facts".
- ✅ Update when: this entity's personal information has changed
- ❌ Do not update with: general knowledge, summary answers, external info

**When to use**:
- Memory context contains this entity's personal info and recent conversation says that info changed
- This entity's personal info was updated or corrected
- You have more accurate or specific information

**Criteria**:
- Memory has "I live in NYC", user said "I moved to Boston" → use updateMemory (not createMemory!)
- Memory has "I work at Acme", user said "I switched to Beta Inc" → use updateMemory (not createMemory!)
- **Important**: If existing Memory context has related info and that info changed, use updateMemory. Do not use createMemory.

**Notes**:
- memoryId must be the existing memory's UUID from the Memory context.
- Prefer update over delete-then-create.

**Example**:
- Previous: user "Where do you live?" → AI "I live in NYC."
- Current: user "I moved to Boston."
- Memory context has "I live in NYC" (UUID: "abc-123")
- → updateMemory({ memoryId: "abc-123", content: "I live in Boston" })`,
    parameters: {
      type: 'object',
      properties: {
        memoryId: {
          type: 'string',
          description: 'UUID of the memory to update (use UUID from Memory context, not table index).',
        },
        content: {
          type: 'string',
          description: 'Updated memory content (natural language). Store the changed personal info. Do not store general knowledge or summaries.',
        },
      },
      required: ['memoryId', 'content'],
    },
  },
};

/**
 * updateMemoryLink Tool Definition
 *
 * Add or remove a link between two memories. Use when two memories are related or no longer related.
 *
 * @public
 */
export const updateMemoryLinkTool: OpenAIToolDefinition = {
  type: 'function',
  function: {
    name: 'updateMemoryLink',
    description: `Add or remove a link between two memories.

**Purpose**:
Linking improves retrieval: memories found by different queries or long edge chains may not appear together. Linking increases the chance that related memories are used together.

**When to use**:
- Two or more related memories appear in Memory context and should be explicitly linked
- Memories from different queries are actually related and likely used together
- A memory found via graph traversal and one from direct search should be used together
- You recognize two memories are related (action: "add")
- The relationship between two memories is no longer valid (action: "remove")

**Criteria**:
- Check each memory's outgoingEdges in the Memory context
- If two memories are not yet linked and should be used together, add a link
- "I built a model with PyTorch" and "I'm interested in ML" both retrieved, user asked about PyTorch → use updateMemoryLink to link them
- **Important**: If two or more related memories are in context and the user referred to their relation, use updateMemoryLink. Do not use createMemory.

**Notes**:
- Use UUIDs and outgoingEdges from the Memory context
- Do not re-link already linked memories
- For bidirectional link, call twice (fromMemoryId↔toMemoryId)
- Add links only when the relation is clear
- If two or more retrieved memories are related, call updateMemoryLink

**Example**:
- Memory context has: Memory #1 (UUID: "mem-1", connected: 0) "I built a model with PyTorch", Memory #2 (UUID: "mem-2", connected: 0) "I'm interested in ML"
- User: "What model did you build with PyTorch?"
- → updateMemoryLink({ fromMemoryId: "mem-1", toMemoryId: "mem-2", action: "add" })`,
    parameters: {
      type: 'object',
      properties: {
        fromMemoryId: {
          type: 'string',
          description: 'Source memory UUID. Use the UUID from the Memory context.',
        },
        toMemoryId: {
          type: 'string',
          description: 'Target memory UUID. Use the UUID from the Memory context.',
        },
        action: {
          type: 'string',
          enum: ['add', 'remove'],
          description: 'Add ("add") or remove ("remove") the link.',
        },
      },
      required: ['fromMemoryId', 'toMemoryId', 'action'],
    },
  },
};

/**
 * deleteMemory Tool Definition
 *
 * Delete a memory. Use only when the information is wrong or no longer needed. Deletion should be used sparingly.
 *
 * @public
 */
export const deleteMemoryTool: OpenAIToolDefinition = {
  type: 'function',
  function: {
    name: 'deleteMemory',
    description: `Delete a memory.

**⚠️ Warning**: Deletion is irreversible. Prefer updateMemory when possible.

**When to use**:
- The information is clearly wrong
- The information is no longer needed at all
- Use only when deletion is necessary

**Notes**:
- Deletion cannot be undone; use with care.
- In most cases updating with updateMemory is safer.
- Use deletion only as a last resort.`,
    parameters: {
      type: 'object',
      properties: {
        memoryId: {
          type: 'string',
          description: 'UUID of the memory to delete (use UUID from Memory context, not table index).',
        },
      },
      required: ['memoryId'],
    },
  },
};

/**
 * logMemoryDecision Tool Definition
 *
 * Log the reasoning for Memory tool usage. This tool must always be called.
 *
 * @public
 */
export const logMemoryDecisionTool: OpenAIToolDefinition = {
  type: 'function',
  function: {
    name: 'logMemoryDecision',
    description: `Log the reasoning for your Memory tool decision. This tool must always be called.

**When to use**:
- When you used other Memory tools: explain why you used them
- When you did not use other Memory tools: explain why not

**Notes**:
- This tool is required on every turn
- Call it whether or not you used other tools
- Be specific and clear in your explanation

**Examples**:
- Used other tool: "I used updateMemory because Memory had 'I live in NYC' and the user said 'I moved to Boston'."
- Did not use: "I did not use Memory tools. The user only asked a question and the retrieved memories already contained the answer."`,
    parameters: {
      type: 'object',
      properties: {
        decision: {
          type: 'string',
          description: 'Explanation of your Memory tool decision: why you used tools or why you did not.',
        },
        usedTools: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of tool names you used (empty array if none). E.g. ["updateMemory"] or []',
        },
      },
      required: ['decision', 'usedTools'],
    },
  },
};

/**
 * Array of all Memory tool definitions
 *
 * @public
 */
export const memoryToolDefinitions: OpenAIToolDefinition[] = [
  createMemoryTool,
  updateMemoryTool,
  updateMemoryLinkTool,
  deleteMemoryTool,
  logMemoryDecisionTool,
];
