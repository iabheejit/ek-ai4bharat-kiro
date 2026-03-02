# ADR-001: Adopt a Lightweight Agentic Pipeline Pattern

| Field | Value |
|---|---|
| **Status** | Proposed |
| **Date** | 2026-03-02 |
| **Author** | Code Review |
| **Branch** | `claude/review-agentic-framework-d8K2S` |

---

## 1. Context — Should We Adopt an Agentic Framework?

**Short answer: Yes — but a simple, in-house one. No external framework is needed.**

This document records the findings from a full codebase review and proposes a lightweight pipeline pattern that solves three concrete pain points without introducing new runtime dependencies.

### What the codebase does today

Socrates-EK is a WhatsApp micro-learning platform. It:

1. Delivers AI-generated 3-day courses via WhatsApp (Twilio).
2. Uses AWS Bedrock (Llama 3 70B) for course generation and doubt solving.
3. Manages conversation state via a 16-state machine in `flows/courseFlow.js`.
4. Stores student progress, course content, and logs in MongoDB.

The AI layer lives in `llama.js`. It exposes three functions: `generateCourse()`, `generateForStudent()`, and `solveUserQuery()`. These are the primary targets for improvement.

---

## 2. Three Pain Points That Justify a Pipeline Pattern

### Pain Point 1 — Course Generation: No Retry, No Validation, No Rollback (High Impact)

**File:** `llama.js`, lines 220–259 (`generateForStudent`) and 153–192 (`generateCourse`)

`generateForStudent()` is a monolithic 40-line function with no orchestration:

```
Student lookup
  → build prompt
  → call AWS Bedrock (single attempt, no retry)
  → parseLLMJson() — returns null silently on malformed response
  → CourseContent.deleteMany + insertMany
  → Student.findOneAndUpdate (status, progress, flowStep)
```

Problems:
- **No retry on Bedrock API call.** AWS Bedrock can return transient 5xx errors or throttle at the model level. A single failure means the student's course is never generated. They're stuck at `courseStatus: 'Failed'` and must start over.
- **No schema validation after parsing.** `parseLLMJson()` (`llama.js:59–68`) only does `JSON.parse`. It does not check that all 9 modules exist or that module content meets minimum length. A structurally incomplete course can be silently persisted and delivered.
- **No rollback on partial failure.** If `CourseContent.insertMany` succeeds but `Student.findOneAndUpdate` fails (network blip, timeout), the student ends up with orphaned course content (`courseStatus` still `'Approved'`) and will be processed again on the next `/ping`, creating duplicate records.
- **No step-level logging.** When a generation fails in production, logs only say "Failed to generate course for student". It is impossible to tell which step failed.
- **Duplicate logic.** `generateCourse()` (lines 153–192) and `generateForStudent()` (lines 220–259) share ~60% of their code (prompt building, Bedrock call, JSON parsing, DB writes, status updates). A bug fix in one must be manually applied to the other.

---

### Pain Point 2 — Doubt Solving: Context-Blind LLM Calls (Medium Impact)

**File:** `llama.js`, lines 197–213 (`solveUserQuery`)

```javascript
const systemPrompt = 'You are a doubt solver. Give a short, crisp, and correct answer...';
const responseText = await callBedrock(systemPrompt, prompt);
```

Problems:
- **No course context.** The LLM has no knowledge of what the student is currently studying. A question like "What is a closure?" during a JavaScript module gets the same generic answer as if asked during an Entrepreneurship module. The current module text is available via `CourseContent.findOne()` (a pattern already used in `courseFlow.js:48–51`), but it is never injected.
- **No retry.** A single Bedrock failure causes the student to receive "Sorry, I couldn't process your query right now" with no retry attempt.

---

### Pain Point 3 — Alfred Onboarding: Repeated Boilerplate (Medium Impact, Code Quality)

**File:** `flows/courseFlow.js`, lines 230–318

