/**
 * Phase 35 Plan 35-03 — /profile Telegram command (SURF-03, SURF-04, SURF-05).
 *
 * HARD CO-LOCATION #M10-5: the handler, the pure formatter function, AND the
 * golden-output inline-snapshot test all land in the same plan. The three
 * artifacts together form the M010-07 regression gate that prevents the M009
 * first-Sunday weekly_review UX failure class (third-person framing, leaked
 * internal field names, JSON-dump aesthetic).
 *
 * Outputs:
 *   - 5 ctx.reply calls per /profile invocation (D-18): one per dimension in
 *     declaration order (jurisdictional → capital → health → family) plus a
 *     final M011 psychological-profile placeholder.
 *   - Plain text only (D-17 + SURF-05) — no parse_mode argument anywhere.
 *     Greg's own Pensieve content occasionally contains `*` or `_` characters;
 *     without parse_mode those render verbatim, which is correct.
 *   - EN / FR / RU localized via getLastUserLanguage(chatId.toString()) (D-19).
 *     This handler is USER-INITIATED so the in-memory session-language cache
 *     is always populated — no DB-backed fallback needed (M009 first-Sunday
 *     lesson is about CRON-context handlers, which /profile is not).
 *
 * Framing (D-20 + M010-07 mitigation):
 *   - Second person, present tense: "You're currently in...", "Your residency
 *     status:", "Your FI target:". NEVER "Greg's...", "His...", or any
 *     third-person framing. The golden-snapshot test in profile.golden.test.ts
 *     is the regression detector — any third-person leak fails the snapshot.
 *
 * Zero-confidence / null UX (D-21):
 *   - When a dimension is null or has confidence === 0, the formatter returns
 *     an actionable progress indicator ("Chris needs more entries about your
 *     {dimensionHint} before populating this profile.") — NOT a JSON dump,
 *     NOT a bare "insufficient data" string. Greg should know what to write
 *     more about.
 *
 * Staleness (D-22):
 *   - When a dimension's lastUpdated is > 21 days ago, the formatter appends
 *     a localized staleness note ("Note: profile data from YYYY-MM-DD — may
 *     not reflect current situation."). Same 21-day threshold as the
 *     prompt-side staleness gate in formatProfilesForPrompt (D-10), but the
 *     user-facing wording is different (Plan 35-02 SUMMARY.md note).
 *
 * What this module does NOT do:
 *   - Does NOT edit profiles (ANTI-6): /profile is read-only; no
 *     /profile edit jurisdictional ... sub-command parsing. ctx.message.text
 *     is ignored beyond the command trigger.
 *   - Does NOT use Markdown parse_mode (D-17).
 *   - Does NOT call buildSystemPrompt or formatProfilesForPrompt (Plan 35-02
 *     handles prompt-side injection; this module is the user-facing surface).
 *   - Does NOT use getLastUserLanguageFromDb (that's for cron-context only).
 *
 * Threat model (35-03-PLAN.md <threat_model>):
 *   - T-35-03-V7-01 mitigated by golden-snapshot test (M010-07).
 *   - T-35-03-V7-02 mitigated by plain-text-only invariant (no parse_mode).
 *   - T-35-03-V11-01 mitigated by zero sub-argument parsing surface.
 */

import type { Context } from 'grammy';
import {
  getOperationalProfiles,
  type ProfileRow,
  type Dimension,
} from '../../memory/profiles.js';
import type {
  JurisdictionalProfileData,
  CapitalProfileData,
  HealthProfileData,
  FamilyProfileData,
} from '../../memory/profiles/schemas.js';
import { getLastUserLanguage } from '../../chris/language.js';
import { logger } from '../../utils/logger.js';

// ── Lang narrowing ──────────────────────────────────────────────────────────
//
// Exported so the golden-snapshot test can pass it as a parameter. langOf is
// the same shape summary.ts:42-47 uses — getLastUserLanguage returns string |
// null and we narrow it to the 3-element union here.

export type Lang = 'English' | 'French' | 'Russian';

function langOf(raw: string | null): Lang {
  if (raw === 'French' || raw === 'Russian' || raw === 'English') return raw;
  return 'English';
}

