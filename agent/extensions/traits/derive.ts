import { Data } from "effect";
import type { JsonValue } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { coverageQuestion, relationshipQuestion, type Decisions } from "./decisions.ts";
import {
  readTraits,
  revision,
  saveTrait,
  serializeTrait,
  type Project,
  type Trait,
} from "./store.ts";

type Derivation = Data.TaggedEnum<{
  ApprovalRequired: { message: string; instructions: string };
  Inconclusive: { traits: Trait[]; instructions: string };
  Clarification: { traits: Trait[]; instructions: string };
  ReconciliationRequired: { traits: Trait[]; proposedTrait: Trait; instructions: string };
  Covered: { traits: Trait[] };
  Declined: {};
  Created: { trait: Trait; instructions: string };
  Updated: { trait: Trait; instructions: string };
}>;

const Derivation = Data.taggedEnum<Derivation>();

export async function deriveTrait(
  project: Project,
  proposal: Trait,
  decisions: Decisions,
  ctx: ExtensionContext,
  signal?: AbortSignal,
): Promise<JsonValue> {
  const traits = await readTraits(project);

  const answers = await decisions.assess(
    { proposedTrait: proposal },
    Object.fromEntries(traits.map((trait) => [trait.name, relationshipQuestion(trait)])),
  );

  const related = (classification: string) =>
    traits.filter((trait) => answers[trait.name]?.classification === classification);

  const candidates = related("covered");

  if (candidates.length) {
    const coverage = await decisions.assess(
      { proposedTrait: proposal },
      Object.fromEntries(candidates.map((trait) => [trait.name, coverageQuestion(trait)])),
    );

    for (const [name, answer] of Object.entries(coverage)) {
      if (answer.classification !== "complete") {
        answers[name] = {
          ...answer,
          classification: answer.classification === "incomplete" ? "coverage_gap" : "inconclusive",
        };
      }
    }
  }

  const uncertain = related("inconclusive");

  if (uncertain.length) {
    return Derivation.Inconclusive({
      traits: uncertain,
      instructions: "Clarify the relationship before saving.",
    });
  }

  const existing = traits.find((trait) => trait.name === proposal.name);
  const clarifications = related("clarification");

  const target = clarifications[0];
  const conflicts = [...related("conflict"), ...related("coverage_gap")];

  if (conflicts.length) {
    return Derivation.ReconciliationRequired({
      traits: conflicts,
      proposedTrait: proposal,
      instructions:
        "Reconcile these conflicts with the user, preserving existing requirements, exceptions, and canonical names.",
    });
  }

  const covered = related("covered");

  if (covered.length) return Derivation.Covered({ traits: covered });

  if (clarifications.length > 1) {
    return Derivation.Clarification({
      traits: clarifications,
      instructions: "Ask which existing preference to clarify.",
    });
  }

  if (existing && !target) {
    throw new Error(
      `Trait ${existing.name} already exists with a distinct rule. Choose a different name.`,
    );
  }

  const replacement = target ? { ...proposal, name: target.name } : proposal;

  const message = target
    ? `Replace ${target.name}?\n\nCurrent trait:\n${serializeTrait(target)}\nReplacement:\n${serializeTrait(replacement)}`
    : `Save this trait?\n\n${serializeTrait(replacement)}`;

  if (!ctx.hasUI) {
    return Derivation.ApprovalRequired({
      message,
      instructions: "Saving requires Pi's interactive or RPC confirmation.",
    });
  }

  const approved = await ctx.ui.confirm("Traits: approve this exact change", message, { signal });
  signal?.throwIfAborted();

  if (!approved) return Derivation.Declined();

  await saveTrait(project, replacement, revision(traits), signal);
  const saved = target ? Derivation.Updated : Derivation.Created;

  return saved({
    trait: replacement,
    instructions:
      "Check the current task's eligible files against this trait, fix confirmed violations, and recheck.",
  });
}
