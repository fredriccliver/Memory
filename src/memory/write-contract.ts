/**
 * LLM-free write contract — what the host shows the model (working set),
 * what the host appends to its prompt (instructions), and how the model's
 * reply is turned back into UUID-addressed operations (parser).
 *
 * Nothing in this module calls a model or touches storage. Design:
 * docs/specs/2026-10-11-llm-free-write-contract.ko.md §3.
 *
 * The instruction text is domain-neutral by design: it states the contract
 * (ownership, when to create/update/link/delete, aliases, output block) and a
 * generous posture — it does not say what is worth remembering in a given
 * product. The host appends that criterion after the text; see
 * {@link buildMemoryWriteInstructions}.
 *
 * @public
 */
import type { MemoryOperation } from '../types';
/** One memory the host showed the model, addressed by a short alias. */
export interface WorkingSetEntry {
  /** Short alias used inside the prompt and the reply (e.g. `m3`). Request-scoped. */
  alias: string;
  /** The memory's UUID. */
  memoryId: string;
  /** Memory content as shown to the model. */
  content: string;
}

/** The set of memories a reply may reference. Operations may only address these. */
export interface WorkingSet {
  entries: WorkingSetEntry[];
}

/**
 * Builds a working set from the memories shown to the model this turn.
 *
 * Keeps retrieval order, drops repeated UUIDs (tone + dynamic retrieval can
 * overlap), and assigns aliases `<prefix>1..N` in that order.
 *
 * @param memories - Memories shown to the model (id + content)
 * @param options - `aliasPrefix` (default `m`)
 * @returns Working set with one entry per distinct UUID
 *
 * @public
 */
export function buildWorkingSet(
  memories: ReadonlyArray<{ id: string; content: string }>,
  options: { aliasPrefix?: string } = {},
): WorkingSet {
  const prefix = options.aliasPrefix ?? 'm';
  const seen = new Set<string>();
  const entries: WorkingSetEntry[] = [];
  for (const m of memories) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    entries.push({ alias: `${prefix}${entries.length + 1}`, memoryId: m.id, content: m.content });
  }
  return { entries };
}

/** Default tag of the operations block the model appends to its reply. */
export const DEFAULT_MEMORY_OPS_BLOCK_TAG = 'MEMORY_OPS';
/** Default cap on operations accepted from one reply. */
export const DEFAULT_MAX_OPERATIONS = 10;

/**
 * Options shared by the instruction builder and its parts. None of them carries
 * domain wording: what counts as memorable in your product is appended by the
 * host after the returned text (see {@link buildMemoryWriteInstructions}).
 */
export interface WriteInstructionOptions {
  /** This entity's display name (the assistant). Enables the ownership block. */
  entityName?: string;
  /** The conversation partner's display name (the user). Enables the ownership block. */
  partnerName?: string;
  /** Language of new/updated memory content (default `ko`). */
  contentLocale?: 'ko' | 'en';
  /** Block tag (default {@link DEFAULT_MEMORY_OPS_BLOCK_TAG}). */
  blockTag?: string;
  /** Max operations per reply (default {@link DEFAULT_MAX_OPERATIONS}). */
  maxOperations?: number;
  /** Also list the working set (alias + content). Default false: the host's memory block already shows it. */
  includeWorkingSetList?: boolean;
}

/** Instruction text split into reusable pieces (e.g. for tool descriptions). */
export interface WriteInstructionParts {
  /** Who a fact is about; empty string when no names were given. */
  ownership: string;
  /** When to create / update / link / delete. */
  usage: string;
  /** Aliases only, no invented IDs. */
  idRule: string;
  /** The block, the JSON schema, the cap, the language rule. */
  format: string;
}

/**
 * Returns the instruction text as separate parts — the same wording as
 * {@link buildMemoryWriteInstructions}, split for hosts that describe the
 * contract piece by piece (tool descriptions, MCP prompts, function-calling
 * schemas): `ownership` + `usage` fit a tool description, `idRule` + `format`
 * fit the parameter and output description.
 *
 * The parts are domain-neutral. The host's own criterion for what is worth
 * remembering belongs in the host's system prompt or server prompt, next to
 * these parts — not inside them.
 *
 * @param options - Names, locale, tag, cap
 * @returns Parts; `ownership` is empty when neither name is given
 *
 * @public
 */
