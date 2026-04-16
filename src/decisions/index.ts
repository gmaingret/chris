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

export { getActiveDecisionCapture } from './capture-state.js';

export { detectTriggerPhrase, detectTriggerPhraseDetailed, classifyStakes } from './triggers.js';
export type { TriggerMatch, StakesTier } from './triggers.js';