Five consecutive handlers (`handleAlfredTopic`, `handleAlfredGoal`, `handleAlfredStyle`, `handleAlfredLanguage`, `handleAlfredName`) implement the **same pattern** five times:

```
1. Validate user input (min length, or map text → enum value)
2. If invalid → re-prompt and return
3. If valid → Student.findByIdAndUpdate(field)
4.          → Object.assign(student, {field: value})
5.          → Send next prompt message
6.          → transition(student, nextState, ...)
```

This is ~180 lines of boilerplate for what is fundamentally a sequential input-collection workflow. Adding a new step (e.g. "difficulty level") requires copy-pasting another 30-line handler. The pattern is not self-documenting — a reader must trace 5 separate functions to understand the full Alfred flow.

---

## 3. Decision

Adopt a **lightweight in-process pipeline pattern** implemented as a `Pipeline` class in `utils/pipeline.js`.

This is **not** LangChain, LangGraph, AutoGen, or any external agentic framework. It is a ~80-line Node.js class that provides:

- **Ordered step execution** with a shared `ctx` object
- **Per-step retry** with exponential backoff (delegating to the existing `ErrorHandler.withRetry` in `middleware/errorHandler.js:71–93`)
- **Compensation (rollback)** in reverse step order on failure
- **Structured per-step logging** via the existing `createLogger` in `utils/logger.js`

Three agents are proposed:

| Agent | Replaces | New file |
|---|---|---|
| `CourseGenerationAgent` | `generateForStudent()` + `generateCourse()` in `llama.js` | `agents/courseGenerationAgent.js` |
| `DoubtSolverAgent` | `solveUserQuery()` in `llama.js` | `agents/doubtSolverAgent.js` |
| `InputCollectorAgent` *(optional)* | Alfred handlers in `courseFlow.js` | `agents/inputCollectorAgent.js` |

---

## 4. Proposed Pipeline API

### `utils/pipeline.js`

```javascript
class Pipeline {
  /**
   * @param {string} name                       - Pipeline name (used in logs)
   * @param {Object} [options]
   * @param {number} [options.defaultRetries=0]         - Default retry attempts per step
   * @param {number} [options.defaultRetryDelayMs=2000] - Base delay before first retry (ms)
   * @param {number} [options.retryBackoffFactor=2]     - Exponential multiplier per retry
   */
  constructor(name, options = {}) { ... }

  /**
   * Add a step. Steps execute in order of addition.
   *
   * Step shape:
   * {
   *   name:          string                     // Identifies step in logs and errors
   *   run:           async (ctx) => any         // Main logic; return stored in ctx.results[name]
   *   compensate?:   async (ctx) => void        // Rollback; called in reverse if a later step fails
   *   retries?:      number                     // Override pipeline default
   *   retryDelayMs?: number                     // Override pipeline default
   * }
   */
  addStep(step) { ... }  // chainable

  /**
   * Execute the pipeline.
   *
   * @param  {Object} ctx  - Shared context (mutated in-place by steps)
   * @returns {Object}     - Same ctx on success
   * @throws {PipelineError} - { stepName, cause } on failure (after compensation runs)
   */
  async run(ctx = {}) { ... }
}

class PipelineError extends Error {
  // .stepName  → which step failed
  // .cause     → original error from the step
}
```

**Key design choices:**
- `Pipeline` re-uses `ErrorHandler.withRetry(operation, maxRetries, delayMs, backoffFactor)` (already exists, already production-tested).
- Steps communicate exclusively through the shared `ctx` object. No return values are passed between steps.
- Compensation runs only for steps that **completed** (threw no error). A step that fails does not compensate itself.
- `PipelineError.stepName` lets callers emit targeted alerts or branch on which step failed.

---

## 5. Agent Designs

### 5.1 CourseGenerationAgent (`agents/courseGenerationAgent.js`)

