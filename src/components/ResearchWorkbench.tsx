import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, Download, Filter, Search, Tag } from 'lucide-react';
import { getFolkloreEvidenceMetrics, getFolkloreGraph } from '../services/api';
import {
  GRAPH_RELATION_TYPES,
  listNarrativeTagsForEntity,
  listSourceCitationsForEntity,
  type CanonicalGraph,
  type EntityType,
  type GraphEntity,
  type RelationType,
} from '../graph/folkloreGraphModel';

type Props = {
  onOpenQjlSection?: (id: string, highlightQuote?: string | null, chapterTitle?: string | null) => void | Promise<void>;
  month?: string;
};
type SortMode = 'evidence_desc' | 'name_asc' | 'type_then_name';
type SavedQuery = {
  id: string;
  name: string;
  keyword: string;
  monthFilter: string;
  entityTypeFilter: EntityType[];
  selectedConceptTags: string[];
  selectedExperienceTags: string[];
  sortMode: SortMode;
};
const QUERY_STORAGE_KEY = 'qingjialu.research.workbench.query.v1';
const LEGACY_QUERY_STORAGE_KEY = 'qingjialu.research.workbench.query.v1';
const QUERY_LIST_STORAGE_KEY = 'qingjialu.research.workbench.queries.v1';

const ENTITY_LABEL: Record<EntityType, string> = {
  time: '时令',
  practice: '活动',
  actor: '人物',
  place: '地点',
  artifact: '物件',
  source: '文献',
  concept: '概念',
  experience: '体验',
};
const RELATION_LABEL: Record<string, string> = {
  occurs_in: '发生于',
  occurs_at: '发生在',
  performed_by: '参与者',
  uses: '使用',
  documented_in: '文献依据',
  related_to: '相关',
  symbolizes: '象征',
  regulates: '规范',
  evokes: '唤起',
  associated_with: '关联',
};

function chapterTitleForQjlLookup(title: string): string {
  return title.replace(/^《[^》]+》[·・]\s*/u, '').trim() || title;
}

