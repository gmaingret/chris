/**
 * Phase 35 Plan 35-03 — /profile Telegram command (SURF-03, SURF-04, SURF-05).
 *
 * HARD CO-LOCATION #M10-5: the handler, the pure formatter function, AND the
 * golden-output inline-snapshot test all land in the same plan. The three
 * artifacts together form the M010-07 regression gate that prevents the M009
 * first-Sunday weekly_review UX failure class (third-person framing, leaked
 * internal field names, JSON-dump aesthetic).
 *
 * Outputs (post-Phase 39 PSURF-04):
 *   - 7 ctx.reply calls per /profile invocation (D-18 operational + D-17 psych):
 *     4 operational dimensions in declaration order
 *     (jurisdictional → capital → health → family) followed by 3 psychological
 *     sections (hexaco → schwartz → attachment).
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
  getPsychologicalProfiles, // Phase 39 PSURF-04
  type ProfileRow,
  type Dimension,
  type PsychologicalProfileType, // Phase 39 PSURF-04
} from '../../memory/profiles.js';
import type {
  JurisdictionalProfileData,
  CapitalProfileData,
  HealthProfileData,
  FamilyProfileData,
} from '../../memory/profiles/schemas.js';
// Phase 39 PSURF-05 — psych data shapes for the pure formatter signature
import type {
  HexacoProfileData,
  SchwartzProfileData,
  AttachmentProfileData,
} from '../../memory/profiles/psychological-schemas.js';
import { getLastUserLanguage, langOf, type Lang } from '../../chris/language.js';
import { qualifierFor } from '../../chris/locale/strings.js';
import { logger } from '../../utils/logger.js';

// ── Lang narrowing ──────────────────────────────────────────────────────────
//
// IN-04: `langOf` + `Lang` are imported from src/chris/language.ts (the
// shared module co-located with `getLastUserLanguage`). The type is
// re-exported below so the golden-snapshot test in profile.golden.test.ts
// can `import { type Lang } from '../profile.js'` without reaching into
// `src/chris/`. summary.ts consumes the same shared helpers — see #IN-04.

export type { Lang };

// ── Staleness threshold ─────────────────────────────────────────────────────
//
// 21 days matches the prompt-side STALENESS_MS in src/memory/profiles.ts
// (Plan 35-02 D-10). The user-facing rendering is different (localized note
// appended after the dimension body) but the threshold MUST agree — D-22.

const STALENESS_MS = 21 * 86_400_000;

// IN-01: BCP-47 locale tags for the staleness-note date. Mirrors the
// `DATE_LOCALES` table in src/chris/personality.ts (`formatContradictionNotice`)
// so the two user-facing date renderings stay consistent. EN gets `en-US`,
// FR gets `fr-FR`, RU gets `ru-RU`; output is the long-form locale date
// ("April 1, 2026" / "1 avril 2026" / "1 апреля 2026 г.") rather than ISO.
const DATE_LOCALES: Record<Lang, string> = {
  English: 'en-US',
  French: 'fr-FR',
  Russian: 'ru-RU',
};

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
  // Phase 39 PSURF-04 — psychological-profile localization keys per D-19 + D-20
  // (machine-translate-quality FR + RU; reviewed at /gsd-verify-work; v2.6.1
  // polish pass replaces with proper translations without snapshot churn).
  //
  // The 4-branch state model per CONTEXT.md D-19:
  //   - attachment ALWAYS renders `notYetActive` (D028 deferred to v2.6.1)
  //   - null OR never-fired (lastUpdated.getTime() === 0) → `neverFired`
  //   - confidence === 0 → `insufficientData(N)` where N = max(0, 5000 - wordCountAtLastRun)
  //   - populated → sectionTitle + per-dim score lines (formatter handles)
  psychologicalSections: {
    hexaco: {
      sectionTitle: {
        English: 'HEXACO Personality',
        French: 'Personnalité HEXACO',
        Russian: 'Личность HEXACO',
      },
      insufficientData: {
        English: (n: number): string =>
          `HEXACO: insufficient data — need ${n} more words.`,
        French: (n: number): string =>
          `HEXACO : données insuffisantes — il faut ${n} mots de plus.`,
        Russian: (n: number): string =>
          `HEXACO: недостаточно данных — нужно ещё ${n} слов.`,
      },
      neverFired: {
        English:
          'HEXACO: not yet inferred (first profile inference runs 1st of month, 09:00 Paris).',
        French:
          'HEXACO : pas encore inféré (première inférence le 1er du mois, 09h00 Paris).',
        Russian:
          'HEXACO: ещё не выведено (первая инференция 1-го числа месяца, 09:00 Париж).',
      },
    },
    schwartz: {
      sectionTitle: {
        English: 'Schwartz Values',
        French: 'Valeurs Schwartz',
        Russian: 'Ценности Шварца',
      },
      insufficientData: {
        English: (n: number): string =>
          `Schwartz: insufficient data — need ${n} more words.`,
        French: (n: number): string =>
          `Schwartz : données insuffisantes — il faut ${n} mots de plus.`,
        Russian: (n: number): string =>
          `Шварц: недостаточно данных — нужно ещё ${n} слов.`,
      },
      neverFired: {
        English:
          'Schwartz: not yet inferred (first profile inference runs 1st of month, 09:00 Paris).',
        French:
          'Schwartz : pas encore inféré (première inférence le 1er du mois, 09h00 Paris).',
        Russian:
          'Шварц: ещё не выведено (первая инференция 1-го числа месяца, 09:00 Париж).',
      },
    },
    attachment: {
      // D-19: ALWAYS rendered in M011 regardless of activated flag (D028
      // deferred to v2.6.1). The formatter early-returns this string for
      // profileType === 'attachment' regardless of fixture state.
      notYetActive: {
        English:
          'Attachment: not yet active (gated on D028 activation trigger — 2,000 words relational speech over 60 days).',
        French:
          "Attachement : pas encore actif (déclencheur D028 — 2 000 mots de parole relationnelle sur 60 jours).",
        Russian:
          'Привязанность: пока не активна (триггер D028 — 2 000 слов реляционной речи за 60 дней).',
      },
    },
  },
  genericError: {
    English: 'I ran into trouble reading your profiles. Try again in a moment.',
    French: "J'ai eu un souci en récupérant tes profils. Réessaie dans un instant.",
    Russian: 'Возникла проблема при чтении твоих профилей. Попробуй через мгновение.',
  },
  // Phase 46 L10N-01 — per-locale score-line template for HEXACO/Schwartz
  // populated-branch rendering. Resolves the 46-PLAN-CHECK warning about the
  // prior mixed-decimal "4.2 / 5,0" output by aligning the slug separator
  // with the value separator on a per-locale basis:
  //   - English keeps dot decimals + "/ 5.0" via toFixed(1) — BYTE-IDENTICAL
  //     to the prior implementation so the EN snapshot survives unchanged
  //     (Phase 39 D-25 test-stability lock).
  //   - French + Russian use comma decimals + "/ 5,0" by replacing the dot
  //     produced by toFixed(1) with a comma. Avoids toLocaleString rounding
  //     differences (e.g. 0.35 → toFixed=0.3 vs toLocaleString=0.4) that
  //     would force EN snapshot regen.
  // The "confidence" token is the same word used in MSG.confidence above so
  // the score line stays in lockstep with /profile's other confidence label.
  scoreLine: {
    English: (label: string, score: number, conf: number, qual: string): string =>
      `${label}: ${score.toFixed(1)} / 5.0 (confidence ${conf.toFixed(1)} — ${qual})`,
    French: (label: string, score: number, conf: number, qual: string): string =>
      `${label} : ${score.toFixed(1).replace('.', ',')} / 5,0 (confiance ${conf.toFixed(1).replace('.', ',')} — ${qual})`,
    Russian: (label: string, score: number, conf: number, qual: string): string =>
      `${label}: ${score.toFixed(1).replace('.', ',')} / 5,0 (уверенность ${conf.toFixed(1).replace('.', ',')} — ${qual})`,
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
        // WR-02: localized "since" connective — round-trips with the parent
        // language so FR/RU lines don't suddenly switch to English mid-sentence.
        residencySince: (date: string): string => ` (since ${date})`,
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
        residencySince: (date: string): string => ` (depuis ${date})`,
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
        residencySince: (date: string): string => ` (с ${date})`,
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
        // WR-02: localized "since" connective + wellbeing axis labels — these
        // round-trip with the parent language so FR/RU output doesn't suddenly
        // switch to English mid-line ("Tes traitements actifs : ... since ..." was
        // the M010-07-adjacent regression class). The `since` word here is the
        // same connective used in jurisdictional.residencySince but spelled-out
        // in a "$NAME since $DATE" shape instead of " (since $DATE)".
        since: (date: string): string => `since ${date}`,
        wellbeingLabels: { energy: 'energy', mood: 'mood', anxiety: 'anxiety' },
      },
      French: {
        yourCaseFile: (narrative: string): string =>
          `Ton dossier clinique : ${narrative}`,
        yourOpenHypotheses: 'Tes hypothèses ouvertes :',
        yourPendingTests: 'Tes examens en attente :',
        yourActiveTreatments: 'Tes traitements actifs :',
        yourRecentResolved: 'Tes points récemment résolus :',
        yourWellbeingTrend: 'Ta tendance bien-être sur 30 jours :',
        since: (date: string): string => `depuis ${date}`,
        wellbeingLabels: { energy: 'énergie', mood: 'humeur', anxiety: 'anxiété' },
      },
      Russian: {
        yourCaseFile: (narrative: string): string =>
          `Твоя клиническая история: ${narrative}`,
        yourOpenHypotheses: 'Твои открытые гипотезы:',
        yourPendingTests: 'Твои ожидающие тесты:',
        yourActiveTreatments: 'Твои активные методы лечения:',
        yourRecentResolved: 'Твои недавно решённые вопросы:',
        yourWellbeingTrend: 'Твой 30-дневный тренд самочувствия:',
        since: (date: string): string => `с ${date}`,
        wellbeingLabels: { energy: 'энергия', mood: 'настроение', anxiety: 'тревога' },
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

// ── Pure formatter ──────────────────────────────────────────────────────────
//
// Renders one operational-profile dimension as a plain-text Telegram message
// for `/profile`. Pure function: input tuple in, string out, no I/O / no DB /
// no logger. Deterministic given (dimension, profile, lang) AND current Date
// (for the staleness check vs profile.lastUpdated).
//
// Contract:
//   - profile === null OR profile.confidence === 0 → returns the localized
//     actionable progress indicator (D-21). No header, no body fields.
//   - profile.confidence > 0 AND lastUpdated within 21 days → returns
//     `${sectionTitle} (${confidence} NN%)` + blank line + per-field
//     second-person lines from profile.data, joined with '\n'. NO staleness
//     note.
//   - profile.confidence > 0 AND lastUpdated > 21 days ago → same as above,
//     PLUS a blank line + localized staleness note (D-22).
//
// Per-dimension switch-case (CONTEXT.md Claude's Discretion default — v1
// inline switch; config object deferred until M011/M012 add more dimensions).
// Field shapes are read from src/memory/profiles/schemas.ts; null/empty
// fields are skipped gracefully (no `null` literal in output).
//
// Second-person framing (D-20 + M010-07): every emitted line uses "You're",
// "Your", "Ta/Ton/Tes", "Твой/Твоя/Твои". NEVER "Greg's...", "His...",
// "He has...". The golden-snapshot test asserts this invariant.

export function formatProfileForDisplay(
  dimension: Dimension,
  profile: ProfileRow<unknown> | null,
  lang: Lang,
): string {
  // D-21: null or zero-confidence → localized actionable progress indicator.
  // No header, no body — just the "Chris needs more entries about..." line.
  if (profile === null || profile.confidence === 0) {
    return MSG.insufficientData[lang](dimension);
  }

  const confidencePct = Math.round(profile.confidence * 100);
  const title = `${MSG.sectionTitle[dimension][lang]} (${MSG.confidence[lang]} ${confidencePct}%)`;
  const lines: string[] = [title, ''];

  switch (dimension) {
    case 'jurisdictional': {
      const d = profile.data as JurisdictionalProfileData;
      const L = MSG.fields.jurisdictional[lang];
      if (d.physical_location && d.current_country) {
        lines.push(L.youAreIn(d.physical_location, d.current_country));
      } else if (d.current_country) {
        lines.push(L.youAreInCountry(d.current_country));
      }
      if (d.tax_residency) lines.push(L.yourTaxResidency(d.tax_residency));
      if (d.residency_status?.length) {
        lines.push(L.yourResidencyStatuses);
        for (const r of d.residency_status) {
          lines.push(`- ${r.type}: ${r.value}${r.since ? L.residencySince(r.since) : ''}`);
        }
      }
      if (d.next_planned_move?.destination && d.next_planned_move.from_date) {
        lines.push(L.yourNextMove(d.next_planned_move.destination, d.next_planned_move.from_date));
      } else if (d.next_planned_move?.destination && d.planned_move_date) {
        // Edge: from_date sits in planned_move_date instead of inside next_planned_move.
        // This branch MUST come before the destination-only branch below — otherwise
        // the destination-only branch eats the case and the planned_move_date is dropped.
        lines.push(L.yourNextMove(d.next_planned_move.destination, d.planned_move_date));
      } else if (d.next_planned_move?.destination) {
        lines.push(L.yourNextMoveDestOnly(d.next_planned_move.destination));
      }
      if (d.passport_citizenships?.length) {
        lines.push(L.yourCitizenships(d.passport_citizenships.join(', ')));
      }
      if (d.active_legal_entities?.length) {
        const ents = d.active_legal_entities.map((e) => `${e.name} (${e.jurisdiction})`).join(', ');
        lines.push(L.yourLegalEntities(ents));
      }
      break;
    }
    case 'capital': {
      const d = profile.data as CapitalProfileData;
      const L = MSG.fields.capital[lang];
      if (d.fi_phase) lines.push(L.yourFIPhase(d.fi_phase));
      if (d.fi_target_amount) lines.push(L.yourFITarget(d.fi_target_amount));
      if (d.estimated_net_worth) lines.push(L.yourNetWorth(d.estimated_net_worth));
      if (d.runway_months != null) lines.push(L.yourRunway(d.runway_months));
      if (d.next_sequencing_decision) lines.push(L.yourNextSequencing(d.next_sequencing_decision));
      if (d.tax_optimization_status) lines.push(L.yourTaxOptimization(d.tax_optimization_status));
      if (d.income_sources?.length) {
        lines.push(L.yourIncomeSources);
        for (const s of d.income_sources) {
          lines.push(`- ${s.source} (${s.kind})`);
        }
      }
      if (d.active_legal_entities?.length) {
        const ents = d.active_legal_entities.map((e) => `${e.name} (${e.jurisdiction})`).join(', ');
        lines.push(L.yourLegalEntities(ents));
      }
      if (d.major_allocation_decisions?.length) {
        lines.push(L.yourMajorAllocations);
        for (const a of d.major_allocation_decisions) {
          lines.push(`- ${a.date}: ${a.description}`);
        }
      }
      break;
    }
    case 'health': {
      const d = profile.data as HealthProfileData;
      const L = MSG.fields.health[lang];
      if (d.case_file_narrative) lines.push(L.yourCaseFile(d.case_file_narrative));
      if (d.open_hypotheses?.length) {
        lines.push(L.yourOpenHypotheses);
        for (const h of d.open_hypotheses) {
          lines.push(`- ${h.name} [${h.status} ${L.since(h.date_opened)}]`);
        }
      }
      if (d.pending_tests?.length) {
        lines.push(L.yourPendingTests);
        for (const t of d.pending_tests) {
          // Avoid the "(scheduled, scheduled 2026-05-25)" redundancy when the
          // status string already says "scheduled" — emit just the date in
          // that case. For any other status (e.g., "awaiting referral"), keep
          // the status word and append the date separately.
          let label: string;
          if (t.status.toLowerCase() === 'scheduled' && t.scheduled_date) {
            label = `scheduled ${t.scheduled_date}`;
          } else if (t.scheduled_date) {
            label = `${t.status}, scheduled ${t.scheduled_date}`;
          } else {
            label = t.status;
          }
          lines.push(`- ${t.test_name} (${label})`);
        }
      }
      if (d.active_treatments?.length) {
        lines.push(L.yourActiveTreatments);
        for (const t of d.active_treatments) {
          const purp = t.purpose ? ` (${t.purpose})` : '';
          lines.push(`- ${t.name} ${L.since(t.started_date)}${purp}`);
        }
      }
      if (d.recent_resolved?.length) {
        lines.push(L.yourRecentResolved);
        for (const r of d.recent_resolved) {
          lines.push(`- ${r.name} resolved ${r.resolved_date}: ${r.resolution}`);
        }
      }
      const wb = d.wellbeing_trend;
      if (wb && (wb.energy_30d_mean != null || wb.mood_30d_mean != null || wb.anxiety_30d_mean != null)) {
        const parts: string[] = [];
        if (wb.energy_30d_mean != null) parts.push(`${L.wellbeingLabels.energy}=${wb.energy_30d_mean}`);
        if (wb.mood_30d_mean != null) parts.push(`${L.wellbeingLabels.mood}=${wb.mood_30d_mean}`);
        if (wb.anxiety_30d_mean != null) parts.push(`${L.wellbeingLabels.anxiety}=${wb.anxiety_30d_mean}`);
        lines.push(`${L.yourWellbeingTrend} ${parts.join(', ')}`);
      }
      break;
    }
    case 'family': {
      const d = profile.data as FamilyProfileData;
      const L = MSG.fields.family[lang];
      if (d.relationship_status) lines.push(L.yourRelationshipStatus(d.relationship_status));
      if (d.children_plans) lines.push(L.yourChildrenPlans(d.children_plans));
      if (d.active_dating_context) lines.push(L.yourDatingContext(d.active_dating_context));
      const pcr = d.parent_care_responsibilities;
      if (pcr && (pcr.notes || pcr.dependents?.length)) {
        lines.push(L.yourParentCare);
        if (pcr.notes) lines.push(`- ${pcr.notes}`);
        if (pcr.dependents?.length) {
          for (const dep of pcr.dependents) {
            lines.push(`- ${dep}`);
          }
        }
      }
      if (d.partnership_criteria_evolution?.length) {
        const active = d.partnership_criteria_evolution.filter((c) => c.still_active);
        if (active.length > 0) {
          lines.push(L.yourPartnershipCriteria);
          for (const c of active) {
            lines.push(`- ${c.date_noted}: ${c.text}`);
          }
        }
      }
      if (d.constraints?.length) {
        lines.push(L.yourConstraints);
        for (const c of d.constraints) {
          lines.push(`- ${c.date_noted}: ${c.text}`);
        }
      }
      if (d.milestones?.length) {
        lines.push(L.yourMilestones);
        for (const m of d.milestones) {
          const notes = m.notes ? `: ${m.notes}` : '';
          lines.push(`- ${m.date} ${m.type}${notes}`);
        }
      }
      break;
    }
  }

  // D-22 staleness note — appended after a blank-line separator when
  // lastUpdated > 21 days ago. Same threshold as D-10 prompt-side gate; the
  // user-facing wording differs ("may not reflect current situation" vs
  // "may not reflect current state").
  //
  // IN-01: date is rendered via toLocaleDateString with the per-language
  // BCP-47 tag from DATE_LOCALES, matching the formatContradictionNotice
  // pattern in src/chris/personality.ts. Greg sees "April 1, 2026" in EN,
  // "1 avril 2026" in FR, "1 апреля 2026 г." in RU — not the ISO date.
  if (Date.now() - profile.lastUpdated.getTime() > STALENESS_MS) {
    const dateStr = profile.lastUpdated.toLocaleDateString(DATE_LOCALES[lang], {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    lines.push('', MSG.staleNote[lang](dateStr));
  }

  return lines.join('\n');
}

// ── Phase 39 PSURF-05 — psychological-profile pure formatter ───────────────
//
// `formatPsychologicalProfileForDisplay(profileType, profile, lang)` mirrors
// the operational `formatProfileForDisplay` above as the display-side surface
// for M011 psychological profiles (HEXACO / Schwartz / Attachment). Pure
// function — no DB, no logger, no ctx, no I/O. Composable with the 3-reply
// loop in handleProfileCommand (Task 3) which calls it once per profile type.
//
// HARD CO-LOC #M11-3: this formatter + the golden inline-snapshot test in
// profile-psychological.golden.test.ts ship in the SAME plan (39-02). The
// snapshot is the regression net for the framing class — any third-person
// leak, internal field-name leak, or D-09 per-dim filter regression fails
// the snapshot review before deployment (M010-07 precedent).
//
// D-19 four-branch state model (in order; each branch returns early):
//   1. profileType === 'attachment' → ALWAYS render `notYetActive` regardless
//      of fixture state (D028 deferred to v2.6.1; M011 surface treats
//      attachment as universally inactive).
//   2. profile === null OR profile.lastUpdated.getTime() === 0 → render
//      `neverFired` ("not yet inferred (first profile inference runs 1st of
//      month, 09:00 Paris)"). The epoch sentinel comes from the Phase 37
//      reader's D-22 cold-start coalesce (migration 0013 seeds last_updated=NULL).
//   3. profile.confidence === 0 → render `insufficientData(N)` where
//      N = max(0, 5000 - (profile.wordCountAtLastRun ?? 0)). The wordCount
//      column is threaded by Plan 39-01 Task 1's ProfileRow<T> extension —
//      no second DB read needed here.
//   4. Populated → section title + per-dim Title-Case score lines with the
//      D-07 confidence qualifier (<0.3 limited / 0.3-0.6 moderate / >=0.6
//      substantial). The D-09 per-dim filter skips individual dimensions
//      with null score OR confidence === 0 — prevents orphan "DIM Trait:
//      insufficient data" lines AND the future-refactor regression class
//      where `'Self-Direction: null'` accidentally leaks.
//
// Plain text only — NO parse_mode-flavored characters (`*`, `_`, backticks,
// `===`, `---`). Telegram renders the string verbatim when ctx.reply is
// called without parse_mode. D-17 invariant inherited from Phase 35 SURF-05.

// Phase 46 L10N-05 — psychological-profile confidence qualifier mapping is
// now the canonical locale-aware `qualifierFor` imported from
// `src/chris/locale/strings.ts`. The previous module-local
// `qualifierForPsych` (English-only) has been retired; both call sites
// below pass `lang` so FR/RU output ships locale-appropriate band labels
// (preuves substantielles / существенные данные / etc.).

// Phase 46 L10N-01 — Title-Case display labels for HEXACO dimensions, now
// per-locale. Hyphens preserved per D-08 (Honesty-Humility). Module-private
// — display-side lives in profile.ts, NOT imported from a shared module
// (Architectural Responsibility Map separates prompt-side label tables —
// which stay English in `src/memory/profiles.ts` — from display-side label
// tables here). FR + RU follow standard psychological-translation
// conventions (HEXACO French has accepted academic translations); Greg
// reviews at /gsd-verify-work per CONTEXT.md D-06.
const HEXACO_DIM_DISPLAY_LABELS: Readonly<
  Record<keyof HexacoProfileData, Record<Lang, string>>
> = {
  honesty_humility: {
    English: 'Honesty-Humility',
    French: 'Honnêteté-Humilité',
    Russian: 'Честность-Скромность',
  },
  emotionality: {
    English: 'Emotionality',
    French: 'Émotionnalité',
    Russian: 'Эмоциональность',
  },
  extraversion: {
    English: 'Extraversion',
    French: 'Extraversion',
    Russian: 'Экстраверсия',
  },
  agreeableness: {
    English: 'Agreeableness',
    French: 'Amabilité',
    Russian: 'Доброжелательность',
  },
  conscientiousness: {
    English: 'Conscientiousness',
    French: 'Conscienciosité',
    Russian: 'Добросовестность',
  },
  openness: {
    English: 'Openness',
    French: 'Ouverture',
    Russian: 'Открытость опыту',
  },
} as const;

// Phase 46 L10N-01 — Title-Case display labels for Schwartz values, now
// per-locale. Hyphens preserved per D-08 (Self-Direction). Per RESEARCH
// Deferred CIRC-01: alphabetical ordering in M011 (Object.entries iteration
// order matches declaration order); circumplex ordering is v2.6.1+ — DELIVERED
// by Phase 47 DISP-01 via SCHWARTZ_CIRCUMPLEX_ORDER below.
// FR/RU translations follow standard Schwartz-values academic Cyrillic +
// French references; Greg reviews at /gsd-verify-work per CONTEXT.md D-06.
const SCHWARTZ_DIM_DISPLAY_LABELS: Readonly<
  Record<keyof SchwartzProfileData, Record<Lang, string>>
> = {
  self_direction: {
    English: 'Self-Direction',
    French: 'Autonomie',
    Russian: 'Самостоятельность',
  },
  stimulation: {
    English: 'Stimulation',
    French: 'Stimulation',
    Russian: 'Стимуляция',
  },
  hedonism: {
    English: 'Hedonism',
    French: 'Hédonisme',
    Russian: 'Гедонизм',
  },
  achievement: {
    English: 'Achievement',
    French: 'Accomplissement',
    Russian: 'Достижения',
  },
  power: {
    English: 'Power',
    French: 'Pouvoir',
    Russian: 'Власть',
  },
  security: {
    English: 'Security',
    French: 'Sécurité',
    Russian: 'Безопасность',
  },
  conformity: {
    English: 'Conformity',
    French: 'Conformité',
    Russian: 'Конформизм',
  },
  tradition: {
    English: 'Tradition',
    French: 'Tradition',
    Russian: 'Традиция',
  },
  benevolence: {
    English: 'Benevolence',
    French: 'Bienveillance',
    Russian: 'Благожелательность',
  },
  universalism: {
    English: 'Universalism',
    French: 'Universalisme',
    Russian: 'Универсализм',
  },
} as const;

// Phase 47 DISP-01 — canonical clockwise circumplex order. Adjacent pairs across
// the 10-element ring form Schwartz's documented oppositions at distance 5:
//   self_direction <-> conformity   (index 0 <-> 4)
//   stimulation    <-> security     (index 9 <-> 5)
//   hedonism       <-> tradition    (index 8 <-> 3)
//   achievement    <-> benevolence  (index 7 <-> 2)
//   power          <-> universalism (index 6 <-> 1)
// The ring wraps at index 9 -> index 0 (stimulation <-> self_direction completes
// the circle). NOT alphabetical, NOT by-score: the structural pairing IS the
// reader value per DISP-01 (CONTEXT.md D-01/D-02).
export const SCHWARTZ_CIRCUMPLEX_ORDER: readonly (keyof SchwartzProfileData)[] = [
  'self_direction',
  'universalism',
  'benevolence',
  'tradition',
  'conformity',
  'security',
  'power',
  'achievement',
  'hedonism',
  'stimulation',
] as const;

export function formatPsychologicalProfileForDisplay(
  profileType: 'hexaco' | 'schwartz' | 'attachment',
  profile:
    | ProfileRow<HexacoProfileData>
    | ProfileRow<SchwartzProfileData>
    | ProfileRow<AttachmentProfileData>
    | null,
  lang: Lang,
): string {
  // D-19 branch 1 — Attachment: ALWAYS "not yet active" in M011 (D028
  // deferred to v2.6.1). Even with a populated attachment fixture, M011
  // surface renders the deferred message — branches 2-4 below are
  // unreachable for profileType === 'attachment'.
  if (profileType === 'attachment') {
    return MSG.psychologicalSections.attachment.notYetActive[lang];
  }

  // D-19 branch 2 — never-fired: null row OR epoch sentinel
  // (lastUpdated.getTime() === 0). Phase 37 reader coalesces migration 0013
  // seed rows' NULL last_updated → new Date(0).
  if (profile === null || profile.lastUpdated.getTime() === 0) {
    return MSG.psychologicalSections[profileType].neverFired[lang];
  }

  // D-19 branch 3 — insufficient data: overall_confidence === 0. N is the
  // remaining word count Sonnet needs before the next inference fires
  // (RESEARCH Open Q1 Option A — wordCountAtLastRun is threaded by
  // readOnePsychologicalProfile in Plan 39-01 Task 1).
  if (profile.confidence === 0) {
    const wc = profile.wordCountAtLastRun ?? 0;
    const N = Math.max(0, 5000 - wc);
    return MSG.psychologicalSections[profileType].insufficientData[lang](N);
  }

  // D-19 branch 4 — populated: section title + per-dim Title-Case score lines
  // with D-07 qualifier. D-09 per-dim filter (skip null score OR confidence
  // === 0) is the regression detector for the future-refactor leak class.
  const title = MSG.psychologicalSections[profileType].sectionTitle[lang];
  const lines: string[] = [title, ''];

  switch (profileType) {
    case 'hexaco': {
      const d = profile.data as HexacoProfileData;
      for (const [key, labels] of Object.entries(HEXACO_DIM_DISPLAY_LABELS) as Array<
        [keyof HexacoProfileData, Record<Lang, string>]
      >) {
        const dim = d[key];
        if (!dim) continue; // D-09 skip null
        if (dim.score === null) continue; // D-09 skip null score
        if (dim.confidence === 0) continue; // D-09 skip zero-confidence
        const label = labels[lang];
        const qual = qualifierFor(dim.confidence, lang);
        lines.push(MSG.scoreLine[lang](label, dim.score, dim.confidence, qual));
      }
      break;
    }
    case 'schwartz': {
      // Phase 47 DISP-01 — iterate SCHWARTZ_CIRCUMPLEX_ORDER (canonical
      // clockwise circumplex) instead of Object.entries(SCHWARTZ_DIM_DISPLAY_LABELS)
      // (declaration order). Adjacent pairs land at distance 5 on the 10-element
      // ring, exposing Schwartz's documented oppositions to the reader. The
      // D-09 per-dim filter is preserved verbatim — a filtered-out dim leaves
      // a gap in the circumplex, which is the correct "we don't have evidence
      // for this value" signal (CONTEXT.md D-05).
      const d = profile.data as SchwartzProfileData;
      for (const key of SCHWARTZ_CIRCUMPLEX_ORDER) {
        const dim = d[key];
        if (!dim) continue; // D-09 skip null
        if (dim.score === null) continue; // D-09 skip null score
        if (dim.confidence === 0) continue; // D-09 skip zero-confidence
        const label = SCHWARTZ_DIM_DISPLAY_LABELS[key][lang];
        const qual = qualifierFor(dim.confidence, lang);
        lines.push(MSG.scoreLine[lang](label, dim.score, dim.confidence, qual));
      }
      break;
    }
    // Note: profileType === 'attachment' is unreachable here — branch 1
    // early-returns above, so TypeScript narrows the switch discriminant to
    // 'hexaco' | 'schwartz' and rejects an explicit `case 'attachment'`. The
    // exhaustiveness invariant is enforced by the union signature at the
    // function boundary; no `never`-check assertion is needed.
  }

  return lines.join('\n');
}

// ── Handler ─────────────────────────────────────────────────────────────────
//
// User-initiated `/profile` Telegram command. Reads operational + psychological
// profiles via two parallel never-throw readers (Phase 33 + Phase 37); renders
// each via the pure formatProfileForDisplay / formatPsychologicalProfileForDisplay
// formatters; sends one ctx.reply per profile, in declaration order. Phase 39
// PSURF-04: the previous M011 placeholder reply is REPLACED by a 3-reply
// for-of loop over ['hexaco', 'schwartz', 'attachment']. Total: 7 ctx.reply
// calls per /profile invocation (4 operational + 3 psychological, D-18 + D-17).
// On error: single localized genericError reply + logger.warn — never silent.
//
// Per D-17 + SURF-05: every ctx.reply takes a single plain-string argument
// (no parse_mode). Per D-19: language sourced from in-memory
// getLastUserLanguage cache (user-initiated context); NOT getLastUserLanguageFromDb
// (that's for cron handlers where the in-memory cache may be cold — M009
// first-Sunday lesson).
//
// Per ANTI-6: ZERO sub-argument parsing surface — ctx.message.text is ignored.
// `/profile edit jurisdictional ...` would route to the same handler and emit
// the same 7 replies. No regex, no split, no command-suffix logic.

export async function handleProfileCommand(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return;

  const lang = langOf(getLastUserLanguage(chatId.toString()));

  try {
    const profiles = await getOperationalProfiles();
    // D-18: 4 operational ctx.reply calls in declaration order.
    // Sequential awaits so Telegram receives the messages in the same order
    // they're emitted (parallelizing via Promise.all would not guarantee
    // message arrival order at the client). Per-dimension failure isolation:
    // formatProfileForDisplay is pure and exception-free over the typed
    // OperationalProfiles shape (null branch + populated branch both return
    // strings); any throw here means the catch-block fires and Greg sees a
    // genericError, which is the right UX over a partial 3-dimension reply.
    const dimensions: Dimension[] = ['jurisdictional', 'capital', 'health', 'family'];
    for (const dim of dimensions) {
      await ctx.reply(formatProfileForDisplay(dim, profiles[dim], lang));
    }

    // Phase 39 PSURF-04 — REPLACES the M011 placeholder reply.
    // D-17 + D-18: 3 psychological ctx.reply calls in locked order
    // (HEXACO → Schwartz → Attachment). Sequential await (NOT Promise.all)
    // preserves Telegram message order — same discipline as the operational
    // loop above. Reader is never-throw (Phase 37); formatter is pure
    // (Task 2). No per-profile try/catch — the outer catch handles any
    // unexpected throw the same way it does for the operational replies.
    const psychProfiles = await getPsychologicalProfiles();
    const psychTypes: PsychologicalProfileType[] = ['hexaco', 'schwartz', 'attachment'];
    for (const type of psychTypes) {
      await ctx.reply(formatPsychologicalProfileForDisplay(type, psychProfiles[type], lang));
    }
  } catch (err) {
    logger.warn(
      {
        chatId,
        error: err instanceof Error ? err.message : String(err),
      },
      'profile.command.error',
    );
    await ctx.reply(MSG.genericError[lang]);
  }
}