**Context object:**
```javascript
{
  phone:            string,   // Input: student phone
  student:          Object,   // Populated by validateInputs
  rawLLMResponse:   string,   // Populated by callLLM
  courseData:       Object,   // Populated by parseAndValidate
  contentPersisted: boolean,  // Set by persistCourse (used by compensation)
  statusUpdated:    boolean,  // Set by updateStatus (used by compensation)
}
```

**Steps:**

| Step | Retry | Compensate | Description |
|---|---|---|---|
| `validateInputs` | 0 | — | Load student from DB; verify `topic` exists |
| `callLLM` | **3** (4 attempts: 2s→4s→8s) | — | Call `callBedrock()` via Bedrock; store raw text in `ctx` |
| `parseAndValidate` | 0 | — | `parseLLMJson()` + check all 9 modules exist + min content length |
| `persistCourse` | 0 | **Yes** → `CourseContent.deleteMany` | `deleteMany` existing + `insertMany` new records |
| `updateStatus` | 0 | **Yes** → revert to `Failed` | `Student.findOneAndUpdate` with `Content Created` + progress fields |
| `notifyStudent` | 0 | — | Send Twilio template (batch mode only; Alfred mode: calling code handles WA messages) |

**Exported API:**
```javascript
// Single student (Alfred-triggered, replaces generateForStudent)
async function runForStudent(phoneNumber) → boolean

// Batch (admin /ping, replaces generateCourse loop)
async function runBatch(students) → { succeeded: number, failed: number }
```

**How `llama.js` changes:**

```javascript
// Before:
const generateForStudent = async (phoneNumber) => {
  // 40 lines of inline logic
};

// After (drop-in — same signature, same return value):
const generateForStudent = async (phoneNumber) => {
  const { runForStudent } = require('./agents/courseGenerationAgent');
  return runForStudent(phoneNumber);
};
```

No change is needed in `courseFlow.js:349` or `course_status.js` — they call `generateForStudent` and `generateCourse` with the same signatures.

---

### 5.2 DoubtSolverAgent (`agents/doubtSolverAgent.js`)

**Context object:**
```javascript
{
  phone:         string,  // Input: student phone
  query:         string,  // Input: student's question
  student:       Object,  // Populated by fetchContext
  courseContext: string,  // Populated by fetchContext (current module text, up to 600 chars)
  answer:        string,  // Populated by callLLM
}
```

**Steps:**

| Step | Retry | Description |
|---|---|---|
| `fetchContext` | 0 | Load student; load `CourseContent` for current day; extract `modules[nextModule-1].text` |
| `callLLM` | **2** (3 attempts: 2s→4s) | Build context-aware system prompt; call `callBedrock()` |
| `sendResponse` | 0 | `WA.sendText(ctx.answer, ctx.phone)` |

**Context-aware system prompt (the key improvement):**

```
You are a doubt solver for an online micro-course platform.
Give a short, crisp, and correct answer to the student's question.
If the query is not genuine or malicious, say it violates Ekatra guidelines.

Current module content:
"""
[up to 600 chars of the student's current module]
"""

Use the above content to inform your answer if the question is related to it.
```

When no course content is available (e.g. student not yet in a module), the context section is omitted and the prompt falls back to the original generic form.

**How `llama.js` changes:**

```javascript
// After (drop-in — same signature):
const solveUserQuery = async (prompt, waId) => {
  const { run } = require('./agents/doubtSolverAgent');
  return run(prompt, waId);
};
```

No change needed in `courseFlow.js:457`.

---

### 5.3 InputCollectorAgent — Optional (`agents/inputCollectorAgent.js`)

> **Recommendation:** Implement this only if the team plans to add new Alfred input steps in the future. The current Alfred handlers work correctly; this is a code quality improvement, not a functional fix.

The five Alfred handlers (`handleAlfredTopic`, `handleAlfredGoal`, `handleAlfredStyle`, `handleAlfredLanguage`, `handleAlfredName`) follow an identical pattern. They can be driven by a config array:

```javascript
const ALFRED_STEPS = [
  {
    state:        'alfred_topic',
    field:        'topic',
    validate:     (text) => text.length >= 2 ? text : null,
    onInvalid:    async (student) => WA.sendText('Please type a topic...', student.phone),
    onValid:      async (student, value) => WA.sendText('Great topic! Now...', student.phone),
    nextState:    'alfred_goal',
    triggerLabel: 'text:topic',
  },
  // ... 3 more steps for goal, style, language
];

async function handleAlfredStep(stepDef, student, event, transitionFn) {
  const normalized = stepDef.validate((event.text || '').trim().toLowerCase());
  if (!normalized) { await stepDef.onInvalid(student); return; }
  await Student.findByIdAndUpdate(student._id, { [stepDef.field]: normalized });
  student[stepDef.field] = normalized;
  await stepDef.onValid(student, normalized);
  await transitionFn(student, stepDef.nextState, stepDef.triggerLabel, event.text);
}
```

`handleAlfredName` is **excluded** from this pattern — it triggers course generation and has unique exit logic that should stay explicit.

To add a new Alfred step (e.g. "preferred difficulty"), the team would add a single entry to `ALFRED_STEPS` plus update the Student schema — no handler boilerplate needed.

---

## 6. Migration Path

### Files created (new)

```
utils/pipeline.js                    ← Pipeline base class (~80 lines)
agents/courseGenerationAgent.js      ← CourseGenerationAgent (~120 lines)
agents/doubtSolverAgent.js           ← DoubtSolverAgent (~80 lines)
agents/inputCollectorAgent.js        ← (optional) InputCollectorAgent config (~100 lines)
```

### Files modified (surgical)

| File | Change | Risk |
|---|---|---|
| `llama.js` | Add `callBedrock`, `buildCoursePrompt`, `parseLLMJson`, `updateCourseRecords` to `module.exports`; delegate `generateForStudent`, `generateCourse`, `solveUserQuery` to agents via lazy `require()` | Low — same export signatures |
| `flows/courseFlow.js` | *(optional)* Replace 4 Alfred handler bodies with `handleAlfredStep` calls | Low — `handleAlfredName` stays untouched |

### Files unchanged

`server.js`, `course_status.js`, `twilio_whatsapp.js`, all models, all other middleware/utils — zero changes needed.

### Circular dependency prevention

Agents import raw helpers from `llama.js` (`callBedrock`, `buildCoursePrompt`, etc.). `llama.js` imports agents inside function bodies using `require()` (lazy require). This is the same pattern already used in the codebase (`course_status.js` lazy-requires `llama.js`).

```javascript
// In llama.js — lazy require avoids circular dependency:
const generateForStudent = async (phoneNumber) => {
  const { runForStudent } = require('./agents/courseGenerationAgent');
  return runForStudent(phoneNumber);
};
```

---

## 7. What NOT to Do

| Rejected approach | Reason |
|---|---|
| **LangChain / LangGraph** | Heavy dependency (~150+ transitive packages), designed for Python-first workflows, adds significant bundle size and maintenance surface for 3 targeted use cases |
| **Redis + BullMQ** | Requires new infrastructure (Redis service), adds operational complexity; the current scale (single ECS task, sequential course generation) does not need distributed queuing |
| **Full state machine rewrite** | `courseFlow.js` is the most battle-tested file in the codebase (16 states, 850 lines). Rewriting it in a framework DSL would introduce regression risk far outweighing any benefit |
| **`courseStatus: 'Generating'` new enum value** | Would require a schema migration and `Student` enum update. The `validateInputs` step runs in milliseconds before the first LLM call — the benefit is not worth the migration cost |
| **Parallel Bedrock calls in batch generation** | AWS Bedrock has per-account throughput quotas. Sequential processing is safer and already fast enough for the expected student volume |

---

## 8. Consequences

### What improves