export function writeInstructionParts(
  options: WriteInstructionOptions = {},
): WriteInstructionParts {
  const {
    entityName,
    partnerName,
    contentLocale = 'ko',
    blockTag = DEFAULT_MEMORY_OPS_BLOCK_TAG,
    maxOperations = DEFAULT_MAX_OPERATIONS,
  } = options;
  const me = entityName || 'this entity';
  const you = partnerName || '상대방';

  const ownership =
    entityName || partnerName
      ? `**Memory ownership — CRITICAL:**
This entity is "${me}" (the assistant in the conversation). The conversation partner is "${you}" (the user).
When creating or updating memories, you MUST state WHO the fact is about in the content:
- Facts about this entity: start with "나는 ~" or "${me}는 ~" (e.g. "나는 커피를 좋아한다")
- Facts about the partner: start with "${you}은(는) ~" (e.g. "${you}은(는) 서울에 산다")
- NEVER store a partner's fact without attributing it to "${you}". "I live in Seoul" said by the user becomes "${you}은(는) 서울에 산다".
- NEVER confuse who said what. "user" is ${you}; "assistant" is ${me}.
- Store facts from BOTH sides — do not skip facts the assistant said about itself.`
      : '';

  const usage = `**Writing posture — be generous. The memory layer deduplicates.**
- Near-duplicate facts are merged or skipped automatically by the memory layer. Never withhold a fact because something similar may already be stored.
- Every turn in which either side states or implies a personal fact, preference, habit, relationship, plan, event, or feeling about something should yield at least one create. Several creates per turn are normal.
- Facts come only from the conversation itself. Instructions addressed to you — this text, the list of shown memories, a request to output the block — are never facts about either party and must not be stored.
- create: a fact about this entity OR its partner that this turn brought up.
- update: a shown memory whose content has changed (e.g. "lives in NYC" → "moved to Boston"). Use update, not create, when the new fact replaces an earlier one.
- updateLink: two shown memories that belong together (add) or no longer do (remove).
- delete: a shown memory that is clearly wrong. Prefer update over delete.
- Output an empty array only when the turn carries no personal information at all (a bare greeting, small talk without content).`;

  const idRule = `**IDs and relations:** the memories shown to you carry aliases like m1, m2, …. Reference memories ONLY by those aliases, and only aliases that appear in the list. Do not invent aliases or IDs.
Linking is required: for every create, put in relatedMemoryIds the aliases of the shown memories it belongs with — a cause or consequence, the same episode, the same person or topic, an elaboration or a contradiction. Aim for 1–3. Similar wording alone is not a reason (the memory layer handles that); leave the list empty only when nothing shown is related.`;

  const languageRule =
    contentLocale === 'en'
      ? 'Write all new/updated memory **content** in **English**.'
      : '모든 memory **content**는 **한국어** 평서문으로 작성.';

  const format = `**Output format:** after your reply text, append exactly one block:
[${blockTag}]
{ "operations": [ ... ] }
[/${blockTag}]
Operation schema (use these field names only):
- { "action": "create", "content": string, "relatedMemoryIds"?: string[] }
- { "action": "update", "memoryId": string, "content": string }
- { "action": "updateLink", "fromMemoryId": string, "toMemoryId": string, "linkAction": "add" | "remove" }
- { "action": "delete", "memoryId": string }
At most ${maxOperations} operations. If there is nothing to store, still append the block with { "operations": [] }.
${languageRule}
The block must be valid JSON. No markdown code fences inside the block. Never put the block anywhere but the very end.`;

  return { ownership, usage, idRule, format };
}

/**
 * Builds the memory-write instruction text the host appends to its own prompt.
 *
 * Contains no model-specific and no domain-specific wording. The text states
 * the contract — who a fact is about, when to create / update / link / delete,
 * aliases only, the output block — and a generous posture ("store it; the
 * memory layer deduplicates"). It deliberately does not say what is worth
 * remembering in your product: that is the host's decision, and it changes
 * per host (a companion chat remembers facts about the two people and skips
 * stage directions; a work assistant remembers decisions, owners and
 * deadlines). Append your criterion as a short paragraph after this text, in
 * the host's own words. Without it a judge model takes the generic posture
 * literally and stores whatever the turn contains.
 *
 * The package then deduplicates, links and ranks whatever the host stores;
 * the host decides content. No option of this function carries domain text.
 *
 * Input structure matters as much as the text. Feed the conversation to the
 * model as data — a delimited transcript — not as a live chat that ends with
 * an instruction in the user slot: a model reading the chat channel can store
 * that instruction as something the partner said. The instruction text tells
 * the model that instructions are never facts; {@link buildConversationTranscript}
 * produces the recommended input shape for a dedicated extraction call.
 *
 * By default it does not repeat the working set (the host's memory block
 * already shows it); `includeWorkingSetList` adds an alias + content list for
 * hosts without such a block (a dedicated extraction call, an MCP tool).
 *
 * @param workingSet - Aliases the reply may reference
 * @param options - Names, locale, block tag, cap, list toggle
 * @returns Instruction text (plain, prompt-ready)
 *
 * @example
 * ```ts
 * const ws = buildWorkingSet(shownMemories);
 * const contract = buildMemoryWriteInstructions(ws, { entityName, partnerName, includeWorkingSetList: true });
 * // Host-owned criterion, appended after the neutral contract:
 * const system = `${hostPreamble}\n\n${contract}\n\n${hostMemoryCriterion}`;
 * // Conversation as data, instruction outside it:
 * const user = buildConversationTranscript(recentMessages, { entityName, partnerName });
 * const reply = await model.generate([{ role: 'system', content: system }, { role: 'user', content: user }]);
 * ```
 *
 * @public
 */