function exportTextFile(filename: string, content: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ResearchWorkbench({ onOpenQjlSection, month }: Props) {
  const [graph, setGraph] = useState<CanonicalGraph | null>(null);
  const [evidenceMetrics, setEvidenceMetrics] = useState<{
    totalRelations: number;
    requiredRelations: number;
    withEvidence: number;
    pending: number;
    coverage: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [monthFilter, setMonthFilter] = useState('');
  const [entityTypeFilter, setEntityTypeFilter] = useState<EntityType[]>([
    'time',
    'practice',
    'actor',
    'place',
    'artifact',
    'concept',
    'experience',
  ]);
  const [selectedConceptTags, setSelectedConceptTags] = useState<string[]>([]);
  const [selectedExperienceTags, setSelectedExperienceTags] = useState<string[]>([]);
  const [selectedRelationTypes, setSelectedRelationTypes] = useState<RelationType[]>(() => [...GRAPH_RELATION_TYPES]);
  const [sortMode, setSortMode] = useState<SortMode>('evidence_desc');
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [basketIds, setBasketIds] = useState<string[]>([]);
  const [showBasketPanel, setShowBasketPanel] = useState(false);
  const [onlyPendingRelated, setOnlyPendingRelated] = useState(false);
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
  const [activeQueryId, setActiveQueryId] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getFolkloreGraph()
      .then((res) => {
        if (cancelled) return;
        if (!res) {
          setError('图谱数据暂不可用，请确认后端服务已启动。');
          return;
        }
        setGraph(res);
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError('加载研究工作台数据失败。');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    void getFolkloreEvidenceMetrics()
      .then((res) => {
        if (cancelled) return;
        if (res) setEvidenceMetrics(res);
      })
      .catch(() => {
        /* ignore metrics errors */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!month?.trim()) return;
    setMonthFilter(month.trim());
  }, [month]);

  const applySavedQuery = (parsed: Partial<SavedQuery>) => {
    if (typeof parsed.keyword === 'string') setKeyword(parsed.keyword);
    if (typeof parsed.monthFilter === 'string') setMonthFilter(parsed.monthFilter);
    if (Array.isArray(parsed.entityTypeFilter) && parsed.entityTypeFilter.length > 0) {
      setEntityTypeFilter(parsed.entityTypeFilter.filter(Boolean) as EntityType[]);
    }
    if (Array.isArray(parsed.selectedConceptTags)) setSelectedConceptTags(parsed.selectedConceptTags.filter(Boolean));
    if (Array.isArray(parsed.selectedExperienceTags)) setSelectedExperienceTags(parsed.selectedExperienceTags.filter(Boolean));
    if (parsed.sortMode === 'evidence_desc' || parsed.sortMode === 'name_asc' || parsed.sortMode === 'type_then_name') {
      setSortMode(parsed.sortMode);
    }
  };

  useEffect(() => {
    try {
      const rawList = localStorage.getItem(QUERY_LIST_STORAGE_KEY);
      if (rawList) {
        const parsedList = JSON.parse(rawList) as SavedQuery[];
        if (Array.isArray(parsedList) && parsedList.length > 0) {
          setSavedQueries(parsedList);
          setActiveQueryId(parsedList[0].id);
          applySavedQuery(parsedList[0]);
          return;
        }
      }
      const legacyRaw = localStorage.getItem(LEGACY_QUERY_STORAGE_KEY);
      if (legacyRaw) {
        const legacyParsed = JSON.parse(legacyRaw) as Partial<SavedQuery>;
        applySavedQuery(legacyParsed);
      }
    } catch {
      /* ignore broken local data */
    }
  }, []);

  const entities = graph?.entities ?? [];
  const relations = graph?.relations ?? [];

  const monthOptions = useMemo(
    () => entities.filter((e) => e.type === 'time').map((e) => e.label),
    [entities]
  );

  const allConceptTags = useMemo(() => {
    const tags = new Set<string>();
    if (!graph) return [] as string[];
    for (const e of graph.entities) {
      const merged = listNarrativeTagsForEntity(graph, e.id).conceptTags;
      for (const t of merged) tags.add(t);
    }
    return [...tags].sort((a, b) => a.localeCompare(b, 'zh'));
  }, [graph]);

  const allExperienceTags = useMemo(() => {
    const tags = new Set<string>();
    if (!graph) return [] as string[];
    for (const e of graph.entities) {
      const merged = listNarrativeTagsForEntity(graph, e.id).experienceTags;
      for (const t of merged) tags.add(t);
    }
    return [...tags].sort((a, b) => a.localeCompare(b, 'zh'));
  }, [graph]);

  const monthPracticeIds = useMemo(() => {
    if (!monthFilter || !graph) return null;
    const monthEntity = entities.find((e) => e.type === 'time' && e.label === monthFilter);
    if (!monthEntity) return null;
    return new Set(
      relations
        .filter((r) => r.relationType === 'occurs_in' && r.source === monthEntity.id)
        .map((r) => r.target)
    );
  }, [monthFilter, graph, entities, relations]);

  const relationTypeOptions = useMemo(
    () => [...new Set(relations.map((r) => r.relationType).filter(Boolean))] as RelationType[],
    [relations]
  );

  const pendingRelations = useMemo(() => {
    if (!graph) return [] as Array<{
      sourceId: string;
      sourceLabel: string;
      targetId: string;
      targetLabel: string;
      relationType: string;
      evidence: string;
    }>;
    const byId = new Map(graph.entities.map((e) => [e.id, e]));
    return graph.relations
      .filter((r) => r.relationType !== 'related_to' && (r.evidence || '').trim() === '待考')
      .map((r) => ({
        sourceId: r.source,
        sourceLabel: byId.get(r.source)?.label || r.source,
        targetId: r.target,
        targetLabel: byId.get(r.target)?.label || r.target,
        relationType: r.relationType,
        evidence: (r.evidence || '').trim(),
      }));
  }, [graph]);

  const pendingEntityIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of pendingRelations) {
      ids.add(r.sourceId);
      ids.add(r.targetId);
    }
    return ids;
  }, [pendingRelations]);

  const filteredEntities = useMemo(() => {
    if (!graph) return [] as GraphEntity[];
    const lower = keyword.trim().toLowerCase();
    return entities
      .filter((e) => entityTypeFilter.includes(e.type))
      .filter((e) => {
        if (!lower) return true;
        return (e.label + ' ' + (e.description || '')).toLowerCase().includes(lower);
      })
      .filter((e) => {
        if (!monthPracticeIds) return true;
        if (e.type === 'time') return e.label === monthFilter;
        if (e.type === 'practice') return monthPracticeIds.has(e.id);
        return relations.some((r) => {
          const linkedPracticeId =
            r.source === e.id && monthPracticeIds.has(r.target) ? r.target :
            r.target === e.id && monthPracticeIds.has(r.source) ? r.source :
            null;
          return Boolean(linkedPracticeId);
        });
      })
      .filter((e) => {
        const tags = listNarrativeTagsForEntity(graph, e.id);
        if (selectedConceptTags.length > 0 && !selectedConceptTags.every((t) => tags.conceptTags.includes(t))) return false;
        if (selectedExperienceTags.length > 0 && !selectedExperienceTags.every((t) => tags.experienceTags.includes(t))) return false;
        return true;
      })
      .filter((e) => {
        if (selectedRelationTypes.length === 0) return false;
        return relations.some(
          (r) =>
            selectedRelationTypes.includes(r.relationType) &&
            (r.source === e.id || r.target === e.id)
        );
      })
      .filter((e) => (onlyPendingRelated ? pendingEntityIds.has(e.id) : true))
      .sort((a, b) => {
        if (sortMode === 'name_asc') return a.label.localeCompare(b.label, 'zh');
        if (sortMode === 'type_then_name') {
          const t = ENTITY_LABEL[a.type].localeCompare(ENTITY_LABEL[b.type], 'zh');
          if (t !== 0) return t;
          return a.label.localeCompare(b.label, 'zh');
        }
        const c1 = listSourceCitationsForEntity(graph, a.id).length;
        const c2 = listSourceCitationsForEntity(graph, b.id).length;
        if (c1 !== c2) return c2 - c1;
        return a.label.localeCompare(b.label, 'zh');
      });
  }, [
    graph,
    entities,
    relations,
    entityTypeFilter,
    keyword,
    monthPracticeIds,
    monthFilter,
    selectedConceptTags,
    selectedExperienceTags,
    selectedRelationTypes,
    onlyPendingRelated,
    pendingEntityIds,
    sortMode,
  ]);

  const selectedEntity = useMemo(
    () => filteredEntities.find((e) => e.id === selectedEntityId) ?? filteredEntities[0] ?? null,
    [filteredEntities, selectedEntityId]
  );

  const selectedNarrative = useMemo(
    () => (graph && selectedEntity ? listNarrativeTagsForEntity(graph, selectedEntity.id) : { conceptTags: [], experienceTags: [] }),
    [graph, selectedEntity]
  );
  const selectedCitations = useMemo(
    () => (graph && selectedEntity ? listSourceCitationsForEntity(graph, selectedEntity.id) : []),
    [graph, selectedEntity]
  );
  const selectedNarrativePaths = useMemo(() => {
    if (!graph || !selectedEntity) return [] as string[];
    const byId = new Map(graph.entities.map((e) => [e.id, e]));
    const links = graph.relations;
    const pathSet = new Set<string>();

    const buildByPractice = (practiceIds: string[], conceptIds: string[], expIds: string[]) => {
      for (const pid of practiceIds) {
        const p = byId.get(pid)?.label || pid;
        for (const cid of conceptIds) {
          const c = byId.get(cid)?.label || cid;
          for (const eid of expIds) {
            const e = byId.get(eid)?.label || eid;
            const associated = links.some(
              (r) =>
                r.relationType === 'associated_with' &&
                ((r.source === cid && r.target === eid) || (r.source === eid && r.target === cid))
            );
            if (associated || conceptIds.length === 1 || expIds.length === 1) {
              pathSet.add(`${p} → ${c} → ${e}`);
            }
          }
        }
      }
    };

    if (selectedEntity.type === 'practice') {
      const pid = selectedEntity.id;
      const conceptIds = links
        .filter((r) => (r.relationType === 'symbolizes' && r.source === pid) || (r.relationType === 'regulates' && r.target === pid))
        .map((r) => (r.relationType === 'symbolizes' ? r.target : r.source));
      const expIds = links.filter((r) => r.relationType === 'evokes' && r.source === pid).map((r) => r.target);
      buildByPractice([pid], conceptIds, expIds);
    } else if (selectedEntity.type === 'concept') {
      const cid = selectedEntity.id;
      const practiceIds = links
        .filter((r) => (r.relationType === 'symbolizes' && r.target === cid) || (r.relationType === 'regulates' && r.source === cid))
        .map((r) => (r.relationType === 'symbolizes' ? r.source : r.target));
      const expIds = links
        .filter((r) => r.relationType === 'associated_with' && (r.source === cid || r.target === cid))
        .map((r) => (r.source === cid ? r.target : r.source));
      buildByPractice(practiceIds, [cid], expIds);
    } else if (selectedEntity.type === 'experience') {
      const eid = selectedEntity.id;
      const practiceIds = links.filter((r) => r.relationType === 'evokes' && r.target === eid).map((r) => r.source);
      const conceptIds = links
        .filter((r) => r.relationType === 'associated_with' && (r.source === eid || r.target === eid))
        .map((r) => (r.source === eid ? r.target : r.source));
      buildByPractice(practiceIds, conceptIds, [eid]);
    }
    return [...pathSet].slice(0, 20);
  }, [graph, selectedEntity]);

  const basketEntities = useMemo(() => {
    const idSet = new Set(basketIds);
    return filteredEntities.filter((e) => idSet.has(e.id));
  }, [basketIds, filteredEntities]);

  const exportTargets = basketEntities.length > 0 ? basketEntities : filteredEntities;

  const toggleEntityType = (t: EntityType) => {
    setEntityTypeFilter((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  };
  const toggleTag = (tag: string, kind: 'concept' | 'experience') => {
    const setter = kind === 'concept' ? setSelectedConceptTags : setSelectedExperienceTags;
    setter((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]));
  };
  const toggleRelationType = (rt: RelationType) => {
    setSelectedRelationTypes((prev) => (prev.includes(rt) ? prev.filter((x) => x !== rt) : [...prev, rt]));
  };

  const toggleBasket = (id: string) => {
    setBasketIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  useEffect(() => {
    localStorage.setItem(QUERY_LIST_STORAGE_KEY, JSON.stringify(savedQueries));
  }, [savedQueries]);

  const buildCurrentQuerySnapshot = (): Omit<SavedQuery, 'id' | 'name'> => ({
    keyword,
    monthFilter,
    entityTypeFilter,
    selectedConceptTags,
    selectedExperienceTags,
    sortMode,
  });

  const saveCurrentQuery = () => {
    if (!activeQueryId) return;
    const snapshot = buildCurrentQuerySnapshot();
    setSavedQueries((prev) => prev.map((q) => (q.id === activeQueryId ? { ...q, ...snapshot } : q)));
  };

  const saveAsNewQuery = () => {
    const name = window.prompt('请输入查询方案名称：', `方案${savedQueries.length + 1}`)?.trim();
    if (!name) return;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const query: SavedQuery = { id, name, ...buildCurrentQuerySnapshot() };
    setSavedQueries((prev) => [query, ...prev]);
    setActiveQueryId(id);
  };

  const clearCurrentQuery = () => {
    setKeyword('');
    setMonthFilter('');
    setEntityTypeFilter(['time', 'practice', 'actor', 'place', 'artifact', 'concept', 'experience']);
    setSelectedConceptTags([]);
    setSelectedExperienceTags([]);
    setSelectedRelationTypes([...GRAPH_RELATION_TYPES]);
    setSortMode('evidence_desc');
  };

  const restoreSavedQuery = () => {
    const hit = savedQueries.find((q) => q.id === activeQueryId);
    if (!hit) return;
    applySavedQuery(hit);
  };

  const removeActiveQuery = () => {
    if (!activeQueryId) return;
    const left = savedQueries.filter((q) => q.id !== activeQueryId);
    setSavedQueries(left);
    if (left.length > 0) {
      setActiveQueryId(left[0].id);
      applySavedQuery(left[0]);
    } else {
      setActiveQueryId('');
    }
  };

  const renameActiveQuery = () => {
    if (!activeQueryId) return;
    const current = savedQueries.find((q) => q.id === activeQueryId);
    if (!current) return;
    const nextName = window.prompt('请输入新的方案名称：', current.name)?.trim();
    if (!nextName) return;
    setSavedQueries((prev) => prev.map((q) => (q.id === activeQueryId ? { ...q, name: nextName } : q)));
  };

  const exportJson = (targets: GraphEntity[] = exportTargets) => {
    const payload = targets.map((e) => ({
      id: e.id,
      label: e.label,
      type: e.type,
      conceptTags: graph ? listNarrativeTagsForEntity(graph, e.id).conceptTags : [],
      experienceTags: graph ? listNarrativeTagsForEntity(graph, e.id).experienceTags : [],
      citations: graph ? listSourceCitationsForEntity(graph, e.id) : [],
    }));
    const suffix = targets === basketEntities ? 'basket' : 'workbench';
    exportTextFile(`research-${suffix}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
  };

  const exportMarkdown = (targets: GraphEntity[] = exportTargets) => {
    const md = targets
      .map((e) => {
        const narrative = graph ? listNarrativeTagsForEntity(graph, e.id) : { conceptTags: [], experienceTags: [] };
        const cites = graph ? listSourceCitationsForEntity(graph, e.id) : [];
        const lines = [
          `## ${e.label}（${ENTITY_LABEL[e.type]}）`,
          '',
          e.description || '暂无描述',
          '',
          `- 概念标签：${narrative.conceptTags.join('、') || '无'}`,
          `- 感官标签：${narrative.experienceTags.join('、') || '无'}`,
          `- 文献条数：${cites.length}`,
          '',
        ];
        if (cites.length > 0) {
          lines.push('### 文献依据');
          for (const c of cites) lines.push(`- ${c.title}${c.quote ? `：「${c.quote}」` : ''}`);
          lines.push('');
        }
        return lines.join('\n');
      })
      .join('\n---\n\n');
    const suffix = targets === basketEntities ? 'basket' : 'workbench';
    exportTextFile(`research-${suffix}.md`, md, 'text/markdown;charset=utf-8');
  };

  const exportPendingRelationsMarkdown = () => {
    const grouped = pendingRelations.reduce<Record<string, typeof pendingRelations>>((acc, row) => {
      const key = row.relationType;
      if (!acc[key]) acc[key] = [];
      acc[key].push(row);
      return acc;
    }, {});
    const relationTypes = Object.keys(grouped).sort((a, b) =>
      (RELATION_LABEL[a] || a).localeCompare(RELATION_LABEL[b] || b, 'zh')
    );

    const lines: string[] = [
      '# 待考关系补证任务单',
      '',
      `- 待考关系总数：${pendingRelations.length}`,
      `- 关系类型分组数：${relationTypes.length}`,
      `- 导出时间：${new Date().toLocaleString('zh-CN')}`,
      '',
      '---',
      '',
    ];
    if (pendingRelations.length === 0) {
      lines.push('当前没有待考关系。');
    } else {
      relationTypes.forEach((rt) => {
        const list = grouped[rt] || [];
        lines.push(`## ${RELATION_LABEL[rt] || rt}`);
        lines.push('');
        lines.push(`- 条目数：${list.length}`);
        lines.push('');
        list.forEach((r, idx) => {
          lines.push(`### ${idx + 1}. ${r.sourceLabel} → ${r.targetLabel}`);
          lines.push('');
          lines.push(`- sourceId：\`${r.sourceId}\``);
          lines.push(`- targetId：\`${r.targetId}\``);
          lines.push('- 当前证据：待考');
          lines.push('- 待补字段：sectionId + 原文引句（quote）');
          lines.push('');
        });
        lines.push('---');
        lines.push('');
      });
    }
    exportTextFile('pending-relations-todo.md', lines.join('\n'), 'text/markdown;charset=utf-8');
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 min-h-[700px]">
      <aside className="xl:col-span-3 bg-white/80 rounded-2xl border border-ink/10 p-4 space-y-4">
        <div className="text-sm font-bold text-olive flex items-center gap-2"><Filter size={14} />研究筛选</div>
        <select
          value={activeQueryId}
          onChange={(e) => {
            const id = e.target.value;
            setActiveQueryId(id);
            const hit = savedQueries.find((q) => q.id === id);
            if (hit) applySavedQuery(hit);
          }}
          className="w-full px-3 py-2 rounded-lg border border-ink/15 bg-white text-xs"
        >
          <option value="">未选择方案</option>
          {savedQueries.map((q) => (
            <option key={q.id} value={q.id}>{q.name}</option>
          ))}
        </select>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={saveCurrentQuery}
            className="px-2.5 py-1.5 rounded-md border border-ink/15 text-xs text-ink/70 hover:border-olive/30"
          >
            保存查询
          </button>
          <button
            type="button"
            onClick={saveAsNewQuery}
            className="px-2.5 py-1.5 rounded-md border border-ink/15 text-xs text-ink/70 hover:border-olive/30"
          >
            另存为
          </button>
          <button
            type="button"
            onClick={restoreSavedQuery}
            className="px-2.5 py-1.5 rounded-md border border-ink/15 text-xs text-ink/70 hover:border-olive/30"
          >
            恢复查询
          </button>
          <button
            type="button"
            onClick={clearCurrentQuery}
            className="px-2.5 py-1.5 rounded-md border border-ink/15 text-xs text-ink/70 hover:border-olive/30"
          >
            清空
          </button>
          <button
            type="button"
            onClick={removeActiveQuery}
            className="px-2.5 py-1.5 rounded-md border border-ink/15 text-xs text-ink/70 hover:border-rose-300 hover:text-rose-600"
          >
            删除
          </button>
          <button
            type="button"
            onClick={renameActiveQuery}
            className="px-2.5 py-1.5 rounded-md border border-ink/15 text-xs text-ink/70 hover:border-olive/30"
          >
            重命名
          </button>
        </div>
        <div className="relative">
          <Search size={13} className="absolute left-2 top-2.5 text-ink/40" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="检索实体、描述关键词"
            className="w-full pl-8 pr-3 py-2 rounded-lg border border-ink/15 bg-white text-sm outline-none"
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-ink/70">
          <input
            type="checkbox"
            className="rounded border-ink/25 text-olive focus:ring-olive"
            checked={onlyPendingRelated}
            onChange={(e) => setOnlyPendingRelated(e.target.checked)}
          />
          仅看“待考关系”相关实体
        </label>
        <div className="space-y-2">
          <div className="text-xs font-bold text-ink/60">关系类型</div>
          <div className="flex flex-wrap gap-1.5">
            {relationTypeOptions.map((rt) => (
              <button
                key={rt}
                type="button"
                onClick={() => toggleRelationType(rt)}
                className={`px-2 py-1 rounded-full text-[11px] border ${selectedRelationTypes.includes(rt) ? 'bg-olive/10 text-olive border-olive/30' : 'bg-white text-ink/50 border-ink/15'}`}
              >
                {RELATION_LABEL[rt] || rt}
              </button>
            ))}
          </div>
        </div>
        <select
          value={monthFilter}
          onChange={(e) => setMonthFilter(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-ink/15 bg-white text-sm"
        >
          <option value="">全部月份</option>
          {monthOptions.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>

        <div className="space-y-2">
          <div className="text-xs font-bold text-ink/60">实体类型</div>
          <div className="flex flex-wrap gap-1.5">
            {(['time', 'practice', 'actor', 'place', 'artifact', 'concept', 'experience'] as EntityType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => toggleEntityType(t)}
                className={`px-2 py-1 rounded-full text-xs border ${entityTypeFilter.includes(t) ? 'bg-olive/10 text-olive border-olive/30' : 'bg-white text-ink/45 border-ink/15'}`}
              >
                {ENTITY_LABEL[t]}
              </button>
            ))}
          </div>
        </div>

        <TagFilters title="概念标签" tags={allConceptTags} selected={selectedConceptTags} onToggle={(t) => toggleTag(t, 'concept')} />
        <TagFilters title="感官标签" tags={allExperienceTags} selected={selectedExperienceTags} onToggle={(t) => toggleTag(t, 'experience')} />
      </aside>

      <section className="xl:col-span-5 bg-white/80 rounded-2xl border border-ink/10 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold text-olive">检索结果（{filteredEntities.length}）</div>
          <div className="flex items-center gap-2">
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              className="px-2 py-1 rounded-md border border-ink/15 bg-white text-xs text-ink/70"
            >
              <option value="evidence_desc">按证据数</option>
              <option value="name_asc">按名称</option>
              <option value="type_then_name">按类型</option>
            </select>
            <div className="text-xs text-ink/45">研究篮子：{basketIds.length}</div>
            <button
              type="button"
              onClick={() => setShowBasketPanel((v) => !v)}
              className="px-2 py-1 rounded-md border border-ink/15 bg-white text-xs text-ink/70 hover:border-olive/30"
            >
              {showBasketPanel ? '收起篮子' : '查看篮子'}
            </button>
          </div>
        </div>
        {showBasketPanel && (
          <div className="rounded-xl border border-ink/10 bg-paper/40 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-ink/60">篮子内容（{basketEntities.length}）</div>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => exportMarkdown(basketEntities)}
                  className="inline-flex items-center gap-1 rounded-md border border-ink/15 bg-white px-2 py-1 text-[11px] text-ink/70 hover:border-olive/30"
                >
                  <Download size={11} />
                  导出MD
                </button>
                <button
                  type="button"
                  onClick={() => exportJson(basketEntities)}
                  className="inline-flex items-center gap-1 rounded-md border border-ink/15 bg-white px-2 py-1 text-[11px] text-ink/70 hover:border-olive/30"
                >
                  <Download size={11} />
                  导出JSON
                </button>
                <button
                  type="button"
                  onClick={() => setBasketIds([])}
                  className="rounded-md border border-ink/15 bg-white px-2 py-1 text-[11px] text-ink/70 hover:border-rose-300 hover:text-rose-600"
                >
                  清空
                </button>
              </div>
            </div>
            <div className="space-y-1.5 max-h-[180px] overflow-y-auto pr-1">
              {basketEntities.length === 0 && <p className="text-xs text-ink/40">篮子暂为空。</p>}
              {basketEntities.map((e) => {
                const cites = graph ? listSourceCitationsForEntity(graph, e.id).length : 0;
                return (
                  <div key={e.id} className="flex items-center justify-between gap-2 rounded-md border border-ink/10 bg-white px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => setSelectedEntityId(e.id)}
                      className="text-left text-xs text-ink/80 hover:text-olive"
                    >
                      {e.label} <span className="text-ink/45">（{ENTITY_LABEL[e.type]} · {cites}）</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleBasket(e.id)}
                      className="text-[11px] rounded-md border border-ink/15 px-2 py-0.5 text-ink/60 hover:border-rose-300 hover:text-rose-600"
                    >
                      移除
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {loading && <p className="text-sm text-ink/60">加载图谱数据中…</p>}
        {!loading && error && <p className="text-sm text-vermilion">{error}</p>}
        {!loading && !error && filteredEntities.length === 0 && <p className="text-sm text-ink/50">暂无匹配结果。</p>}
        <div className="space-y-2 max-h-[620px] overflow-y-auto pr-1">
          {filteredEntities.map((e) => {
            const cites = graph ? listSourceCitationsForEntity(graph, e.id).length : 0;
            const selected = selectedEntity?.id === e.id;
            const inBasket = basketIds.includes(e.id);
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => setSelectedEntityId(e.id)}
                className={`w-full text-left p-3 rounded-xl border transition ${selected ? 'border-olive/40 bg-olive/5' : 'border-ink/10 bg-white hover:border-olive/25'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-ink">{e.label}</div>
                    <div className="text-xs text-ink/50 mt-0.5">{ENTITY_LABEL[e.type]} · 文献 {cites} 条</div>
                  </div>
                  <button
                    type="button"
                    onClick={(evt) => {
                      evt.stopPropagation();
                      toggleBasket(e.id);
                    }}
                    className={`text-xs px-2 py-1 rounded-md border ${inBasket ? 'text-olive border-olive/30 bg-olive/10' : 'text-ink/55 border-ink/15 bg-white'}`}
                  >
                    {inBasket ? '已加入' : '加入篮子'}
                  </button>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <aside className="xl:col-span-4 bg-white/80 rounded-2xl border border-ink/10 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold text-olive">证据与导出</div>
          <div className="flex gap-2">
            <button type="button" onClick={() => exportMarkdown()} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-ink/15 hover:border-olive/30">
              <Download size={12} />Markdown
            </button>
            <button type="button" onClick={() => exportJson()} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-ink/15 hover:border-olive/30">
              <Download size={12} />JSON
            </button>
          </div>
        </div>
        {evidenceMetrics && (
          <div className="rounded-xl border border-ink/10 bg-paper/40 p-3">
            <div className="text-xs font-bold text-ink/60 mb-2">证据健康度</div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <MetricCard label="覆盖率" value={`${Math.round(evidenceMetrics.coverage * 100)}%`} />
              <MetricCard label="待考" value={`${evidenceMetrics.pending}`} />
              <MetricCard label="总关系" value={`${evidenceMetrics.totalRelations}`} />
            </div>
          </div>
        )}
        <div className="rounded-xl border border-ink/10 bg-paper/40 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-bold text-ink/60">待考关系清单</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={exportPendingRelationsMarkdown}
                className="inline-flex items-center gap-1 rounded-md border border-ink/15 bg-white px-2 py-1 text-[11px] text-ink/70 hover:border-olive/30"
              >
                <Download size={11} />
                导出任务单
              </button>
              <div className="text-[11px] text-ink/45">{pendingRelations.length} 条</div>
            </div>
          </div>
          <div className="space-y-1.5 max-h-[180px] overflow-y-auto pr-1">
            {pendingRelations.length === 0 && <p className="text-xs text-ink/40">暂无待考关系。</p>}
            {pendingRelations.slice(0, 12).map((r, idx) => (
              <button
                key={`${r.sourceId}-${r.targetId}-${idx}`}
                type="button"
                onClick={() => setSelectedEntityId(r.sourceId)}
                className="w-full text-left rounded-md border border-ink/10 bg-white px-2 py-1.5 text-xs hover:border-olive/30"
              >
                <span className="font-semibold text-ink">{r.sourceLabel}</span>
                <span className="text-ink/55"> — {RELATION_LABEL[r.relationType] || r.relationType} — </span>
                <span className="font-semibold text-ink">{r.targetLabel}</span>
              </button>
            ))}
          </div>
        </div>

        {!selectedEntity ? (
          <p className="text-sm text-ink/50">请选择一个结果查看证据链。</p>
        ) : (
          <div className="space-y-3">
            <div>
              <h3 className="text-lg font-bold text-ink">{selectedEntity.label}</h3>
              <p className="text-xs text-ink/50 mt-1">{ENTITY_LABEL[selectedEntity.type]}</p>
              {selectedEntity.description && <p className="text-sm text-ink/80 mt-2">{selectedEntity.description}</p>}
            </div>
            <div>
              <div className="text-xs font-bold text-ink/55 mb-1">概念标签</div>
              <div className="flex flex-wrap gap-1.5">
                {selectedNarrative.conceptTags.length === 0 ? <span className="text-xs text-ink/40">无</span> :
                  selectedNarrative.conceptTags.map((t) => <span key={t} className="px-2 py-1 rounded-full text-[11px] bg-olive/10 text-olive">{t}</span>)}
              </div>
            </div>
            <div>
              <div className="text-xs font-bold text-ink/55 mb-1">感官标签</div>
              <div className="flex flex-wrap gap-1.5">
                {selectedNarrative.experienceTags.length === 0 ? <span className="text-xs text-ink/40">无</span> :
                  selectedNarrative.experienceTags.map((t) => <span key={t} className="px-2 py-1 rounded-full text-[11px] bg-cyan-50 text-cyan-800 border border-cyan-200">{t}</span>)}
              </div>
            </div>
            <div>
              <div className="text-xs font-bold text-ink/55 mb-1">文献依据（{selectedCitations.length}）</div>
              <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
                {selectedCitations.length === 0 && <p className="text-xs text-ink/40">暂无可用文献。</p>}
                {selectedCitations.map((c) => (
                  <div key={c.sourceId} className="rounded-lg border border-ink/10 p-2.5 bg-white">
                    <p className="text-xs font-semibold text-olive">{c.title}</p>
                    {c.quote && <p className="text-xs text-ink/70 mt-1">“{c.quote}”</p>}
                    {onOpenQjlSection && (
                      <button
                        type="button"
                        onClick={() => {
                          const id = c.sourceId && !/^qjl-/i.test(c.sourceId.trim()) ? c.sourceId.trim() : '';
                          void onOpenQjlSection(id, c.quote?.trim() || null, chapterTitleForQjlLookup(c.title));
                        }}
                        className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-olive hover:underline"
                      >
                        <BookOpen size={12} />
                        打开原文
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs font-bold text-ink/55 mb-1">叙事路径</div>
              <div className="space-y-1.5 max-h-[140px] overflow-y-auto pr-1">
                {selectedNarrativePaths.length === 0 && (
                  <p className="text-xs text-ink/40">当前实体暂无可构成的“活动→概念→体验”路径。</p>
                )}
                {selectedNarrativePaths.map((p) => (
                  <div key={p} className="rounded-md border border-ink/10 bg-white px-2 py-1.5 text-xs text-ink/75">
                    {p}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white px-2 py-2">
      <div className="text-[10px] text-ink/45">{label}</div>
      <div className="text-sm font-bold text-olive">{value}</div>
    </div>
  );
}

function TagFilters({
  title,
  tags,
  selected,
  onToggle,
}: {
  title: string;
  tags: string[];
  selected: string[];
  onToggle: (tag: string) => void;
}) {
  if (tags.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="text-xs font-bold text-ink/60">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onToggle(t)}
            className={`px-2 py-1 rounded-full text-[11px] border ${selected.includes(t) ? 'bg-olive/10 text-olive border-olive/30' : 'bg-white text-ink/50 border-ink/15'}`}
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}