| Area | Before | After |
|---|---|---|
| Bedrock transient failures during generation | Student stuck at `courseStatus: Failed`, requires admin restart | 3 retry attempts with 2s/4s/8s backoff; only marks Failed after all retries exhausted |
| Partial DB write on generation failure | Orphaned `CourseContent` docs possible | Compensation step deletes orphan records |
| LLM response validation | Silent null from `parseLLMJson` | Explicit validation: all 9 modules checked, minimum content length enforced |
| Doubt answer quality | Generic answer with no course context | Module text injected into system prompt; answers are topic-aware |
| Production debugging | "Failed to generate course" with no step context | Per-step logs: "step [callLLM] failed after 3 retries with error: ThrottlingException" |
| Code duplication | `generateCourse` + `generateForStudent` share 60% logic | Single pipeline definition used by both; bug fixes apply once |

### What stays the same

- All public API signatures (`generateForStudent`, `generateCourse`, `solveUserQuery`)
- The state machine in `courseFlow.js` (untouched except optional Alfred refactor)
- WhatsApp message content and timing
- MongoDB schemas
- Environment variables
- Docker/ECS deployment

### New complexity introduced

- One new abstraction (`Pipeline`) that developers must understand
- Compensation logic to maintain (simple: delete + status revert)
- The `agents/` directory is a new convention in this codebase

---

## 9. Testing Approach

### Unit tests (no external services)

**`Pipeline` class — `tests/pipeline.test.js`:**

```javascript
// Test 1: Steps execute in order, ctx is shared
test('executes steps in order and shares ctx', ...)

// Test 2: Compensation runs in reverse over completed steps only
test('compensates in reverse order on failure', ...)

// Test 3: Retry logic: step succeeds on 3rd attempt
test('retries a step before failing', ...)

// Test 4: PipelineError carries stepName and cause
test('throws PipelineError with stepName when retries exhausted', ...)
```

**`CourseGenerationAgent` — `tests/courseGenerationAgent.test.js`:**

Mock `Student`, `CourseContent`, `llama`, and `twilio_whatsapp`. Test:
- Returns `true` when all steps succeed
- Returns `false` when LLM returns invalid JSON (parseAndValidate throws)
- Returns `false` when student not found
- Deletes orphan content (compensation) when `updateStatus` fails

**`DoubtSolverAgent` — `tests/doubtSolverAgent.test.js`:**

Mock `Student`, `CourseContent`, `llama`, and `twilio_whatsapp`. Test:
- Module text is present in the `callBedrock` system prompt when course content exists
- Falls back to generic prompt when no content is found
- Sends fallback message when Bedrock fails after all retries

### Integration test (manual, dev environment)

1. Seed a student with `courseStatus: 'Approved'` and valid fields.
2. Hit `GET /ping` — confirm `courseStatus` → `Content Created` and 3 `CourseContent` docs in MongoDB.
3. Temporarily break Bedrock endpoint — confirm `courseStatus` → `Failed` and no orphan `CourseContent` docs.
4. With a student in `doubt_mode`, send a question — confirm logs show module text injected into prompt.
5. Run full Alfred → course → module → doubt flow end-to-end to confirm no regressions.

---

## 10. Implementation Order

```
Step 1 → utils/pipeline.js                           (no dependencies)
Step 2 → llama.js: add raw helper exports             (enables agent imports)
Step 3 → agents/courseGenerationAgent.js              (imports pipeline + llama helpers)
Step 4 → agents/doubtSolverAgent.js                   (imports pipeline + llama helpers)
Step 5 → llama.js: delegate to agents via lazy require (completes the wiring)
Step 6 → agents/inputCollectorAgent.js                (optional, standalone)
Step 7 → courseFlow.js: use InputCollectorAgent        (optional, depends on step 6)
Step 8 → Write unit tests
Step 9 → Manual integration test
```

Steps 2 and 5 must not be merged — do step 2 (exports only) before step 3/4 (agent creation), then step 5 (delegation) last to avoid circular import issues during development.