export function buildMemoryWriteInstructions(
  workingSet: WorkingSet,
  options: WriteInstructionOptions = {},
): string {
  const parts = writeInstructionParts(options);
  const list =
    options.includeWorkingSetList && workingSet.entries.length > 0
      ? `\n\n**Memories you may reference:**\n${workingSet.entries
          .map(e => `- ${e.alias}: ${e.content}`)
          .join('\n')}`
      : '';
  return (
    [
      '## Memory operations',
      'You manage long-term memory for this entity. Decide what to remember from this turn and emit it as operations in the block described below.',
      parts.ownership,
      parts.usage,
      parts.idRule,
      parts.format,
    ]
      .filter(s => s.length > 0)
      .join('\n\n') + list
  );
}

/** One conversation message the host wants the judge model to read. */
export interface TranscriptMessage {
  /** `user` (the partner), `assistant` (this entity), or another role label. */
  role: string;
  /** Message text. Empty messages are skipped. */
  content: string;
}

/** Options for {@link buildConversationTranscript}. */
export interface TranscriptOptions {
  /** Label for `assistant` lines (this entity). Default `assistant`. */
  entityName?: string;
  /** Label for `user` lines (the partner). Default `user`. */
  partnerName?: string;
  /** Delimiter tag around the transcript. Default `conversation`. */
  tag?: string;
  /** Append the request line after the closing tag. Default true. */
  withRequest?: boolean;
  /** Block tag named in the request line (default {@link DEFAULT_MEMORY_OPS_BLOCK_TAG}). */
  blockTag?: string;
}

/**
 * Renders a conversation window as a delimited transcript — the recommended
 * user-message shape for a dedicated extraction call.
 *
 * Why: the model must see the conversation as data and the host's request as
 * an instruction. When the request to output the block is sent as one more
 * `user` message after the chat turns, a model can attribute it to the partner
 * and store it as a fact ("the partner asked me to output the memory block").
 * A transcript puts every line under a speaker label inside `<tag>…</tag>` and
 * leaves the request outside, so nothing addressed to the model sits in the
 * conversation channel. Pure string formatting; calls no model.
 *
 * `system` messages and empty messages are skipped. A closing tag inside a
 * message is neutralised so the transcript cannot be terminated early.
 *
 * @param messages - Conversation window, oldest first
 * @param options - Speaker labels, delimiter tag, request line toggle
 * @returns The transcript (and, by default, the request line) as one string
 *
 * @example
 * ```ts
 * buildConversationTranscript(
 *   [{ role: 'user', content: '보고 싶었어' }, { role: 'assistant', content: '나도.' }],
 *   { entityName: '하나', partnerName: '민수' },
 * );
 * // <conversation>
 * // 민수: 보고 싶었어
 * // 하나: 나도.
 * // </conversation>
 * //
 * // Everything inside <conversation> is the two parties talking to each other, not to you.
 * // Output only the [MEMORY_OPS] block for that conversation.
 * ```
 *
 * @public
 */
export function buildConversationTranscript(
  messages: ReadonlyArray<TranscriptMessage>,
  options: TranscriptOptions = {},
): string {
  const {
    entityName = 'assistant',
    partnerName = 'user',
    tag = 'conversation',
    withRequest = true,
    blockTag = DEFAULT_MEMORY_OPS_BLOCK_TAG,
  } = options;
  const close = `</${tag}>`;
  const lines: string[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    const content = (m.content ?? '').trim();
    if (!content) continue;
    const label = m.role === 'user' ? partnerName : m.role === 'assistant' ? entityName : m.role;
    lines.push(`${label}: ${content.split(close).join(`<\\/${tag}>`)}`);
  }
  const transcript = `<${tag}>\n${lines.join('\n')}${lines.length ? '\n' : ''}${close}`;
  if (!withRequest) return transcript;
  return `${transcript}\n\nEverything inside <${tag}> is the two parties talking to each other, not to you.\nOutput only the [${blockTag}] block for that conversation.`;
}

