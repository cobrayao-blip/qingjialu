export type EntityType =
  | 'time'
  | 'practice'
  | 'actor'
  | 'place'
  | 'artifact'
  | 'source'
  | 'concept'
  | 'experience';
export type ConceptTag = string;
export type ExperienceTag = string;

export interface GraphEntity {
  id: string;
  label: string;
  type: EntityType;
  description?: string;
  meta?: Record<string, string>;
  conceptTags?: ConceptTag[];
  experienceTags?: ExperienceTag[];
}

export type RelationType =
  | 'occurs_in'
  | 'occurs_at'
  | 'performed_by'
  | 'uses'
  | 'documented_in'
  | 'related_to'
  | 'symbolizes'
  | 'regulates'
  | 'evokes'
  | 'associated_with';

export interface GraphRelation {
  source: string;
  target: string;
  relationType: RelationType;
  directed?: boolean;
  weight?: number;
  evidence?: string;
}

export interface CanonicalGraph {
  entities: GraphEntity[];
  relations: GraphRelation[];
}

export type LegacyViewType = 'month' | 'custom' | 'role';

export interface LegacyViewNode {
  id: string;
  label: string;
  type: LegacyViewType;
  description?: string;
  date?: string;
  location?: string;
  responsibility?: string;
  entityType: EntityType;
  conceptTags?: ConceptTag[];
  experienceTags?: ExperienceTag[];
}

export interface LegacyViewLink {
  source: string;
  target: string;
  relationType: RelationType;
}

export interface LegacyViewGraph {
  nodes: LegacyViewNode[];
  links: LegacyViewLink[];
}

/** 多视图预设 */
export type GraphViewPreset =
  | 'month_custom_role'
  | 'time_place_practice'
  | 'narrative_practice_concept_experience';

export type TppUiGroup = 'tpp_time' | 'tpp_place' | 'tpp_practice';
export type NarrativeUiGroup = 'narr_practice' | 'narr_concept' | 'narr_experience';

export interface TppViewNode {
  id: string;
  label: string;
  uiGroup: TppUiGroup;
  entityType: EntityType;
  description?: string;
  date?: string;
  location?: string;
  responsibility?: string;
  conceptTags?: ConceptTag[];
  experienceTags?: ExperienceTag[];
}

export interface NarrativeViewNode {
  id: string;
  label: string;
  uiGroup: NarrativeUiGroup;
  entityType: EntityType;
  description?: string;
  date?: string;
  location?: string;
  responsibility?: string;
  conceptTags?: ConceptTag[];
  experienceTags?: ExperienceTag[];
}

export interface NarrativeViewLink {
  source: string;
  target: string;
  relationType: RelationType;
}

export interface TppViewLink {
  source: string;
  target: string;
  relationType: RelationType;
}

export interface GraphSourceCitation {
  sourceId: string;
  title: string;
  quote?: string;
}

/** 图谱边筛选：全部关系类型（与 RelationType 一致） */
export const GRAPH_RELATION_TYPES: readonly RelationType[] = [
  'occurs_in',
  'occurs_at',
  'performed_by',
  'uses',
  'documented_in',
  'related_to',
  'symbolizes',
  'regulates',
  'evokes',
  'associated_with',
] as const;

export interface GraphNeighborRelation {
  relationType: RelationType;
  direction: 'out' | 'in';
  neighborId: string;
  neighborLabel: string;
  neighborEntityType: EntityType;
}

export interface GraphSliceOptions {
  entityTypes?: EntityType[];
  relationTypes?: RelationType[];
}

/** 以月份（time.label）筛出当月相关子图：月份节点 + 当月活动 + 活动一跳邻居 */
export function sliceCanonicalGraphByMonthLabel(graph: CanonicalGraph, monthLabel?: string): CanonicalGraph {
  const label = (monthLabel || '').trim();
  if (!label) return graph;
  const monthEntity = graph.entities.find((e) => e.type === 'time' && e.label === label);
  if (!monthEntity) return { entities: [], relations: [] };

  const monthId = monthEntity.id;
  const practiceIds = new Set(
    graph.relations
      .filter((r) => r.relationType === 'occurs_in' && r.source === monthId)
      .map((r) => r.target)
  );
  if (practiceIds.size === 0) {
    return { entities: [monthEntity], relations: [] };
  }

  const includeIds = new Set<string>([monthId, ...practiceIds]);
  for (const r of graph.relations) {
    if (practiceIds.has(r.source)) includeIds.add(r.target);
    if (practiceIds.has(r.target)) includeIds.add(r.source);
  }
  const entities = graph.entities.filter((e) => includeIds.has(e.id));
  const idSet = new Set(entities.map((e) => e.id));
  const relations = graph.relations.filter((r) => idSet.has(r.source) && idSet.has(r.target));
  return { entities, relations };
}

