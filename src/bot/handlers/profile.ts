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
          lines.push(`- ${r.type}: ${r.value}${r.since ? ` (since ${r.since})` : ''}`);
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
          lines.push(`- ${h.name} [${h.status} since ${h.date_opened}]`);
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
          lines.push(`- ${t.name} since ${t.started_date}${purp}`);
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
        if (wb.energy_30d_mean != null) parts.push(`energy=${wb.energy_30d_mean}`);
        if (wb.mood_30d_mean != null) parts.push(`mood=${wb.mood_30d_mean}`);
        if (wb.anxiety_30d_mean != null) parts.push(`anxiety=${wb.anxiety_30d_mean}`);
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
  if (Date.now() - profile.lastUpdated.getTime() > STALENESS_MS) {
    const dateStr = profile.lastUpdated.toISOString().slice(0, 10);
    lines.push('', MSG.staleNote[lang](dateStr));
  }

  return lines.join('\n');
}

// ── Handler ─────────────────────────────────────────────────────────────────
//
// User-initiated `/profile` Telegram command. Reads all 4 operational profiles
// in parallel (Phase 33 never-throw reader), renders each via the pure
// formatProfileForDisplay, sends one ctx.reply per dimension in declaration
// order, then a final reply with the M011 psychological-profile placeholder.
// Total: 5 ctx.reply calls per /profile invocation (D-18). On error, sends a
// single localized genericError reply + logger.warn — never silent.
//
// Per D-17 + SURF-05: every ctx.reply takes a single plain-string argument
// (no parse_mode). Per D-19: language sourced from in-memory
// getLastUserLanguage cache (user-initiated context); NOT getLastUserLanguageFromDb
// (that's for cron handlers where the in-memory cache may be cold — M009
// first-Sunday lesson).
//
// Per ANTI-6: ZERO sub-argument parsing surface — ctx.message.text is ignored.
// `/profile edit jurisdictional ...` would route to the same handler and emit
// the same 5 replies. No regex, no split, no command-suffix logic.

export async function handleProfileCommand(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return;

  const lang = langOf(getLastUserLanguage(chatId.toString()));

  try {
    const profiles = await getOperationalProfiles();
    // D-18: 5 ctx.reply calls — 4 dimensions in declaration order + M011.
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
    await ctx.reply(MSG.m011Placeholder[lang]);
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

