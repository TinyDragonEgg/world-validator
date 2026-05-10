/**
 * World Validator — Foundry VTT v13 / dnd5e v5.x
 * Tabs: Validate JSON | Attribute Browser | Context Pack | Module Errors
 * GM only. No external dependencies.
 */

const MODULE_ID  = "world-validator";
const MODULE_TAG = "World Validator";

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const WV = {
  log(level, ctx, ...args) {
    const levels = { error: 0, warn: 1, info: 2, debug: 3 };
    const min    = levels[game.settings.get(MODULE_ID, "logLevel") ?? "warn"] ?? 1;
    if ((levels[level] ?? 99) > min) return;
    const tag = `[${MODULE_TAG}][${ctx}]`;
    if (level === "error") console.error(tag, ...args);
    else if (level === "warn") console.warn(tag, ...args);
    else console.log(tag, ...args);
  },
};

// ---------------------------------------------------------------------------
// Error interceptor — runs immediately to catch everything since load
// ---------------------------------------------------------------------------

const _errLog = [];
const _origError = console.error.bind(console);
const _origWarn  = console.warn.bind(console);

function _moduleFromStack(stack = "") {
  // Try to find a module ID in the stack trace
  const match = stack.match(/modules\/([^/]+)\//);
  if (match) return match[1];
  const sysMatch = stack.match(/systems\/([^/]+)\//);
  if (sysMatch) return `system:${sysMatch[1]}`;
  return "unknown";
}

console.error = (...a) => {
  const stack  = new Error().stack ?? "";
  const source = _moduleFromStack(stack);
  _errLog.push({ level: "error", ts: Date.now(), msg: a.map(String).join(" "), source, stack });
  _origError(...a);
};
console.warn = (...a) => {
  const stack  = new Error().stack ?? "";
  const source = _moduleFromStack(stack);
  _errLog.push({ level: "warn", ts: Date.now(), msg: a.map(String).join(" "), source, stack });
  _origWarn(...a);
};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function registerSettings() {
  const defs = [
    { key: "logLevel",  name: "Log Level", type: String,  default: "warn", config: true,
      choices: { error:"Error", warn:"Warn", info:"Info", debug:"Debug" } },
    { key: "apiKey",    name: "Claude API Key", type: String, default: "", config: true,
      hint: "Required for AI error analysis. sk-ant-..." },
    { key: "dryRun",    name: "Dry Run", type: Boolean, default: false, config: true,
      hint: "Log all actions without writing anything." },
  ];
  for (const d of defs) {
    const cfg = { scope: "world", config: true, type: d.type, default: d.default, restricted: true };
    if (d.name)    cfg.name    = d.name;
    if (d.hint)    cfg.hint    = d.hint;
    if (d.choices) cfg.choices = d.choices;
    game.settings.register(MODULE_ID, d.key, cfg);
  }
  WV.log("info", "Settings", "Registered.");
}

// ---------------------------------------------------------------------------
// dnd5e introspection — extract live schema
// ---------------------------------------------------------------------------

/**
 * Extract all leaf paths from a nested object.
 * @param {object} obj
 * @param {string} [prefix]
 * @param {number} [maxDepth]
 * @returns {string[]}
 */
function extractPaths(obj, prefix = "", maxDepth = 8, depth = 0) {
  if (!obj || typeof obj !== "object" || depth >= maxDepth) return prefix ? [prefix] : [];
  const paths = [];
  for (const [key, val] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${key}` : key;
    if (val && typeof val === "object" && !Array.isArray(val)) {
      paths.push(...extractPaths(val, p, maxDepth, depth + 1));
    } else {
      paths.push(p);
    }
  }
  return paths;
}

/**
 * Build a schema map for a document type by creating a temporary instance.
 * @param {"character"|"npc"|"vehicle"} actorType
 * @returns {object} { paths, fields, enums }
 */
function introspectActorType(actorType) {
  try {
    const model = game.system.model?.Actor?.[actorType];
    if (!model) return { paths: [], fields: {}, enums: {} };
    const paths = extractPaths(model, "system");
    WV.log("debug", "Introspect", `Actor ${actorType}: ${paths.length} paths`);
    return { paths, fields: model, enums: _extractEnums(actorType, "actor") };
  } catch (e) {
    WV.log("error", "Introspect", `Actor ${actorType} failed:`, e);
    return { paths: [], fields: {}, enums: {} };
  }
}

/**
 * @param {string} itemType e.g. "weapon","spell","feat"
 */
function introspectItemType(itemType) {
  try {
    const model = game.system.model?.Item?.[itemType];
    if (!model) return { paths: [], fields: {}, enums: {} };
    const paths = extractPaths(model, "system");
    WV.log("debug", "Introspect", `Item ${itemType}: ${paths.length} paths`);
    return { paths, fields: model, enums: _extractEnums(itemType, "item") };
  } catch (e) {
    WV.log("error", "Introspect", `Item ${itemType} failed:`, e);
    return { paths: [], fields: {}, enums: {} };
  }
}

/**
 * Known enums sourced from dnd5e system at runtime where possible,
 * with fallbacks for commonly used fields.
 */
function _extractEnums(type, docType) {
  const cfg = CONFIG?.DND5E ?? {};
  const enums = {};

  if (docType === "item") {
    enums["system.actionType"]    = Object.keys(cfg.itemActionTypes ?? { mwak:1, rwak:1, msak:1, rsak:1, save:1, heal:1, abil:1, util:1, other:1 });
    enums["system.activation.type"] = Object.keys(cfg.abilityActivationTypes ?? { action:1, bonus:1, reaction:1, minute:1, hour:1, day:1, special:1, legendary:1, lair:1 });
    enums["system.target.type"]   = Object.keys(cfg.targetTypes ?? {});
    enums["system.range.units"]   = Object.keys(cfg.movementUnits ?? {});
    enums["system.duration.units"]= Object.keys(cfg.timePeriods ?? {});
    enums["system.damage.parts[].type"] = Object.keys(cfg.damageTypes ?? {});
    if (type === "weapon") {
      enums["system.weaponType"]  = Object.keys(cfg.weaponTypes ?? {});
      enums["system.properties"]  = Object.keys(cfg.weaponProperties ?? {});
    }
    if (type === "spell") {
      enums["system.school"]      = Object.keys(cfg.spellSchools ?? {});
      enums["system.level"]       = [0,1,2,3,4,5,6,7,8,9].map(String);
      enums["system.components"]  = ["vocal","somatic","material","ritual","concentration"];
    }
    if (type === "equipment") {
      enums["system.armor.type"]  = Object.keys(cfg.armorTypes ?? {});
    }
  }

  if (docType === "actor") {
    enums["system.abilities"]     = Object.keys(cfg.abilities ?? {});
    enums["system.skills"]        = Object.keys(cfg.skills ?? {});
    enums["system.attributes.movement.units"] = Object.keys(cfg.movementUnits ?? {});
    if (type === "character") {
      enums["system.details.alignment"] = Object.keys(cfg.alignments ?? {});
    }
  }

  return enums;
}

/**
 * Get all valid item types from the live system.
 * @returns {string[]}
 */
function getItemTypes() {
  return Object.keys(game.system.model?.Item ?? {});
}

/**
 * Get all valid actor types.
 * @returns {string[]}
 */
function getActorTypes() {
  return Object.keys(game.system.model?.Actor ?? {});
}

/**
 * Get all valid activity types registered by dnd5e.
 * @returns {string[]}
 */
function getActivityTypes() {
  try {
    return Object.keys(CONFIG?.DND5E?.activityTypes ?? {});
  } catch {
    return ["attack", "cast", "check", "damage", "enchant", "heal", "save", "summon", "utility"];
  }
}

/**
 * Get all installed compendium packs with metadata.
 * @returns {object[]}
 */
function getCompendiumIndex() {
  return [...game.packs].map(p => ({
    id:        p.metadata.id,
    label:     p.metadata.label,
    type:      p.metadata.type,
    module:    p.metadata.packageName,
    system:    p.metadata.system ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Validator engine
// ---------------------------------------------------------------------------

const VALID_ID_RE = /^[a-z0-9]{16}$/;
const VALID_UUID_RE = /^(Compendium\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9]{16}|[A-Za-z0-9]{16})$/;

/**
 * @typedef {object} ValidationError
 * @property {"error"|"warn"|"info"} level
 * @property {string} path   - JSON path to the problem field
 * @property {string} msg    - Human-readable description
 * @property {any}    value  - The bad value
 * @property {string} [fix]  - Suggested fix
 */

/**
 * Validate a single document object against the live dnd5e schema.
 * @param {object} doc
 * @param {string} [docPath] - JSON path prefix for nested docs
 * @returns {ValidationError[]}
 */
function validateDocument(doc, docPath = "root") {
  const errors = [];
  const push   = (level, path, msg, value, fix) => errors.push({ level, path, msg, value, fix });

  if (!doc || typeof doc !== "object") {
    push("error", docPath, "Document is not an object", doc);
    return errors;
  }

  // _id validation
  if (doc._id !== undefined) {
    if (typeof doc._id !== "string") {
      push("error", `${docPath}._id`, "_id must be a string", doc._id, "Use foundry.utils.randomID(16)");
    } else if (!VALID_ID_RE.test(doc._id)) {
      const len = doc._id.length;
      push("error", `${docPath}._id`,
        `_id must be exactly 16 lowercase alphanumeric characters (got ${len})`,
        doc._id,
        len !== 16 ? `Pad or trim to 16 chars: "${doc._id.toLowerCase().replace(/[^a-z0-9]/g, "0").padEnd(16,"0").substring(0,16)}"` : "Remove uppercase or special characters"
      );
    }
  }

  // name
  if (!doc.name || typeof doc.name !== "string" || !doc.name.trim()) {
    push("error", `${docPath}.name`, "Document must have a non-empty name", doc.name);
  }

  // type
  const docType = doc.type;
  if (!docType) {
    push("error", `${docPath}.type`, "Document must have a type field", doc.type);
  }

  // img path
  if (doc.img && typeof doc.img === "string") {
    if (doc.img.includes("\\")) {
      push("warn", `${docPath}.img`, "Image path uses backslashes — use forward slashes", doc.img,
        doc.img.replace(/\\/g, "/"));
    }
    if (doc.img.startsWith("/")) {
      push("warn", `${docPath}.img`, "Image path should not start with a leading slash", doc.img,
        doc.img.replace(/^\//, ""));
    }
  }

  // Item-specific
  if (doc.type && getItemTypes().includes(doc.type) && doc.system) {
    errors.push(...validateItemSystem(doc, docPath));
  }

  // Actor-specific
  if (doc.type && getActorTypes().includes(doc.type) && doc.system) {
    errors.push(...validateActorSystem(doc, docPath));
  }

  // Activities
  if (doc.system?.activities) {
    errors.push(...validateActivities(doc.system.activities, `${docPath}.system.activities`));
  }

  // Effects
  if (Array.isArray(doc.effects)) {
    doc.effects.forEach((eff, i) => {
      errors.push(...validateEffect(eff, `${docPath}.effects[${i}]`));
    });
  }

  // Embedded items
  if (Array.isArray(doc.items)) {
    doc.items.forEach((item, i) => {
      errors.push(...validateDocument(item, `${docPath}.items[${i}]`));
    });
  }

  return errors;
}

function validateItemSystem(doc, docPath) {
  const errors = [];
  const push   = (level, path, msg, value, fix) => errors.push({ level, path, msg, value, fix });
  const sys    = doc.system;
  const schema = introspectItemType(doc.type);

  // Check for fields that don't exist in the schema
  const sysKeys = extractPaths(sys, "system");
  for (const key of sysKeys) {
    const bare = key.replace(/\[\d+\]/g, "");
    if (schema.paths.length && !schema.paths.some(p => bare.startsWith(p) || p.startsWith(bare))) {
      push("warn", `${docPath}.${key}`, `Field not found in dnd5e ${doc.type} schema`, undefined,
        "Check field name or remove if unused");
    }
  }

  // Damage formula basic check
  if (sys.damage?.parts) {
    sys.damage.parts.forEach((part, i) => {
      if (!Array.isArray(part) || part.length < 2) {
        push("error", `${docPath}.system.damage.parts[${i}]`,
          "Damage part must be [formula, type] array", part);
      } else {
        const [formula] = part;
        if (formula && typeof formula === "string") {
          errors.push(...validateFormula(formula, `${docPath}.system.damage.parts[${i}][0]`));
        }
      }
    });
  }

  // Action type
  if (sys.actionType && !["mwak","rwak","msak","rsak","save","heal","abil","util","other",""].includes(sys.actionType)) {
    push("error", `${docPath}.system.actionType`, "Invalid actionType", sys.actionType,
      "Valid: mwak rwak msak rsak save heal abil util other");
  }

  return errors;
}

function validateActorSystem(doc, docPath) {
  const errors = [];
  // Ability scores
  const abilities = Object.keys(CONFIG?.DND5E?.abilities ?? {});
  if (doc.system.abilities) {
    for (const [key] of Object.entries(doc.system.abilities)) {
      if (abilities.length && !abilities.includes(key)) {
        errors.push({ level: "error", path: `${docPath}.system.abilities.${key}`,
          msg: `Unknown ability score`, value: key,
          fix: `Valid abilities: ${abilities.join(", ")}` });
      }
    }
  }
  return errors;
}

function validateActivities(activities, path) {
  const errors      = [];
  const validTypes  = getActivityTypes();

  const actEntries = Array.isArray(activities)
    ? activities.map((a, i) => [i, a])
    : Object.entries(activities);

  for (const [key, act] of actEntries) {
    const aPath = `${path}[${key}]`;

    if (act._id !== undefined && !VALID_ID_RE.test(act._id)) {
      errors.push({ level: "error", path: `${aPath}._id`,
        msg: `Activity _id must be exactly 16 lowercase alphanumeric chars (got ${act._id?.length})`,
        value: act._id, fix: "Use foundry.utils.randomID(16)" });
    }

    if (act.type && validTypes.length && !validTypes.includes(act.type)) {
      errors.push({ level: "error", path: `${aPath}.type`,
        msg: `Unknown activity type`, value: act.type,
        fix: `Valid types: ${validTypes.join(", ")}` });
    }

    // Damage in activities
    if (act.damage?.parts) {
      act.damage.parts.forEach((part, i) => {
        if (part.custom?.formula) {
          errors.push(...validateFormula(part.custom.formula, `${aPath}.damage.parts[${i}].custom.formula`));
        }
      });
    }
  }

  return errors;
}

function validateEffect(eff, path) {
  const errors = [];

  if (eff._id && !VALID_ID_RE.test(eff._id)) {
    errors.push({ level: "error", path: `${path}._id`,
      msg: `Effect _id must be exactly 16 lowercase alphanumeric chars (got ${eff._id?.length})`,
      value: eff._id, fix: "Use foundry.utils.randomID(16)" });
  }

  if (Array.isArray(eff.changes)) {
    eff.changes.forEach((ch, i) => {
      if (!ch.key || typeof ch.key !== "string") {
        errors.push({ level: "error", path: `${path}.changes[${i}].key`,
          msg: "Effect change key is missing or not a string", value: ch.key });
      } else {
        errors.push(...validateEffectKey(ch.key, `${path}.changes[${i}].key`));
      }
      if (ch.mode === undefined || ch.mode === null) {
        errors.push({ level: "warn", path: `${path}.changes[${i}].mode`,
          msg: "Effect change mode is missing", value: ch.mode,
          fix: "0=Custom 1=Multiply 2=Add 3=Downgrade 4=Upgrade 5=Override" });
      }
    });
  }

  return errors;
}

function validateEffectKey(key, path) {
  const errors = [];
  // Basic attribute path structure check
  if (!key.startsWith("system.") && !key.startsWith("flags.") && !key.startsWith("name") && !key.startsWith("img")) {
    errors.push({ level: "warn", path,
      msg: "Unusual effect key prefix — expected system.*, flags.*, name, or img",
      value: key });
  }
  // Check for common typos
  const commonWrong = {
    "system.attribute.": "system.attributes.",
    "system.ability.":   "system.abilities.",
    "system.skill.":     "system.skills.",
    "system.bonuses.":   "system.bonuses.",
  };
  for (const [wrong, right] of Object.entries(commonWrong)) {
    if (key.startsWith(wrong)) {
      errors.push({ level: "error", path, msg: `Likely typo in effect key`, value: key,
        fix: `Did you mean: ${key.replace(wrong, right)}` });
    }
  }
  return errors;
}

/**
 * Basic roll formula validation.
 */
function validateFormula(formula, path) {
  const errors = [];
  if (typeof formula !== "string") {
    errors.push({ level: "error", path, msg: "Formula must be a string", value: formula });
    return errors;
  }
  // Check for @attribute paths and validate them
  const attrRefs = [...formula.matchAll(/@([\w.]+)/g)].map(m => m[1]);
  const knownBases = ["abilities","attributes","skills","details","traits","currency","spells","bonuses","scale"];
  for (const ref of attrRefs) {
    const base = ref.split(".")[0];
    if (!knownBases.includes(base)) {
      errors.push({ level: "warn", path, msg: `Unknown @attribute base in formula: @${ref}`, value: formula,
        fix: `Valid bases: ${knownBases.join(", ")}` });
    }
  }
  // Unbalanced brackets
  const opens  = (formula.match(/\[/g) ?? []).length;
  const closes = (formula.match(/\]/g) ?? []).length;
  if (opens !== closes) {
    errors.push({ level: "error", path, msg: "Unbalanced brackets in formula", value: formula });
  }
  return errors;
}

/**
 * Validate a full JSON string (array or single object).
 * @param {string} jsonStr
 * @returns {{ errors: ValidationError[], docCount: number }}
 */
function validateJSON(jsonStr) {
  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    return { errors: [{ level: "error", path: "root", msg: `JSON parse error: ${e.message}`, value: null }], docCount: 0 };
  }

  const docs   = Array.isArray(parsed) ? parsed : [parsed];
  const errors = [];
  docs.forEach((doc, i) => {
    const path = docs.length > 1 ? `[${i}] ${doc?.name ?? "unnamed"}` : (doc?.name ?? "root");
    errors.push(...validateDocument(doc, path));
  });

  WV.log("info", "Validator", `Validated ${docs.length} doc(s), ${errors.length} issue(s)`);
  return { errors, docCount: docs.length };
}

// ---------------------------------------------------------------------------
// Context pack generator
// ---------------------------------------------------------------------------

function generateContextPack() {
  const itemTypes  = getItemTypes();
  const actorTypes = getActorTypes();
  const activityTypes = getActivityTypes();
  const packs      = getCompendiumIndex();
  const mods       = [...game.modules.values()].filter(m => m.active).map(m => `${m.id}@${m.version}`);

  const itemSchemas = Object.fromEntries(itemTypes.map(t => {
    const s = introspectItemType(t);
    return [t, { samplePaths: s.paths.slice(0, 30), enums: s.enums }];
  }));

  const actorSchemas = Object.fromEntries(actorTypes.map(t => {
    const s = introspectActorType(t);
    return [t, { samplePaths: s.paths.slice(0, 30), enums: s.enums }];
  }));

  const lines = [
    `# Foundry VTT World Context Pack`,
    `# Generated: ${new Date().toISOString()}`,
    `# Foundry: v${game.version} | System: ${game.system.id} v${game.system.version}`,
    ``,
    `## CRITICAL RULES`,
    `- All \`_id\` fields must be EXACTLY 16 lowercase alphanumeric characters (a-z, 0-9 only).`,
    `- Example valid ID: \`cslaunch00000001\``,
    `- Example invalid: \`cslaunch0000001\` (15 chars), \`CSLaunch00000001\` (uppercase)`,
    `- Use \`foundry.utils.randomID(16)\` to generate IDs in macros/modules.`,
    `- Image paths use forward slashes, no leading slash, must exist in Foundry Data.`,
    `- Never invent compendium UUIDs. Use only pack IDs listed in ## Compendium Packs below.`,
    ``,
    `## System`,
    `\`\`\`json`,
    JSON.stringify({ foundry: game.version, system: game.system.id, systemVersion: game.system.version }, null, 2),
    `\`\`\``,
    ``,
    `## Active Modules`,
    mods.map(m => `- ${m}`).join("\n"),
    ``,
    `## Valid Item Types`,
    itemTypes.map(t => `- ${t}`).join("\n"),
    ``,
    `## Valid Actor Types`,
    actorTypes.map(t => `- ${t}`).join("\n"),
    ``,
    `## Valid Activity Types`,
    activityTypes.map(t => `- ${t}`).join("\n"),
    ``,
    `## Item Schemas (sample paths + enums)`,
    `\`\`\`json`,
    JSON.stringify(itemSchemas, null, 2),
    `\`\`\``,
    ``,
    `## Actor Schemas (sample paths + enums)`,
    `\`\`\`json`,
    JSON.stringify(actorSchemas, null, 2),
    `\`\`\``,
    ``,
    `## Compendium Packs`,
    `\`\`\`json`,
    JSON.stringify(packs, null, 2),
    `\`\`\``,
    ``,
    `## Effect Key Rules`,
    `- Keys must start with: system.*, flags.*, name, img`,
    `- Common mistakes: system.attribute. → system.attributes. | system.ability. → system.abilities.`,
    `- Effect modes: 0=Custom 1=Multiply 2=Add 3=Downgrade 4=Upgrade 5=Override`,
    ``,
    `## Formula @attribute Bases`,
    `- Valid: abilities, attributes, skills, details, traits, currency, spells, bonuses, scale`,
    `- Example: @abilities.str.mod | @attributes.ac.value | @scale.fighter.martial-arts.die`,
  ];

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Module error reporter
// ---------------------------------------------------------------------------

function buildErrorReport() {
  const grouped = {};
  for (const e of _errLog) {
    if (!grouped[e.source]) grouped[e.source] = [];
    grouped[e.source].push(e);
  }

  // Sort by frequency
  const sorted = Object.entries(grouped).sort((a, b) => b[1].length - a[1].length);

  const report = sorted.map(([source, entries]) => {
    const counts = {};
    for (const e of entries) {
      const key = e.msg.substring(0, 80);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return {
      source,
      total: entries.length,
      errors: entries.filter(e => e.level === "error").length,
      warns:  entries.filter(e => e.level === "warn").length,
      topMessages: Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([msg, count]) => ({ msg, count })),
      raw: entries.slice(-10),
    };
  });

  WV.log("info", "ErrorReport", `Built report: ${sorted.length} source(s), ${_errLog.length} total entries`);
  return report;
}

// ---------------------------------------------------------------------------
// Claude API for error analysis
// ---------------------------------------------------------------------------

async function analyzeWithClaude(report) {
  const key = game.settings.get(MODULE_ID, "apiKey");
  if (!key) throw new Error("No API key. Set it in Module Settings.");

  const context = `You are a Foundry VTT v13 / dnd5e v5 expert. Analyze these module errors and provide:
1. Which errors are harmless vs actively breaking something
2. The likely root cause for each module's errors
3. Suggested fixes where possible
4. Whether the error is a known compatibility issue

Be concise. Group by module. Flag if uncertain about attribution.`;

  const payload = report.map(r =>
    `## ${r.source} (${r.total} entries, ${r.errors} errors, ${r.warns} warnings)\n` +
    r.topMessages.map(m => `- [x${m.count}] ${m.msg}`).join("\n")
  ).join("\n\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: context,
      messages: [{ role: "user", content: payload }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message ?? `API error ${res.status}`);
  }
  const data = await res.json();
  return data.content?.find(b => b.type === "text")?.text ?? "(no response)";
}

// ---------------------------------------------------------------------------
// ApplicationV2 UI
// ---------------------------------------------------------------------------

const { ApplicationV2 } = foundry.applications.api;

class WorldValidator extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "world-validator",
    classes: ["world-validator"],
    window: { title: "Tiny's World Validator", resizable: true },
    position: { width: 920, height: 720 },
  };

  constructor() {
    super({});
    this._tab          = "validate";
    this._jsonInput    = "";
    this._validResult  = null;
    this._attrFilter   = "";
    this._attrType     = "all";
    this._attrSearch   = "";
    this._contextPack  = null;
    this._errReport    = null;
    this._errAnalysis  = null;
    this._errLoading   = false;
    this._errFilter    = "all";
  }

  async _renderHTML(context, options) {
    const el = document.createElement("div");
    el.classList.add("wv-wrap");
    el.innerHTML = this._build();
    return { main: el };
  }

  _replaceHTML(result, content, options) {
    this.element.querySelector(".window-content").replaceChildren(result.main);
    this._listen();
  }

  // ---- builders ------------------------------------------------------------

  _build() {
    const tabs = ["validate","attributes","context","errors"].map(id => {
      const labels = { validate:"Validate JSON", attributes:"Attribute Browser", context:"Context Pack", errors:"Module Errors" };
      const badges = { errors: _errLog.filter(e => e.level === "error").length || "" };
      return `<button class="wv-tab ${this._tab === id ? "active" : ""}" data-tab="${id}">
        ${labels[id]}${badges[id] ? ` <span class="wv-badge">${badges[id]}</span>` : ""}
      </button>`;
    }).join("");

    return `
      <div class="wv-tabs">${tabs}</div>
      <div class="wv-content">${this._buildTab()}</div>`;
  }

  _buildTab() {
    switch (this._tab) {
      case "validate":   return this._buildValidate();
      case "attributes": return this._buildAttributes();
      case "context":    return this._buildContext();
      case "errors":     return this._buildErrors();
    }
  }

  // ---- Validate tab --------------------------------------------------------

  _buildValidate() {
    const result = this._validResult;
    const errCount  = result?.errors.filter(e => e.level === "error").length ?? 0;
    const warnCount = result?.errors.filter(e => e.level === "warn").length  ?? 0;

    const errorRows = result?.errors.map(e => `
      <tr class="wv-err-row wv-err-${e.level}">
        <td class="wv-err-level">${e.level}</td>
        <td class="wv-err-path">${e.path}</td>
        <td class="wv-err-msg">${e.msg}${e.value !== undefined ? `<br><code class="wv-bad-val">${JSON.stringify(e.value)?.substring(0,60)}</code>` : ""}</td>
        <td class="wv-err-fix">${e.fix ?? ""}</td>
      </tr>`).join("") ?? "";

    return `
      <div class="wv-validate">
        <div class="wv-input-header">
          <span class="wv-hint">Paste JSON below or import a file. Validates against your live dnd5e install.</span>
          <label class="wv-file-label wv-btn wv-btn-secondary">
            Import File <input type="file" id="wv-import-file" accept=".json" style="display:none">
          </label>
        </div>
        <textarea id="wv-json-input" class="wv-json-input" placeholder='Paste item, actor, or array JSON here...' spellcheck="false">${this._jsonInput}</textarea>
        <div class="wv-validate-actions">
          <button id="wv-validate-btn" class="wv-btn">Validate</button>
          <button id="wv-clear-btn"    class="wv-btn wv-btn-secondary">Clear</button>
          ${result ? `
            <span class="wv-summary">
              ${result.docCount} doc(s) —
              <span class="wv-err-count">${errCount} error(s)</span>,
              <span class="wv-warn-count">${warnCount} warning(s)</span>
            </span>
            ${errCount === 0 && warnCount === 0 ? `<span class="wv-ok">✓ All clear</span>` : ""}
            <button id="wv-ai-fix-btn" class="wv-btn">Ask Claude to Fix</button>` : ""}
        </div>
        ${result?.errors.length ? `
          <div class="wv-table-wrap">
            <table class="wv-table">
              <thead><tr><th>Level</th><th>Path</th><th>Issue</th><th>Suggested Fix</th></tr></thead>
              <tbody>${errorRows}</tbody>
            </table>
          </div>` : ""}
        ${this._fixResult ? `
          <div class="wv-fix-result">
            <div class="wv-fix-header">
              <strong>Claude's Fix</strong>
              <button id="wv-copy-fix" class="wv-btn wv-btn-secondary">Copy</button>
              <button id="wv-use-fix"  class="wv-btn">Replace Input</button>
            </div>
            <textarea class="wv-json-input" readonly>${this._fixResult}</textarea>
          </div>` : ""}
      </div>`;
  }

  // ---- Attributes tab ------------------------------------------------------

  _buildAttributes() {
    const types    = ["all", ...getItemTypes(), ...getActorTypes().map(t => `actor:${t}`)];
    const typeOpts = types.map(t => `<option value="${t}" ${t === this._attrType ? "selected" : ""}>${t}</option>`).join("");

    let paths = [];
    if (this._attrType === "all") {
      getItemTypes().forEach(t => paths.push(...introspectItemType(t).paths.map(p => ({ path: p, type: t }))));
      getActorTypes().forEach(t => paths.push(...introspectActorType(t).paths.map(p => ({ path: p, type: `actor:${t}` }))));
    } else if (this._attrType.startsWith("actor:")) {
      const t = this._attrType.replace("actor:", "");
      paths = introspectActorType(t).paths.map(p => ({ path: p, type: this._attrType }));
    } else {
      paths = introspectItemType(this._attrType).paths.map(p => ({ path: p, type: this._attrType }));
    }

    // Deduplicate
    const seen = new Set();
    paths = paths.filter(p => { if (seen.has(p.path)) return false; seen.add(p.path); return true; });

    // Search filter
    const q = this._attrSearch.toLowerCase();
    if (q) paths = paths.filter(p => p.path.toLowerCase().includes(q));

    const rows = paths.slice(0, 200).map(p => `
      <tr class="wv-attr-row">
        <td class="wv-attr-path"><code>${p.path}</code></td>
        <td class="wv-attr-type">${p.type}</td>
        <td><button class="wv-attr-copy wv-icon-btn" data-val="${p.path}" title="Copy path">⎘</button>
            <button class="wv-attr-copy wv-icon-btn" data-val="@${p.path.replace("system.","")}" title="Copy as @attribute">@</button></td>
      </tr>`).join("");

    // Enums section
    let enumHtml = "";
    if (this._attrType !== "all") {
      const schema = this._attrType.startsWith("actor:")
        ? introspectActorType(this._attrType.replace("actor:", ""))
        : introspectItemType(this._attrType);
      const enumEntries = Object.entries(schema.enums);
      if (enumEntries.length) {
        enumHtml = `<div class="wv-enum-section">
          <strong>Valid Enum Values</strong>
          ${enumEntries.map(([key, vals]) => `
            <div class="wv-enum-row">
              <code class="wv-enum-key">${key}</code>
              <span class="wv-enum-vals">${vals.join(" · ")}</span>
            </div>`).join("")}
        </div>`;
      }
    }

    return `
      <div class="wv-attributes">
        <div class="wv-attr-controls">
          <select id="wv-attr-type">${typeOpts}</select>
          <input id="wv-attr-search" type="text" placeholder="Filter paths..." value="${this._attrSearch}">
          <span class="wv-hint">${paths.length} paths${paths.length > 200 ? " (showing first 200)" : ""}</span>
        </div>
        ${enumHtml}
        <div class="wv-table-wrap">
          <table class="wv-table">
            <thead><tr><th>Attribute Path</th><th>Sheet Type</th><th></th></tr></thead>
            <tbody>${rows || `<tr><td colspan="3" class="wv-empty">No paths found.</td></tr>`}</tbody>
          </table>
        </div>
      </div>`;
  }

  // ---- Context Pack tab ----------------------------------------------------

  _buildContext() {
    return `
      <div class="wv-context">
        <div class="wv-context-header">
          <p class="wv-hint">Generates a CLAUDE.md section with your live Foundry schema. Paste at the start of any Claude Code session.</p>
          <div class="wv-context-actions">
            <button id="wv-gen-context" class="wv-btn">Generate Context Pack</button>
            ${this._contextPack ? `<button id="wv-copy-context" class="wv-btn wv-btn-secondary">Copy to Clipboard</button>` : ""}
          </div>
        </div>
        ${this._contextPack
          ? `<textarea class="wv-context-output" readonly>${this._contextPack}</textarea>`
          : `<p class="wv-empty">Click Generate to build the context pack from your live install.</p>`}
      </div>`;
  }

  // ---- Module Errors tab ---------------------------------------------------

  _buildErrors() {
    const report  = this._errReport;
    const filters = ["all","error","warn"];
    const filterBtns = filters.map(f =>
      `<button class="wv-filter-btn ${this._errFilter === f ? "active" : ""}" data-filter="${f}">${f}</button>`
    ).join("");

    const reportHtml = report
      ? report.map(r => {
          const filtered = this._errFilter === "all" ? r.raw : r.raw.filter(e => e.level === this._errFilter);
          if (!filtered.length) return "";
          return `
            <div class="wv-err-module">
              <div class="wv-err-module-header">
                <strong>${r.source}</strong>
                <span class="wv-err-count">${r.errors} errors</span>
                <span class="wv-warn-count">${r.warns} warnings</span>
                <span class="wv-hint">${r.total} total</span>
              </div>
              <div class="wv-err-top">
                ${r.topMessages.map(m => `<div class="wv-err-freq">[x${m.count}] ${m.msg}</div>`).join("")}
              </div>
            </div>`;
        }).join("") ?? ""
      : `<p class="wv-empty">Click Scan to build the error report.</p>`;

    return `
      <div class="wv-errors">
        <div class="wv-err-controls">
          <button id="wv-scan-errors" class="wv-btn">Scan Errors</button>
          <button id="wv-clear-errors" class="wv-btn wv-btn-secondary">Clear Log</button>
          ${report ? `<button id="wv-analyze-errors" class="wv-btn" ${this._errLoading ? "disabled" : ""}>
            ${this._errLoading ? "Analyzing..." : "Ask Claude to Analyze"}
          </button>` : ""}
          <div class="wv-filter-row">${filterBtns}</div>
          <span class="wv-hint">${_errLog.length} entries logged since load</span>
        </div>
        <div class="wv-err-report">${reportHtml}</div>
        ${this._errAnalysis ? `
          <div class="wv-analysis">
            <div class="wv-analysis-header">
              <strong>Claude's Analysis</strong>
              <button id="wv-copy-analysis" class="wv-btn wv-btn-secondary">Copy</button>
            </div>
            <div class="wv-analysis-body">${this._md(this._errAnalysis)}</div>
          </div>` : ""}
      </div>`;
  }

  // ---- Listeners -----------------------------------------------------------

  _listen() {
    const el = this.element;

    el.querySelectorAll(".wv-tab").forEach(btn =>
      btn.addEventListener("click", () => { this._tab = btn.dataset.tab; this.render(); })
    );

    // Validate tab
    el.querySelector("#wv-validate-btn")?.addEventListener("click", () => {
      this._jsonInput   = el.querySelector("#wv-json-input")?.value ?? "";
      this._validResult = validateJSON(this._jsonInput);
      this._fixResult   = null;
      this.render();
    });
    el.querySelector("#wv-clear-btn")?.addEventListener("click", () => {
      this._jsonInput = ""; this._validResult = null; this._fixResult = null; this.render();
    });
    el.querySelector("#wv-import-file")?.addEventListener("change", async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      this._jsonInput   = await file.text();
      this._validResult = validateJSON(this._jsonInput);
      this._fixResult   = null;
      this.render();
    });
    el.querySelector("#wv-ai-fix-btn")?.addEventListener("click", () => this._aifix());
    el.querySelector("#wv-copy-fix")?.addEventListener("click",   () => {
      navigator.clipboard.writeText(this._fixResult ?? "");
      ui.notifications.info("Fixed JSON copied.");
    });
    el.querySelector("#wv-use-fix")?.addEventListener("click",    () => {
      this._jsonInput   = this._fixResult ?? "";
      this._validResult = validateJSON(this._jsonInput);
      this._fixResult   = null;
      this.render();
    });

    // Attributes tab
    el.querySelector("#wv-attr-type")?.addEventListener("change", e => { this._attrType = e.target.value; this.render(); });
    el.querySelector("#wv-attr-search")?.addEventListener("input", e => { this._attrSearch = e.target.value; this.render(); });
    el.querySelectorAll(".wv-attr-copy").forEach(btn =>
      btn.addEventListener("click", () => {
        navigator.clipboard.writeText(btn.dataset.val);
        ui.notifications.info(`Copied: ${btn.dataset.val}`);
      })
    );

    // Context tab
    el.querySelector("#wv-gen-context")?.addEventListener("click",  () => { this._contextPack = generateContextPack(); this.render(); });
    el.querySelector("#wv-copy-context")?.addEventListener("click", () => {
      navigator.clipboard.writeText(this._contextPack ?? "");
      ui.notifications.info("Context pack copied to clipboard.");
    });

    // Errors tab
    el.querySelector("#wv-scan-errors")?.addEventListener("click",  () => { this._errReport = buildErrorReport(); this.render(); });
    el.querySelector("#wv-clear-errors")?.addEventListener("click", () => { _errLog.length = 0; this._errReport = null; this._errAnalysis = null; this.render(); });
    el.querySelectorAll(".wv-filter-btn").forEach(btn =>
      btn.addEventListener("click", () => { this._errFilter = btn.dataset.filter; this.render(); })
    );
    el.querySelector("#wv-analyze-errors")?.addEventListener("click", () => this._analyzeErrors());
    el.querySelector("#wv-copy-analysis")?.addEventListener("click",  () => {
      navigator.clipboard.writeText(this._errAnalysis ?? "");
      ui.notifications.info("Analysis copied.");
    });
  }

  // ---- AI actions ----------------------------------------------------------

  async _aifix() {
    const key = game.settings.get(MODULE_ID, "apiKey");
    if (!key) { ui.notifications.error("No API key set in Module Settings."); return; }

    const errors  = this._validResult?.errors ?? [];
    const context = generateContextPack();
    const prompt  = `Fix the following JSON document to resolve all validation errors. Return ONLY the corrected JSON, no explanation.

Validation errors:
${errors.map(e => `- [${e.level}] ${e.path}: ${e.msg}${e.fix ? ` (fix: ${e.fix})` : ""}`).join("\n")}

Original JSON:
\`\`\`json
${this._jsonInput}
\`\`\``;

    WV.log("info", "AIFix", "Sending to Claude.");
    ui.notifications.info("Asking Claude to fix...");

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          system: context,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const data  = await res.json();
      const reply = data.content?.find(b => b.type === "text")?.text ?? "";
      const match = reply.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      this._fixResult = match ? match[1].trim() : reply.trim();
      this.render();
    } catch (e) {
      WV.log("error", "AIFix", "Failed:", e);
      ui.notifications.error(`AI fix failed: ${e.message}`);
    }
  }

  async _analyzeErrors() {
    if (!this._errReport) return;
    this._errLoading  = true;
    this._errAnalysis = null;
    await this.render();
    try {
      this._errAnalysis = await analyzeWithClaude(this._errReport);
    } catch (e) {
      WV.log("error", "Analyze", "Failed:", e);
      ui.notifications.error(`Analysis failed: ${e.message}`);
    }
    this._errLoading = false;
    await this.render();
  }

  _md(text) {
    return text
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/```[\s\S]*?```/g, m => `<pre class="wv-code">${m.replace(/```\w*\n?/g,"")}</pre>`)
      .replace(/`([^`]+)`/g,  "<code>$1</code>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/^## (.+)$/gm, "<h3>$1</h3>")
      .replace(/^# (.+)$/gm,  "<h2>$1</h2>")
      .replace(/^- (.+)$/gm,  "<li>$1</li>")
      .replace(/\n/g, "<br>");
  }
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function injectStyles() {
  if (document.getElementById("wv-styles")) return;
  const s = document.createElement("style");
  s.id = "wv-styles";
  s.textContent = `
    :root {
      --wv-bg:        #111318;
      --wv-bg2:       #1a1d24;
      --wv-bg3:       #22262f;
      --wv-border:    #2e3340;
      --wv-text:      #c8cdd8;
      --wv-dim:       #6b7280;
      --wv-accent:    #5a2d82;
      --wv-accent2:   #7a4da2;
      --wv-ok:        #1a3a1a;
      --wv-ok-text:   #7ddb7d;
      --wv-err:       #3a0d0d;
      --wv-err-text:  #db7d7d;
      --wv-warn:      #3a2a00;
      --wv-warn-text: #ddb97d;
      --wv-radius:    4px;
    }

    .world-validator .window-content { background:var(--wv-bg); color:var(--wv-text); padding:0; }
    .wv-wrap         { display:flex; flex-direction:column; height:100%; }
    .wv-tabs         { display:flex; gap:2px; padding:6px 8px 0; border-bottom:1px solid var(--wv-border); background:var(--wv-bg2); flex-shrink:0; }
    .wv-tab          { padding:5px 14px; border-radius:4px 4px 0 0; background:var(--wv-bg3); border:1px solid var(--wv-border); border-bottom:none; cursor:pointer; color:var(--wv-dim); font-size:0.85em; }
    .wv-tab:hover    { color:var(--wv-text); }
    .wv-tab.active   { background:var(--wv-bg); color:#fff; border-color:var(--wv-accent2); }
    .wv-badge        { background:var(--wv-err); color:var(--wv-err-text); border-radius:8px; padding:0 5px; font-size:0.8em; }
    .wv-content      { flex:1; overflow-y:auto; padding:12px; display:flex; flex-direction:column; gap:10px; }
    .wv-hint         { font-size:0.78em; color:var(--wv-dim); }
    .wv-empty        { color:var(--wv-dim); text-align:center; padding:20px 0; font-size:0.85em; }
    .wv-btn          { padding:5px 14px; border-radius:var(--wv-radius); background:var(--wv-accent); color:#fff; border:none; cursor:pointer; font-size:0.83em; white-space:nowrap; }
    .wv-btn:hover    { background:var(--wv-accent2); }
    .wv-btn:disabled { opacity:0.4; cursor:not-allowed; }
    .wv-btn-secondary { background:var(--wv-bg3); color:var(--wv-text); }
    .wv-btn-secondary:hover { background:var(--wv-border); }
    .wv-icon-btn     { background:none; border:none; cursor:pointer; color:var(--wv-dim); padding:0 4px; font-size:0.9em; }
    .wv-icon-btn:hover { color:var(--wv-text); }
    .wv-file-label   { cursor:pointer; display:inline-block; }
    .wv-table-wrap   { overflow:auto; flex:1; border:1px solid var(--wv-border); border-radius:var(--wv-radius); }
    .wv-table        { width:100%; border-collapse:collapse; font-size:0.81em; }
    .wv-table th     { background:var(--wv-bg2); padding:5px 8px; text-align:left; position:sticky; top:0; z-index:1; }
    .wv-table td     { padding:4px 8px; border-bottom:1px solid var(--wv-bg3); vertical-align:top; }
    .wv-filter-btn   { padding:2px 8px; border-radius:3px; background:var(--wv-bg3); border:1px solid var(--wv-border); color:var(--wv-dim); cursor:pointer; font-size:0.8em; }
    .wv-filter-btn.active { background:var(--wv-accent); border-color:var(--wv-accent2); color:#fff; }

    /* Validate */
    .wv-validate     { display:flex; flex-direction:column; gap:8px; height:100%; }
    .wv-input-header { display:flex; align-items:center; justify-content:space-between; }
    .wv-json-input   { width:100%; height:180px; font-family:monospace; font-size:0.78em; background:var(--wv-bg2); color:var(--wv-text); border:1px solid var(--wv-border); border-radius:var(--wv-radius); padding:8px; resize:vertical; }
    .wv-validate-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    .wv-summary      { font-size:0.82em; }
    .wv-err-count    { color:var(--wv-err-text); font-weight:bold; }
    .wv-warn-count   { color:var(--wv-warn-text); font-weight:bold; }
    .wv-ok           { color:var(--wv-ok-text); font-weight:bold; }
    .wv-err-row.wv-err-error td { background:var(--wv-err); }
    .wv-err-row.wv-err-warn  td { background:var(--wv-warn); }
    .wv-err-level    { font-weight:bold; text-transform:uppercase; font-size:0.75em; width:44px; }
    .wv-err-path     { font-family:monospace; font-size:0.8em; color:var(--wv-accent2); max-width:160px; word-break:break-all; }
    .wv-err-fix      { color:var(--wv-ok-text); font-size:0.8em; }
    .wv-bad-val      { color:var(--wv-err-text); font-size:0.85em; }
    .wv-fix-result   { display:flex; flex-direction:column; gap:6px; }
    .wv-fix-header   { display:flex; align-items:center; gap:8px; }
    .wv-code         { background:var(--wv-bg2); border:1px solid var(--wv-border); border-radius:3px; padding:4px 8px; font-size:0.78em; overflow-x:auto; white-space:pre; }

    /* Attributes */
    .wv-attributes   { display:flex; flex-direction:column; gap:8px; height:100%; }
    .wv-attr-controls { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
    .wv-attr-controls select,
    .wv-attr-controls input { background:var(--wv-bg3); color:var(--wv-text); border:1px solid var(--wv-border); border-radius:var(--wv-radius); padding:4px 7px; font-size:0.83em; }
    .wv-attr-controls input { flex:1; }
    .wv-attr-path code { font-size:0.85em; color:var(--wv-accent2); }
    .wv-attr-type    { color:var(--wv-dim); font-size:0.78em; }
    .wv-enum-section { background:var(--wv-bg2); border:1px solid var(--wv-border); border-radius:var(--wv-radius); padding:8px; display:flex; flex-direction:column; gap:5px; }
    .wv-enum-row     { display:flex; gap:10px; font-size:0.8em; align-items:baseline; }
    .wv-enum-key     { color:var(--wv-accent2); min-width:220px; }
    .wv-enum-vals    { color:var(--wv-dim); }

    /* Context */
    .wv-context      { display:flex; flex-direction:column; gap:8px; height:100%; }
    .wv-context-header { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; }
    .wv-context-actions { display:flex; gap:6px; flex-shrink:0; }
    .wv-context-output { flex:1; font-family:monospace; font-size:0.72em; background:var(--wv-bg2); color:var(--wv-text); border:1px solid var(--wv-border); border-radius:var(--wv-radius); padding:10px; resize:none; min-height:480px; }

    /* Errors */
    .wv-errors       { display:flex; flex-direction:column; gap:10px; }
    .wv-err-controls { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
    .wv-filter-row   { display:flex; gap:4px; }
    .wv-err-report   { display:flex; flex-direction:column; gap:8px; }
    .wv-err-module   { background:var(--wv-bg2); border:1px solid var(--wv-border); border-radius:var(--wv-radius); padding:10px; }
    .wv-err-module-header { display:flex; align-items:center; gap:10px; margin-bottom:6px; }
    .wv-err-freq     { font-family:monospace; font-size:0.78em; color:var(--wv-dim); padding:1px 0; }
    .wv-analysis     { display:flex; flex-direction:column; gap:6px; }
    .wv-analysis-header { display:flex; align-items:center; gap:10px; }
    .wv-analysis-body { background:var(--wv-bg2); border:1px solid var(--wv-border); border-radius:var(--wv-radius); padding:12px; font-size:0.85em; line-height:1.6; max-height:320px; overflow-y:auto; }
  `;
  document.head.appendChild(s);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

Hooks.once("init",  () => { registerSettings(); WV.log("info", "Init", "Module init."); });

Hooks.once("ready", () => {
  if (!game.user.isGM) return;
  injectStyles();

  game.modules.get(MODULE_ID).api = {
    open:             () => { injectStyles(); new WorldValidator().render({ force: true }); },
    validateJSON,
    generateContextPack,
    buildErrorReport,
    getItemTypes,
    getActorTypes,
    getActivityTypes,
    introspectItemType,
    introspectActorType,
    WV,
  };

  Hooks.on("renderSettings", (app, html) => {
    if (!game.user.isGM) return;
    const section = html.querySelector("#settings-game")
      ?? html.querySelector(".settings-list")
      ?? html.querySelector("section")
      ?? html;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Tiny's World Validator";
    btn.style.cssText = "margin-top:6px;width:100%;";
    btn.addEventListener("click", () => { injectStyles(); new WorldValidator().render({ force: true }); });
    section.appendChild(btn);
  });

  WV.log("info", "Ready", "World Validator ready.");
});