// 图谱数据已迁移到 server/data/folklore-graph.v1.json，
// 前端仅保留空兜底，避免在代码中硬编码大对象。
const CANONICAL_GRAPH: CanonicalGraph = {
  entities: [],
  relations: [],
};

const LEGACY_NODE_TYPE_MAP: Record<EntityType, LegacyViewType | null> = {
  time: 'month',
  practice: 'custom',
  actor: 'role',
  place: null,
  artifact: null,
  source: null,
  concept: null,
  experience: null,
};

export function getCanonicalGraph(): CanonicalGraph {
  return CANONICAL_GRAPH;
}

/** 按实体类型/关系类型切出子图；若不传某项则视为不过滤该维度 */
export function sliceCanonicalGraph(graph: CanonicalGraph, options?: GraphSliceOptions): CanonicalGraph {
  const entityTypeSet = options?.entityTypes?.length ? new Set(options.entityTypes) : null;
  const relationTypeSet = options?.relationTypes?.length ? new Set(options.relationTypes) : null;

  const entities = entityTypeSet
    ? graph.entities.filter((e) => entityTypeSet.has(e.type))
    : graph.entities;
  const entityIds = new Set(entities.map((e) => e.id));

  const relations = graph.relations.filter((r) => {
    if (relationTypeSet && !relationTypeSet.has(r.relationType)) return false;
    return entityIds.has(r.source) && entityIds.has(r.target);
  });

  return { entities, relations };
}

export function getPresetSliceOptions(preset: GraphViewPreset): GraphSliceOptions {
  if (preset === 'time_place_practice') {
    return {
      entityTypes: ['time', 'place', 'practice', 'source'],
      relationTypes: ['occurs_in', 'occurs_at', 'documented_in'],
    };
  }
  if (preset === 'narrative_practice_concept_experience') {
    return {
      entityTypes: ['practice', 'concept', 'experience', 'source'],
      relationTypes: ['symbolizes', 'regulates', 'evokes', 'associated_with', 'documented_in'],
    };
  }
  return {
    entityTypes: ['time', 'practice', 'actor', 'source'],
    relationTypes: ['occurs_in', 'related_to', 'performed_by', 'documented_in'],
  };
}

function entityByIdMap(graph: CanonicalGraph): Map<string, GraphEntity> {
  return new Map(graph.entities.map((e) => [e.id, e]));
}

/** 与当前实体直接相连的所有边（全图语义，不限于当前画布投影） */
export function listNeighborRelations(graph: CanonicalGraph, entityId: string): GraphNeighborRelation[] {
  const byId = entityByIdMap(graph);
  const rows: GraphNeighborRelation[] = [];
  for (const r of graph.relations) {
    if (r.source === entityId) {
      const n = byId.get(r.target);
      if (n) {
        rows.push({
          relationType: r.relationType,
          direction: 'out',
          neighborId: n.id,
          neighborLabel: n.label,
          neighborEntityType: n.type,
        });
      }
    } else if (r.target === entityId) {
      const n = byId.get(r.source);
      if (n) {
        rows.push({
          relationType: r.relationType,
          direction: 'in',
          neighborId: n.id,
          neighborLabel: n.label,
          neighborEntityType: n.type,
        });
      }
    }
  }
  return rows;
}

function sourceEntityByIdMap(graph: CanonicalGraph): Map<string, GraphEntity> {
  return new Map(graph.entities.filter((e) => e.type === 'source').map((e) => [e.id, e]));
}

function citationFromSourceEntity(entity: GraphEntity): GraphSourceCitation {
  return {
    sourceId: entity.meta?.sectionId || entity.id,
    title: entity.label,
    quote: entity.meta?.quote,
  };
}

/** 某实体作为 documented_in 的 source 时，直接挂接的来源（常用于 practice，也可用于 time 等） */
function listDirectDocumentedInFrom(graph: CanonicalGraph, fromEntityId: string): GraphSourceCitation[] {
  const sourceById = sourceEntityByIdMap(graph);
  return graph.relations
    .filter((r) => r.relationType === 'documented_in' && r.source === fromEntityId)
    .map((r) => sourceById.get(r.target))
    .filter((e): e is GraphEntity => Boolean(e))
    .map(citationFromSourceEntity);
}

/**
 * 按实体聚合「来源依据」：
 * - practice：直接 documented_in
 * - time：经 occurs_in（月→俗）收集下属习俗的来源并去重
 * - actor：经 performed_by（俗→人，边为 practice→actor）及 optional related_to 连到月份后再展开
 * - place：经 occurs_at（俗→地）
 * - artifact：经 uses（俗→物）
 * - source：自身一条
 */
