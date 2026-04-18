/**
 * Barrel re-exports for `src/decisions/*`.
 *
 * Single import surface for Phases 14-18 consumers:
 *   import { transitionDecision, OptimisticConcurrencyError } from '../decisions/index.js';
 *
 * Keeps downstream imports stable if we rearrange the internal module layout.
 */

export { transitionDecision, LEGAL_TRANSITIONS } from './lifecycle.js';
export type { ActorKind, TransitionPayload } from './lifecycle.js';

export {
  InvalidTransitionError,
  OptimisticConcurrencyError,
  DecisionNotFoundError,
} from './errors.js';
export type { DecisionStatusLiteral } from './errors.js';

export { regenerateDecisionFromEvents } from './regenerate.js';

export {
  getActiveDecisionCapture,
  createCaptureDraft,
  updateCaptureDraft,
  clearCapture,
  isAbortPhrase,
  upsertAwaitingResolution,
  updateToAwaitingPostmortem,
} from './capture-state.js';
export type { CaptureDraft, DecisionCaptureStage } from './capture-state.js';

export { detectTriggerPhrase, detectTriggerPhraseDetailed, classifyStakes } from './triggers.js';
export type { TriggerMatch, StakesTier } from './triggers.js';

export { addSuppression, isSuppressed, listSuppressions } from './suppressions.js';

export {
  parseResolveBy,
  daysFromNow,
  matchClarifierReply,
  buildResolveByClarifierQuestion,
  buildResolveByDefaultAnnouncement,
  CLARIFIER_LADDER_DAYS,
} from './resolve-by.js';
export type { ClarifierChoice } from './resolve-by.js';

export {
  validateVagueness,
  buildVaguePushback,
  HEDGE_WORDS,
} from './vague-validator.js';
export type { VaguenessVerdict, VaguenessResult, VaguenessInput } from './vague-validator.js';

export { handleCapture, openCapture } from './capture.js';

export { handleResolution, handlePostmortem, classifyOutcome } from './resolution.js';