/** Why an operation in the reply was not accepted. */
export type ParseDropReason = 'unknown_alias' | 'empty_content' | 'invalid_shape' | 'over_limit';

/** Result of parsing a reply that may carry an operations block. */
export interface ParseMemoryOperationsResult {
  /** Accepted operations, aliases resolved to UUIDs. */
  operations: MemoryOperation[];
  /** Rejected items with the reason. */
  dropped: Array<{ reason: ParseDropReason; raw: unknown }>;
  /** A block was present (even if its JSON was invalid). */
  blockFound: boolean;
  /** The first block's JSON parsed. False when no block or broken JSON. */
  jsonValid: boolean;
  /** Reply text with every block removed, trimmed. */
  textWithoutBlock: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `[TAG]` with an optional markdown fence line right before it. */
function openRegex(tag: string): RegExp {
  const t = escapeRegExp(tag);
  return new RegExp(`(?:\\s*\`\`\`[a-zA-Z]*[^\\S\\n]*\\n)?\\s*\\[${t}\\]`, 'i');
}
/** `[/TAG]` with an optional markdown fence line right after it. */
function closeRegex(tag: string): RegExp {
  const t = escapeRegExp(tag);
  return new RegExp(`\\[\\/${t}\\](?:[^\\S\\n]*\\n?\\s*\`\`\`)?[^\\S\\n]*`, 'gi');
}

/**
 * Finds the block span in a reply: from the first opening tag (fence before it
 * included) to the LAST closing tag (fence after it included). An opening tag
 * with no closing tag is a truncated block and spans to the end of the text.
 *
 * @returns `null` when there is no opening tag
 */
function findBlockSpan(
  text: string,
  tag: string,
): { start: number; end: number; innerFirst: string; innerLast: string; closed: boolean } | null {
  const open = openRegex(tag).exec(text);
  if (!open) return null;
  const start = open.index;
  const innerStart = start + open[0].length;
  const close = closeRegex(tag);
  close.lastIndex = innerStart;
  let first: RegExpExecArray | null = null;
  let last: RegExpExecArray | null = null;
  for (let m = close.exec(text); m; m = close.exec(text)) {
    if (!first) first = m;
    last = m;
  }
  if (!first || !last) {
    const rest = text.slice(innerStart);
    return { start, end: text.length, innerFirst: rest, innerLast: rest, closed: false };
  }
  return {
    start,
    end: last.index + last[0].length,
    innerFirst: text.slice(innerStart, first.index),
    innerLast: text.slice(innerStart, last.index),
    closed: true,
  };
}

/**
 * Removes the operations block from a reply (host display / storage safety).
 * Text without a block is returned unchanged — no trimming, no whitespace
 * normalization. A truncated block (opening tag, no closing tag) is removed
 * to the end of the text.
 *
 * @param text - Reply text
 * @param blockTag - Tag (default {@link DEFAULT_MEMORY_OPS_BLOCK_TAG})
 * @returns Text without the block, trimmed only when a block was removed
 *
 * @public
 */
export function stripMemoryOpsBlock(
  text: string,
  blockTag: string = DEFAULT_MEMORY_OPS_BLOCK_TAG,
): string {
  if (!text) return text;
  const span = findBlockSpan(text, blockTag);
  if (!span) return text;
  return (text.slice(0, span.start) + text.slice(span.end)).replace(/\n{3,}/g, '\n\n').trim();
}

function stripFences(inner: string): string {
  return inner
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

function tryParseOperations(inner: string): unknown[] | null {
  try {
    const parsed = JSON.parse(stripFences(inner)) as { operations?: unknown };
    return Array.isArray(parsed?.operations) ? (parsed.operations as unknown[]) : [];
  } catch {
    return null;
  }
}

/**
 * Parses the operations block out of a reply and resolves aliases to UUIDs.
 *
 * Rules: no block → no operations; broken JSON → no operations (block still
 * stripped); unknown alias → that operation dropped (for create, only the
 * unknown related entries are dropped); blank content → dropped; beyond
 * `maxOperations` → dropped; the block spans from the first opening tag to the
 * last closing tag (a fence line around the tags is removed too); an unclosed
 * block is treated as truncated (stripped, no operations). A raw UUID that
 * belongs to the working set is accepted as if it were an alias; repeated
 * related ids collapse to one. Storage is never consulted.
 *
 * @param text - Full reply text
 * @param workingSet - Aliases the reply may reference
 * @param options - `blockTag`, `maxOperations`
 * @returns Operations, drops, flags, and the reply without blocks
 *
 * @public
 */
export function parseMemoryOperations(
  text: string,
  workingSet: WorkingSet,
  options: { blockTag?: string; maxOperations?: number } = {},
): ParseMemoryOperationsResult {
  const blockTag = options.blockTag ?? DEFAULT_MEMORY_OPS_BLOCK_TAG;
  const maxOperations = options.maxOperations ?? DEFAULT_MAX_OPERATIONS;
  const source = text ?? '';
  const textWithoutBlock = stripMemoryOpsBlock(source, blockTag);
  const span = findBlockSpan(source, blockTag);
  if (!span) {
    return { operations: [], dropped: [], blockFound: false, jsonValid: false, textWithoutBlock };
  }
  if (!span.closed) {
    // Truncated block (e.g. output-token limit): nothing trustworthy to apply.
    return { operations: [], dropped: [], blockFound: true, jsonValid: false, textWithoutBlock };
  }

  // Lazy boundary first (first closing tag); if that JSON fails, retry with the
  // greedy boundary (last closing tag) — a literal "[/TAG]" inside a content
  // string moves the real end of the block.
  const rawOps = tryParseOperations(span.innerFirst) ?? tryParseOperations(span.innerLast);
  if (rawOps === null) {
    return { operations: [], dropped: [], blockFound: true, jsonValid: false, textWithoutBlock };
  }

  const byAlias = new Map<string, string>();
  const idsInSet = new Set<string>();
  for (const e of workingSet.entries) {
    byAlias.set(e.alias, e.memoryId);
    idsInSet.add(e.memoryId);
  }
  const resolve = (ref: unknown): string | null => {
    if (typeof ref !== 'string') return null;
    const v = ref.trim();
    return byAlias.get(v) ?? (idsInSet.has(v) ? v : null);
  };

  const operations: MemoryOperation[] = [];
  const dropped: ParseMemoryOperationsResult['dropped'] = [];
  for (const raw of rawOps) {
    if (operations.length >= maxOperations) {
      dropped.push({ reason: 'over_limit', raw });
      continue;
    }
    if (!raw || typeof raw !== 'object' || !('action' in raw)) {
      dropped.push({ reason: 'invalid_shape', raw });
      continue;
    }
    const o = raw as Record<string, unknown>;
    switch (o.action) {
      case 'create': {
        const content = typeof o.content === 'string' ? o.content.trim() : '';
        if (!content) {
          dropped.push({ reason: 'empty_content', raw });
          break;
        }
        const related = Array.isArray(o.relatedMemoryIds)
          ? [
              ...new Set(
                (o.relatedMemoryIds as unknown[])
                  .map(resolve)
                  .filter((id): id is string => id !== null),
              ),
            ]
          : [];
        operations.push({ action: 'create', content, relatedMemoryIds: related });
        break;
      }
      case 'update': {
        const memoryId = resolve(o.memoryId);
        const content = typeof o.content === 'string' ? o.content.trim() : '';
        if (!memoryId) {
          dropped.push({ reason: 'unknown_alias', raw });
          break;
        }
        if (!content) {
          dropped.push({ reason: 'empty_content', raw });
          break;
        }
        operations.push({ action: 'update', memoryId, content });
        break;
      }
      case 'updateLink': {
        const fromMemoryId = resolve(o.fromMemoryId);
        const toMemoryId = resolve(o.toMemoryId);
        if (o.linkAction !== 'add' && o.linkAction !== 'remove') {
          dropped.push({ reason: 'invalid_shape', raw });
          break;
        }
        if (!fromMemoryId || !toMemoryId) {
          dropped.push({ reason: 'unknown_alias', raw });
          break;
        }
        operations.push({ action: 'updateLink', fromMemoryId, toMemoryId, linkAction: o.linkAction });
        break;
      }
      case 'delete': {
        const memoryId = resolve(o.memoryId);
        if (!memoryId) {
          dropped.push({ reason: 'unknown_alias', raw });
          break;
        }
        operations.push({ action: 'delete', memoryId });
        break;
      }
      default:
        dropped.push({ reason: 'invalid_shape', raw });
    }
  }
  return { operations, dropped, blockFound: true, jsonValid: true, textWithoutBlock };
}