export function listSourceCitationsForEntity(graph: CanonicalGraph, entityId: string): GraphSourceCitation[] {
  const byId = entityByIdMap(graph);
  const entity = byId.get(entityId);
  if (!entity) return [];

  if (entity.type === 'source') {
    return [citationFromSourceEntity(entity)];
  }

  const practiceIds = new Set<string>();

  if (entity.type === 'practice') {
    practiceIds.add(entityId);
  } else if (entity.type === 'time') {
    for (const r of graph.relations) {
      if (r.source === entityId && r.relationType === 'occurs_in') practiceIds.add(r.target);
    }
  } else if (entity.type === 'actor') {
    for (const r of graph.relations) {
      if (r.relationType === 'performed_by' && r.target === entityId) practiceIds.add(r.source);
    }
    for (const r of graph.relations) {
      if (r.relationType !== 'related_to') continue;
      const other = r.source === entityId ? r.target : r.target === entityId ? r.source : null;
      if (!other) continue;
      const neighbor = byId.get(other);
      if (neighbor?.type !== 'time') continue;
      for (const r2 of graph.relations) {
        if (r2.source === other && r2.relationType === 'occurs_in') practiceIds.add(r2.target);
      }
    }
  } else if (entity.type === 'place') {
    for (const r of graph.relations) {
      if (r.relationType === 'occurs_at' && r.target === entityId) practiceIds.add(r.source);
    }
  } else if (entity.type === 'artifact') {
    for (const r of graph.relations) {
      if (r.relationType === 'uses' && r.target === entityId) practiceIds.add(r.source);
    }
  } else if (entity.type === 'concept') {
    for (const r of graph.relations) {
      if (r.relationType === 'symbolizes' && r.target === entityId) practiceIds.add(r.source);
      if (r.relationType === 'regulates' && r.source === entityId) practiceIds.add(r.target);
    }
  } else if (entity.type === 'experience') {
    for (const r of graph.relations) {
      if (r.relationType === 'evokes' && r.target === entityId) practiceIds.add(r.source);
    }
  } else {
    return [];
  }

  const citationsByKey = new Map<string, GraphSourceCitation>();
  if (entity.type === 'time') {
    for (const c of listDirectDocumentedInFrom(graph, entityId)) {
      citationsByKey.set(c.sourceId, c);
    }
  }
  for (const pid of practiceIds) {
    const p = byId.get(pid);
    if (p?.type !== 'practice') continue;
    for (const c of listDirectDocumentedInFrom(graph, pid)) {
      citationsByKey.set(c.sourceId, c);
    }
  }
  return [...citationsByKey.values()];
}

/**
 * 轻量语义层（概念/体验）：
 * - 优先返回实体自身 tags
 * - 对 time/actor/place/artifact 可经 practice 聚合 tags，支持探索模式详情展示与工作台检索前置
 */
export function listNarrativeTagsForEntity(
  graph: CanonicalGraph,
  entityId: string
): { conceptTags: ConceptTag[]; experienceTags: ExperienceTag[] } {
  const byId = entityByIdMap(graph);
  const entity = byId.get(entityId);
  if (!entity) return { conceptTags: [], experienceTags: [] };

  const conceptSet = new Set(entity.conceptTags ?? []);
  const expSet = new Set(entity.experienceTags ?? []);
  const practiceIds = new Set<string>();

  if (entity.type === 'practice') {
    practiceIds.add(entity.id);
  } else if (entity.type === 'time') {
    for (const r of graph.relations) {
      if (r.relationType === 'occurs_in' && r.source === entity.id) practiceIds.add(r.target);
    }
  } else if (entity.type === 'actor') {
    for (const r of graph.relations) {
      if (r.relationType === 'performed_by' && r.target === entity.id) practiceIds.add(r.source);
    }
  } else if (entity.type === 'place') {
    for (const r of graph.relations) {
      if (r.relationType === 'occurs_at' && r.target === entity.id) practiceIds.add(r.source);
    }
  } else if (entity.type === 'artifact') {
    for (const r of graph.relations) {
      if (r.relationType === 'uses' && r.target === entity.id) practiceIds.add(r.source);
    }
  } else if (entity.type === 'concept') {
    for (const r of graph.relations) {
      if (r.relationType === 'symbolizes' && r.target === entity.id) practiceIds.add(r.source);
      if (r.relationType === 'regulates' && r.source === entity.id) practiceIds.add(r.target);
    }
  } else if (entity.type === 'experience') {
    for (const r of graph.relations) {
      if (r.relationType === 'evokes' && r.target === entity.id) practiceIds.add(r.source);
    }
  }

  for (const pid of practiceIds) {
    const p = byId.get(pid);
    if (!p || p.type !== 'practice') continue;
    for (const t of p.conceptTags ?? []) conceptSet.add(t);
    for (const t of p.experienceTags ?? []) expSet.add(t);
  }

  return {
    conceptTags: [...conceptSet],
    experienceTags: [...expSet],
  };
}

