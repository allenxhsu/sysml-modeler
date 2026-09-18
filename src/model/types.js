// The vocabulary: element kinds, relationship kinds, diagram kinds, and the
// rules about what may own or connect to what. UI palettes, validation and
// XMI all read these tables, so a new kind is added in one place.

export const FORMAT = 'sysml-modeler';
export const FORMAT_VERSION = 1;

/** `feature` kinds live inside a block and never get a symbol of their own on a bdd. */
export const ELEMENT_KINDS = {
  package:     { label: 'Package',     stereotype: null,          icon: 'pk' },
  block:       { label: 'Block',       stereotype: 'block',       icon: 'bl' },
  valueType:   { label: 'Value type',  stereotype: 'valueType',   icon: 'vt' },
  requirement: { label: 'Requirement', stereotype: 'requirement', icon: 'rq' },
  testCase:    { label: 'Test case',   stereotype: 'testCase',    icon: 'tc' },
  actor:       { label: 'Actor',       stereotype: null,          icon: 'ac' },
  useCase:     { label: 'Use case',    stereotype: null,          icon: 'uc' },
  comment:     { label: 'Note',        stereotype: null,          icon: 'cm' },
  property:    { label: 'Property',    stereotype: null,          icon: 'pr', feature: true },
  port:        { label: 'Port',        stereotype: null,          icon: 'po', feature: true },
  operation:   { label: 'Operation',   stereotype: null,          icon: 'op', feature: true },
};

export const PROP_KINDS = { value: 'Value', part: 'Part', reference: 'Reference' };
export const PORT_DIRECTIONS = ['inout', 'in', 'out'];

const PACKAGEABLE = ['package', 'block', 'valueType', 'requirement', 'testCase', 'actor', 'useCase', 'comment'];
const OWNS = {
  package: PACKAGEABLE,
  block: ['property', 'port', 'operation'],
  valueType: ['property'],
  requirement: ['requirement'],
};
export const canOwn = (ownerKind, childKind) => (OWNS[ownerKind] || []).includes(childKind);
/** Things that can own a diagram in the containment tree. */
export const canOwnDiagram = (kind) => kind === 'package' || kind === 'block';

const CLASSIFIERS = ['block', 'valueType', 'actor', 'useCase', 'requirement', 'testCase'];
const ANY = [...PACKAGEABLE];

/**
 * line: solid | dashed.  head/tail: marker at the target / source end.
 * `derived` kinds are not stored as relationships — see model.resolveEdge().
 */
export const REL_KINDS = {
  association:    { label: 'Association',    line: 'solid',  head: 'none',     source: ['block', 'actor', 'useCase'], target: ['block', 'actor', 'useCase'] },
  generalization: { label: 'Generalization', line: 'solid',  head: 'triangle', source: CLASSIFIERS, target: CLASSIFIERS, sameKind: true },
  dependency:     { label: 'Dependency',     line: 'dashed', head: 'open',     source: ANY, target: ANY },
  satisfy:        { label: 'Satisfy',        line: 'dashed', head: 'open', stereotype: 'satisfy',    source: ['block', 'valueType', 'useCase', 'actor', 'package'], target: ['requirement'] },
  verify:         { label: 'Verify',         line: 'dashed', head: 'open', stereotype: 'verify',     source: ['testCase', 'block', 'useCase'], target: ['requirement'] },
  deriveReqt:     { label: 'Derive',         line: 'dashed', head: 'open', stereotype: 'deriveReqt', source: ['requirement'], target: ['requirement'] },
  refine:         { label: 'Refine',         line: 'dashed', head: 'open', stereotype: 'refine',     source: ANY, target: ANY },
  trace:          { label: 'Trace',          line: 'dashed', head: 'open', stereotype: 'trace',      source: ANY, target: ANY },
  allocate:       { label: 'Allocate',       line: 'dashed', head: 'open', stereotype: 'allocate',   source: ANY, target: ANY },
  include:        { label: 'Include',        line: 'dashed', head: 'open', stereotype: 'include',    source: ['useCase'], target: ['useCase'] },
  extend:         { label: 'Extend',         line: 'dashed', head: 'open', stereotype: 'extend',     source: ['useCase'], target: ['useCase'] },
  connector:      { label: 'Connector',      line: 'solid',  head: 'none',     source: ['property'], target: ['property'] },
  // derived
  composition:    { label: 'Composition',    line: 'solid',  tail: 'diamond',  head: 'none', derived: true, source: ['block'], target: ['block'] },
  reference:      { label: 'Reference',      line: 'solid',  tail: 'diamond-open', head: 'open', derived: true, source: ['block'], target: ['block'] },
  containment:    { label: 'Containment',    line: 'solid',  tail: 'crosshair', head: 'none', derived: true, source: ['package', 'requirement'], target: ANY },
};

export function endsAllowed(relKind, sourceKind, targetKind) {
  const k = REL_KINDS[relKind];
  if (!k) return false;
  if (!k.source.includes(sourceKind) || !k.target.includes(targetKind)) return false;
  if (k.sameKind && sourceKind !== targetKind) return false;
  if (relKind === 'containment') return canOwn(sourceKind, targetKind);
  return true;
}

export const DIAGRAM_KINDS = {
  bdd: { label: 'Block definition diagram', abbr: 'bdd',
    nodes: ['block', 'valueType', 'actor', 'package', 'comment'],
    paths: ['composition', 'reference', 'association', 'generalization', 'dependency', 'allocate'] },
  ibd: { label: 'Internal block diagram', abbr: 'ibd', needsContext: true,
    nodes: ['part', 'refpart', 'port', 'comment'],
    paths: ['connector'] },
  req: { label: 'Requirement diagram', abbr: 'req',
    nodes: ['requirement', 'testCase', 'block', 'package', 'comment'],
    paths: ['containment', 'deriveReqt', 'satisfy', 'verify', 'refine', 'trace'] },
  uc: { label: 'Use case diagram', abbr: 'uc',
    nodes: ['actor', 'useCase', 'block', 'comment'],
    paths: ['association', 'include', 'extend', 'generalization'] },
  pkg: { label: 'Package diagram', abbr: 'pkg',
    nodes: ['package', 'block', 'comment'],
    paths: ['containment', 'dependency'] },
  // generated views — no canvas
  reqtable: { label: 'Requirement table', abbr: 'table', view: true },
  matrix:   { label: 'Dependency matrix', abbr: 'matrix', view: true },
};

/** Palette labels for node tools that are not plain element kinds. */
export const NODE_TOOL_LABELS = { part: 'Part', refpart: 'Reference', port: 'Port' };

/** Relationship kinds a matrix can be built on, with its usual row → column kinds. */
export const MATRIX_PRESETS = {
  satisfy:    { rows: 'block',       cols: 'requirement' },
  verify:     { rows: 'testCase',    cols: 'requirement' },
  deriveReqt: { rows: 'requirement', cols: 'requirement' },
  refine:     { rows: 'useCase',     cols: 'requirement' },
  allocate:   { rows: 'useCase',     cols: 'block' },
  trace:      { rows: 'requirement', cols: 'requirement' },
  dependency: { rows: 'package',     cols: 'package' },
};

export const LEVELS = ['error', 'warning', 'info'];
