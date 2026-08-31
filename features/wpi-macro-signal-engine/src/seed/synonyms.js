/**
 * PRD §5.1 synonym memory: verbatim trade name -> standard commodity name in
 * WPI vocabulary. Stage 1 output only — a name, never a code.
 *
 * Seeded from the prototype's table plus the terms the PRD names. Every LLM
 * resolution writes back here, so this table grows and the LLM cost per new
 * term is paid once ever.
 */
export const SEED_SYNONYMS = [
  ['laha', 'rapeseed & mustard seed'],
  ['lahi', 'rapeseed & mustard seed'],
  ['sarso', 'rapeseed & mustard seed'],
  ['sarson', 'rapeseed & mustard seed'],
  ['rai', 'rapeseed & mustard seed'],
  ['toria', 'rapeseed & mustard seed'],
  ['sarson tel', 'mustard oil'],
  ['kachi ghani', 'mustard oil'],
  ['khal', 'mustard oil cake'],
  ['khali', 'mustard oil cake'],
  ['oilcake', 'oil cake'],
  ['de oiled cake', 'oil cake'],
  ['doc', 'oil cake'],

  ['bardana', 'hessian sacking cloth'],
  ['bora', 'hessian sacking cloth'],
  ['bori', 'hessian sacking cloth'],
  ['gunny', 'hessian sacking cloth'],
  ['gunny bag', 'hessian sacking cloth'],
  ['hessian', 'hessian sacking cloth'],
  ['tin', 'tanks reservoirs and containers of metal'],
  ['empty tin', 'tanks reservoirs and containers of metal'],
  ['tin container', 'tanks reservoirs and containers of metal'],
  ['jar', 'plastic box containers'],
  ['dabba', 'plastic box containers'],
  ['bottle', 'plastic bottles'],
  ['box', 'paper products cardboard corrugated boxes'],
  ['carton', 'paper products cardboard corrugated boxes'],
  ['peti', 'paper products cardboard corrugated boxes'],

  ['dhaan', 'paddy'],
  ['dhan', 'paddy'],
  ['chawal', 'rice other than basmati'],
  ['kanki', 'rice broken'],
  ['nakku', 'rice broken'],
  ['broken rice', 'rice broken'],
  ['atta', 'wheat flour'],
  ['maida', 'wheat flour'],
  ['suji', 'wheat flour'],
  ['besan', 'gram flour'],
  ['channa', 'gram'],
  ['chana', 'gram'],
  ['gud', 'jaggery'],
  ['gur', 'jaggery'],
  ['cheeni', 'sugar'],
  ['shakkar', 'sugar'],
  ['ghee', 'vanaspati'],

  ['sariya', 'bars and rods of mild steel'],
  ['saria', 'bars and rods of mild steel'],
  ['rebar', 'bars and rods of mild steel'],
  ['tmt', 'bars and rods of mild steel'],
  ['tmt bar', 'bars and rods of mild steel'],
  ['loha', 'iron and steel'],
  ['patra', 'hot rolled steel coils sheets strips'],
  ['hr coil', 'hot rolled steel coils sheets strips'],
  ['cr coil', 'cold rolled steel coils sheets strips'],
  ['gp sheet', 'steel coated with zinc'],
  ['gc sheet', 'steel coated with zinc'],
  ['angle', 'hot rolled structural angles shapes sections'],
  ['channel', 'hot rolled structural angles shapes sections'],
  ['girder', 'hot rolled structural angles shapes sections'],
  ['scrap', 'scrap iron steel'],
  ['bhangar', 'scrap iron steel'],

  ['kapas', 'raw cotton'],
  ['rui', 'cotton'],
  ['suta', 'cotton yarn'],
  ['dhaga', 'cotton yarn'],

  ['diesel', 'high speed diesel'],
  ['hsd', 'high speed diesel'],
  ['petrol', 'petrol'],
  ['coyla', 'coal'],
  ['koyla', 'coal'],
  ['bijli', 'electricity'],
  ['freight', 'fuel and power'],
  ['bhada', 'fuel and power'],
];

/**
 * PRD §3.1 rule 2: packaging and consumables sitting in a raw-material
 * schedule are overheads, not the margin driver, so they are reclassified to
 * COST. Kept next to the synonyms because both are Stage 1 vocabulary.
 */
export const PACKAGING_KEYWORDS = Object.freeze([
  'bardana', 'bora', 'bori', 'gunny', 'hessian', 'sacking', 'bag', 'bags',
  'tin', 'jar', 'bottle', 'bottles', 'box', 'boxes', 'carton', 'peti',
  'drum', 'barrel', 'container', 'containers', 'packing', 'packaging',
  'label', 'sticker', 'cap', 'caps', 'pouch', 'wrapper', 'crate',
]);