// ── Staleness threshold ─────────────────────────────────────────────────────
//
// 21 days matches the prompt-side STALENESS_MS in src/memory/profiles.ts
// (Plan 35-02 D-10). The user-facing rendering is different (localized note
// appended after the dimension body) but the threshold MUST agree — D-22.

const STALENESS_MS = 21 * 86_400_000;

// ── Localized message strings ───────────────────────────────────────────────
//
// Per D-19 + 35-PATTERNS.md MSG-map shape (summary.ts:56-82 precedent).
// All strings are second-person framed (D-20). The "M011" marker is verbatim
// across all 3 languages per CONTEXT.md plan_hints.
//
// Per-dimension hint phrases ("your location", "your finances", etc.) feed
// into the insufficientData template so the actionable progress indicator
// tells Greg WHICH dimension needs more entries (D-21).

const MSG = {
  sectionTitle: {
    jurisdictional: {
      English: 'Jurisdictional Profile',
      French: 'Profil juridictionnel',
      Russian: 'Юрисдикционный профиль',
    },
    capital: {
      English: 'Capital Profile',
      French: 'Profil patrimonial',
      Russian: 'Финансовый профиль',
    },
    health: {
      English: 'Health Profile',
      French: 'Profil de santé',
      Russian: 'Профиль здоровья',
    },
    family: {
      English: 'Family Profile',
      French: 'Profil familial',
      Russian: 'Семейный профиль',
    },
  },
  confidence: {
    English: 'confidence',
    French: 'confiance',
    Russian: 'уверенность',
  },
  dimensionHint: {
    jurisdictional: {
      English: 'location and tax situation',
      French: 'situation géographique et fiscale',
      Russian: 'местоположении и налоговой ситуации',
    },
    capital: {
      English: 'finances',
      French: 'finances',
      Russian: 'финансах',
    },
    health: {
      English: 'wellbeing',
      French: 'bien-être',
      Russian: 'самочувствии',
    },
    family: {
      English: 'relationships',
      French: 'relations',
      Russian: 'отношениях',
    },
  },
  insufficientData: {
    English: (dim: Dimension): string =>
      `Chris needs more entries about your ${MSG.dimensionHint[dim].English} before populating this profile.`,
    French: (dim: Dimension): string =>
      `Chris a besoin de plus d'entrées sur ta ${MSG.dimensionHint[dim].French} avant de remplir ce profil.`,
    Russian: (dim: Dimension): string =>
      `Крису нужно больше записей о твоих ${MSG.dimensionHint[dim].Russian}, прежде чем заполнить этот профиль.`,
  },
  staleNote: {
    // Staleness threshold: 21 days (see STALENESS_MS constant above; matches
    // D-10 / D-22 + the prompt-side gate in src/memory/profiles.ts).
    English: (date: string): string =>
      `Note: profile data from ${date} — may not reflect current situation.`,
    French: (date: string): string =>
      `Note : données du profil du ${date} — ne reflète peut-être pas la situation actuelle.`,
    Russian: (date: string): string =>
      `Примечание: данные профиля от ${date} — могут не отражать текущую ситуацию.`,
  },
  m011Placeholder: {
    English: 'Psychological profile: not yet available — see M011.',
    French: 'Profil psychologique : pas encore disponible — voir M011.',
    Russian: 'Психологический профиль: пока недоступен — см. M011.',
  },
  genericError: {
    English: 'I ran into trouble reading your profiles. Try again in a moment.',
    French: "J'ai eu un souci en récupérant tes profils. Réessaie dans un instant.",
    Russian: 'Возникла проблема при чтении твоих профилей. Попробуй через мгновение.',
  },
  fields: {
    jurisdictional: {
      English: {
        youAreIn: (loc: string, country: string): string =>
          `You're currently in ${loc}, ${country}.`,
        youAreInCountry: (country: string): string =>
          `You're currently in ${country}.`,
        yourTaxResidency: (tax: string): string => `Your tax residency: ${tax}.`,
        yourResidencyStatuses: 'Your residency statuses:',
        yourNextMove: (dest: string, date: string): string =>
          `Your next planned move: ${dest} (from ${date}).`,
        yourNextMoveDestOnly: (dest: string): string =>
          `Your next planned move: ${dest}.`,
        yourCitizenships: (list: string): string =>
          `Your passport citizenships: ${list}.`,
        yourLegalEntities: (list: string): string =>
          `Your active legal entities: ${list}.`,
      },
      French: {
        youAreIn: (loc: string, country: string): string =>
          `Tu es actuellement à ${loc}, ${country}.`,
        youAreInCountry: (country: string): string =>
          `Tu es actuellement en ${country}.`,
        yourTaxResidency: (tax: string): string => `Ta résidence fiscale : ${tax}.`,
        yourResidencyStatuses: 'Tes statuts de résidence :',
        yourNextMove: (dest: string, date: string): string =>
          `Ton prochain déménagement prévu : ${dest} (à partir du ${date}).`,
        yourNextMoveDestOnly: (dest: string): string =>
          `Ton prochain déménagement prévu : ${dest}.`,
        yourCitizenships: (list: string): string =>
          `Tes nationalités : ${list}.`,
        yourLegalEntities: (list: string): string =>
          `Tes entités juridiques actives : ${list}.`,
      },
      Russian: {
        youAreIn: (loc: string, country: string): string =>
          `Ты сейчас в ${loc}, ${country}.`,
        youAreInCountry: (country: string): string =>
          `Ты сейчас в ${country}.`,
        yourTaxResidency: (tax: string): string => `Твоё налоговое резидентство: ${tax}.`,
        yourResidencyStatuses: 'Твои статусы резидентства:',
        yourNextMove: (dest: string, date: string): string =>
          `Твой следующий запланированный переезд: ${dest} (с ${date}).`,
        yourNextMoveDestOnly: (dest: string): string =>
          `Твой следующий запланированный переезд: ${dest}.`,
        yourCitizenships: (list: string): string =>
          `Твои гражданства: ${list}.`,
        yourLegalEntities: (list: string): string =>
          `Твои активные юридические лица: ${list}.`,
      },
    },
    capital: {
      English: {
        yourFIPhase: (phase: string): string => `Your FI phase: ${phase}.`,
        yourFITarget: (target: string): string => `Your FI target: ${target}.`,
        yourNetWorth: (nw: string): string => `Your estimated net worth: ${nw}.`,
        yourRunway: (months: number): string => `Your runway: ${months} months.`,
        yourNextSequencing: (next: string): string =>
          `Your next sequencing decision: ${next}.`,
        yourTaxOptimization: (status: string): string =>
          `Your tax-optimization status: ${status}.`,
        yourIncomeSources: 'Your income sources:',
        yourLegalEntities: (list: string): string =>
          `Your active legal entities: ${list}.`,
        yourMajorAllocations: 'Your major allocation decisions:',
      },
      French: {
        yourFIPhase: (phase: string): string => `Ta phase FI : ${phase}.`,
        yourFITarget: (target: string): string => `Ton objectif FI : ${target}.`,
        yourNetWorth: (nw: string): string => `Ton patrimoine net estimé : ${nw}.`,
        yourRunway: (months: number): string => `Ton runway : ${months} mois.`,
        yourNextSequencing: (next: string): string =>
          `Ta prochaine décision de séquencement : ${next}.`,
        yourTaxOptimization: (status: string): string =>
          `Ton statut d'optimisation fiscale : ${status}.`,
        yourIncomeSources: 'Tes sources de revenus :',
        yourLegalEntities: (list: string): string =>
          `Tes entités juridiques actives : ${list}.`,
        yourMajorAllocations: 'Tes décisions d\'allocation majeures :',
      },
      Russian: {
        yourFIPhase: (phase: string): string => `Твоя фаза FI: ${phase}.`,
        yourFITarget: (target: string): string => `Твоя цель FI: ${target}.`,
        yourNetWorth: (nw: string): string => `Твоё оценочное чистое состояние: ${nw}.`,
        yourRunway: (months: number): string => `Твой запас: ${months} мес.`,
        yourNextSequencing: (next: string): string =>
          `Твоё следующее решение о последовательности: ${next}.`,
        yourTaxOptimization: (status: string): string =>
          `Твой статус налоговой оптимизации: ${status}.`,
        yourIncomeSources: 'Твои источники дохода:',
        yourLegalEntities: (list: string): string =>
          `Твои активные юридические лица: ${list}.`,
        yourMajorAllocations: 'Твои крупные решения о распределении:',
      },
    },
    health: {
      English: {
        yourCaseFile: (narrative: string): string =>
          `Your case-file narrative: ${narrative}`,
        yourOpenHypotheses: 'Your open hypotheses:',
        yourPendingTests: 'Your pending tests:',
        yourActiveTreatments: 'Your active treatments:',
        yourRecentResolved: 'Your recently resolved items:',
        yourWellbeingTrend: 'Your 30-day wellbeing trend:',
      },
      French: {
        yourCaseFile: (narrative: string): string =>
          `Ton dossier clinique : ${narrative}`,
        yourOpenHypotheses: 'Tes hypothèses ouvertes :',
        yourPendingTests: 'Tes examens en attente :',
        yourActiveTreatments: 'Tes traitements actifs :',
        yourRecentResolved: 'Tes points récemment résolus :',
        yourWellbeingTrend: 'Ta tendance bien-être sur 30 jours :',
      },
      Russian: {
        yourCaseFile: (narrative: string): string =>
          `Твоя клиническая история: ${narrative}`,
        yourOpenHypotheses: 'Твои открытые гипотезы:',
        yourPendingTests: 'Твои ожидающие тесты:',
        yourActiveTreatments: 'Твои активные методы лечения:',
        yourRecentResolved: 'Твои недавно решённые вопросы:',
        yourWellbeingTrend: 'Твой 30-дневный тренд самочувствия:',
      },
    },
    family: {
      English: {
        yourRelationshipStatus: (status: string): string =>
          `Your relationship status: ${status}.`,
        yourChildrenPlans: (plans: string): string =>
          `Your children plans: ${plans}.`,
        yourDatingContext: (context: string): string =>
          `Your active dating context: ${context}.`,
        yourParentCare: 'Your parent-care responsibilities:',
        yourPartnershipCriteria: 'Your active partnership criteria:',
        yourConstraints: 'Your constraints:',
        yourMilestones: 'Your milestones:',
      },
      French: {
        yourRelationshipStatus: (status: string): string =>
          `Ton statut relationnel : ${status}.`,
        yourChildrenPlans: (plans: string): string =>
          `Tes projets d'enfants : ${plans}.`,
        yourDatingContext: (context: string): string =>
          `Ton contexte de rencontre actif : ${context}.`,
        yourParentCare: 'Tes responsabilités envers tes parents :',
        yourPartnershipCriteria: 'Tes critères de partenariat actifs :',
        yourConstraints: 'Tes contraintes :',
        yourMilestones: 'Tes étapes :',
      },
      Russian: {
        yourRelationshipStatus: (status: string): string =>
          `Твой статус отношений: ${status}.`,
        yourChildrenPlans: (plans: string): string =>
          `Твои планы насчёт детей: ${plans}.`,
        yourDatingContext: (context: string): string =>
          `Твой активный контекст знакомств: ${context}.`,
        yourParentCare: 'Твои обязанности по уходу за родителями:',
        yourPartnershipCriteria: 'Твои активные критерии для партнёрства:',
        yourConstraints: 'Твои ограничения:',
        yourMilestones: 'Твои вехи:',
      },
    },
  },
} as const;

// ── Pure formatter (Task 2 fills in the body) ───────────────────────────────

export function formatProfileForDisplay(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  dimension: Dimension,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  profile: ProfileRow<unknown> | null,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  lang: Lang,
): string {
  throw new Error('TODO: Task 2');
}

// ── Handler (Task 3 fills in the body) ──────────────────────────────────────

export async function handleProfileCommand(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ctx: Context,
): Promise<void> {
  // Silence unused-import warnings until Task 3 fills in the body.
  void getOperationalProfiles;
  void getLastUserLanguage;
  void langOf;
  void logger;
  void STALENESS_MS;
  void MSG;
  throw new Error('TODO: Task 3');
}

// Type-only consumers — referenced by formatProfileForDisplay in Task 2 once
// the switch-case body lands. Re-exported via the import block at the top so
// the file's surface is documented; suppress unused warnings in Task 1's
// skeleton form via `void` rebinds. Removed in Task 2 when the casts land.
type _Unused =
  | JurisdictionalProfileData
  | CapitalProfileData
  | HealthProfileData
  | FamilyProfileData;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _unusedSentinel: _Unused | undefined = undefined;