export function buildLegacyMonthCustomRoleView(graph: CanonicalGraph): LegacyViewGraph {
  const nodes = graph.entities
    .map<LegacyViewNode | null>((entity) => {
      const mappedType = LEGACY_NODE_TYPE_MAP[entity.type];
      if (!mappedType) return null;
      return {
        id: entity.id,
        label: entity.label,
        type: mappedType,
        description: entity.description,
        date: entity.meta?.date,
        location: entity.meta?.location,
        responsibility: entity.meta?.responsibility,
        entityType: entity.type,
        conceptTags: entity.conceptTags,
        experienceTags: entity.experienceTags,
      };
    })
    .filter((item): item is LegacyViewNode => item !== null);

  const visibleIds = new Set(nodes.map((n) => n.id));
  const links = graph.relations
    .filter((relation) => visibleIds.has(relation.source) && visibleIds.has(relation.target))
    .map<LegacyViewLink>((relation) => ({
      source: relation.source,
      target: relation.target,
      relationType: relation.relationType,
    }));

  return { nodes, links };
}

const TPP_ENTITY_TYPES: EntityType[] = ['time', 'place', 'practice'];

/**
 * 「时令 · 地点 · 活动」视图：仅 time / place / practice，边仅 occurs_in（月→俗）与 occurs_at（俗→地）。
 */
export function buildTimePlacePracticeView(graph: CanonicalGraph): { nodes: TppViewNode[]; links: TppViewLink[] } {
  const nodes: TppViewNode[] = graph.entities
    .filter((e) => TPP_ENTITY_TYPES.includes(e.type))
    .map((entity) => {
      const uiGroup: TppUiGroup =
        entity.type === 'time' ? 'tpp_time' : entity.type === 'place' ? 'tpp_place' : 'tpp_practice';
      return {
        id: entity.id,
        label: entity.label,
        uiGroup,
        entityType: entity.type,
        description: entity.description,
        date: entity.meta?.date,
        location: entity.meta?.location,
        responsibility: entity.meta?.responsibility,
        conceptTags: entity.conceptTags,
        experienceTags: entity.experienceTags,
      };
    });

  const idSet = new Set(nodes.map((n) => n.id));
  const links: TppViewLink[] = graph.relations
    .filter(
      (r) =>
        (r.relationType === 'occurs_in' || r.relationType === 'occurs_at') &&
        idSet.has(r.source) &&
        idSet.has(r.target)
    )
    .map((r) => ({
      source: r.source,
      target: r.target,
      relationType: r.relationType,
    }));

  return { nodes, links };
}

const NARRATIVE_ENTITY_TYPES: EntityType[] = ['practice', 'concept', 'experience'];

/** 「活动 · 概念 · 体验」叙事视图 */
export function buildNarrativePracticeConceptExperienceView(
  graph: CanonicalGraph
): { nodes: NarrativeViewNode[]; links: NarrativeViewLink[] } {
  const nodes: NarrativeViewNode[] = graph.entities
    .filter((e) => NARRATIVE_ENTITY_TYPES.includes(e.type))
    .map((entity) => {
      const uiGroup: NarrativeUiGroup =
        entity.type === 'practice'
          ? 'narr_practice'
          : entity.type === 'concept'
            ? 'narr_concept'
            : 'narr_experience';
      return {
        id: entity.id,
        label: entity.label,
        uiGroup,
        entityType: entity.type,
        description: entity.description,
        conceptTags: entity.conceptTags,
        experienceTags: entity.experienceTags,
      };
    });

  const idSet = new Set(nodes.map((n) => n.id));
  const links: NarrativeViewLink[] = graph.relations
    .filter(
      (r) =>
        (r.relationType === 'symbolizes' ||
          r.relationType === 'regulates' ||
          r.relationType === 'evokes' ||
          r.relationType === 'associated_with') &&
        idSet.has(r.source) &&
        idSet.has(r.target)
    )
    .map((r) => ({
      source: r.source,
      target: r.target,
      relationType: r.relationType,
    }));

  return { nodes, links };
}

export function isTppViewNode(node: LegacyViewNode | TppViewNode): node is TppViewNode {
  return 'uiGroup' in node;
}
