import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Info,
  Filter,
  Users,
  Calendar,
  Sparkles,
  MapPin,
  Volume2,
  Square,
  BookOpen,
  Layers,
  Link2,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  buildLegacyMonthCustomRoleView,
  buildNarrativePracticeConceptExperienceView,
  buildTimePlacePracticeView,
  getPresetSliceOptions,
  getCanonicalGraph,
  GRAPH_RELATION_TYPES,
  listNeighborRelations,
  listNarrativeTagsForEntity,
  listSourceCitationsForEntity,
  sliceCanonicalGraph,
  type CanonicalGraph,
  type EntityType,
  type GraphViewPreset,
  type LegacyViewNode,
  type LegacyViewType,
  type NarrativeUiGroup,
  type NarrativeViewNode,
  type RelationType,
  type TppUiGroup,
  type TppViewNode,
} from '../graph/folkloreGraphModel';
import { getFolkloreSubgraph } from '../services/api';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type GraphNode = (LegacyViewNode | TppViewNode | NarrativeViewNode) & d3.SimulationNodeDatum;

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
  relationType?: string;
}

const RELATION_LABEL_ZH: Record<RelationType, string> = {
  occurs_in: '月令',
  occurs_at: '地点',
  performed_by: '参与',
  uses: '器物',
  documented_in: '文献',
  related_to: '相关',
  symbolizes: '象征',
  regulates: '规范',
  evokes: '唤起',
  associated_with: '关联',
};

const ENTITY_TYPE_ZH: Record<EntityType, string> = {
  time: '时令',
  practice: '活动',
  actor: '人物',
  place: '地点',
  artifact: '物件',
  source: '文献',
  concept: '概念',
  experience: '体验',
};

export type FolkloreGraphProps = {
  /** 打开《清嘉录》原文抽屉；id 为空时按章节标题匹配 */
  onOpenQjlSection?: (id: string, highlightQuote?: string | null, chapterTitle?: string | null) => void | Promise<void>;
  month?: string;
};

function chapterTitleForQjlLookup(title: string): string {
  return title.replace(/^《[^》]+》[·・]\s*/u, '').trim() || title;
}

function nodeFilterKey(
  node: GraphNode,
  preset: GraphViewPreset
): LegacyViewType | TppUiGroup | NarrativeUiGroup {
  if (preset === 'month_custom_role') return (node as LegacyViewNode).type;
  if (preset === 'time_place_practice') return (node as TppViewNode).uiGroup;
  return (node as NarrativeViewNode).uiGroup;
}

function nodeRadius(node: GraphNode, preset: GraphViewPreset): number {
  if (preset === 'narrative_practice_concept_experience') {
    const g = (node as NarrativeViewNode).uiGroup;
    if (g === 'narr_concept') return 22;
    if (g === 'narr_experience') return 18;
    return 20;
  }
  if (preset === 'time_place_practice') {
    const g = (node as TppViewNode).uiGroup;
    if (g === 'tpp_time') return 28;
    if (g === 'tpp_practice') return 20;
    return 18;
  }
  const t = (node as LegacyViewNode).type;
  if (t === 'month') return 28;
  if (t === 'custom') return 20;
  return 16;
}

function nodeFill(node: GraphNode, preset: GraphViewPreset): string {
  if (preset === 'narrative_practice_concept_experience') {
    const g = (node as NarrativeViewNode).uiGroup;
    if (g === 'narr_concept') return '#7c3aed';
    if (g === 'narr_experience') return '#0891b2';
    return '#b22222';
  }
  if (preset === 'time_place_practice') {
    const g = (node as TppViewNode).uiGroup;
    if (g === 'tpp_time') return '#5A5A40';
    if (g === 'tpp_practice') return '#b22222';
    return '#0e7490';
  }
  const t = (node as LegacyViewNode).type;
  if (t === 'month') return '#5A5A40';
  if (t === 'custom') return '#b22222';
  return '#64748b';
}

function nodeStrokeDash(node: GraphNode, preset: GraphViewPreset): string {
  if (preset === 'narrative_practice_concept_experience') {
    return (node as NarrativeViewNode).uiGroup === 'narr_practice' ? '4,2' : 'none';
  }
  if (preset === 'time_place_practice') {
    return (node as TppViewNode).uiGroup === 'tpp_practice' ? '4,2' : 'none';
  }
  return (node as LegacyViewNode).type === 'custom' ? '4,2' : 'none';
}

function isPrimaryTimeNode(node: GraphNode, preset: GraphViewPreset): boolean {
  if (preset === 'narrative_practice_concept_experience') return false;
  return preset === 'time_place_practice'
    ? (node as TppViewNode).uiGroup === 'tpp_time'
    : (node as LegacyViewNode).type === 'month';
}

function detailBadgeClass(node: GraphNode, preset: GraphViewPreset): string {
  if (preset === 'narrative_practice_concept_experience') {
    const g = (node as NarrativeViewNode).uiGroup;
    if (g === 'narr_concept') return 'bg-violet-700';
    if (g === 'narr_experience') return 'bg-cyan-700';
    return 'bg-vermilion';
  }
  if (preset === 'time_place_practice') {
    const g = (node as TppViewNode).uiGroup;
    if (g === 'tpp_time') return 'bg-olive';
    if (g === 'tpp_practice') return 'bg-vermilion';
    return 'bg-cyan-700';
  }
  const t = (node as LegacyViewNode).type;
  if (t === 'month') return 'bg-olive';
  if (t === 'custom') return 'bg-vermilion';
  return 'bg-slate-500';
}

function detailBadgeLabel(node: GraphNode, preset: GraphViewPreset): string {
  if (preset === 'narrative_practice_concept_experience') {
    const g = (node as NarrativeViewNode).uiGroup;
    if (g === 'narr_concept') return '概念';
    if (g === 'narr_experience') return '体验';
    return '活动';
  }
  if (preset === 'time_place_practice') {
    const g = (node as TppViewNode).uiGroup;
    if (g === 'tpp_time') return '时令';
    if (g === 'tpp_practice') return '活动';
    return '地点';
  }
  const t = (node as LegacyViewNode).type;
  if (t === 'month') return '时令';
  if (t === 'custom') return '习俗';
  return '角色';
}

export default function FolkloreGraph({ onOpenQjlSection, month }: FolkloreGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const builtinGraphRef = useRef<CanonicalGraph>(getCanonicalGraph());
  const [graph, setGraph] = useState<CanonicalGraph>(() =>
    sliceCanonicalGraph(builtinGraphRef.current, getPresetSliceOptions('month_custom_role'))
  );
  const [graphSource, setGraphSource] = useState<'builtin' | 'api'>('builtin');
  const [graphLoading, setGraphLoading] = useState(true);
  const [lastFetchMs, setLastFetchMs] = useState<number | null>(null);
  const [viewPreset, setViewPreset] = useState<GraphViewPreset>('month_custom_role');
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [legacyFilter, setLegacyFilter] = useState<LegacyViewType[]>(['month', 'custom', 'role']);
  const [tppFilter, setTppFilter] = useState<TppUiGroup[]>(['tpp_time', 'tpp_place', 'tpp_practice']);
  const [narrativeFilter, setNarrativeFilter] = useState<NarrativeUiGroup[]>([
    'narr_practice',
    'narr_concept',
    'narr_experience',
  ]);
  const [relationFilter, setRelationFilter] = useState<RelationType[]>(() => [...GRAPH_RELATION_TYPES]);
  const [onlyWithSources, setOnlyWithSources] = useState(false);
  const [graphNotice, setGraphNotice] = useState<string | null>(null);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false);
  const [searchActiveIndex, setSearchActiveIndex] = useState(-1);
  const [recentNodeIds, setRecentNodeIds] = useState<string[]>([]);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [controlsPos, setControlsPos] = useState({ x: 16, y: 56 });
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const noticeTimerRef = useRef<number | null>(null);
  const graphFetchDebounceRef = useRef<number | null>(null);
  const graphReqSeqRef = useRef(0);
  const lastGraphQueryKeyRef = useRef<string>('');
  const controlsDragRef = useRef<{
    mx: number;
    my: number;
    x: number;
    y: number;
    pointerId: number;
  } | null>(null);

  const legacyGraph = useMemo(() => buildLegacyMonthCustomRoleView(graph), [graph]);
  const tppGraph = useMemo(() => buildTimePlacePracticeView(graph), [graph]);
  const narrativeGraph = useMemo(() => buildNarrativePracticeConceptExperienceView(graph), [graph]);

  const nodeIdsWithSources = useMemo(() => {
    const ids = new Set<string>();
    for (const e of graph.entities) {
      if (listSourceCitationsForEntity(graph, e.id).length > 0) {
        ids.add(e.id);
      }
    }
    return ids;
  }, [graph]);

  const currentViewNodes = useMemo(
    () =>
      viewPreset === 'month_custom_role'
        ? legacyGraph.nodes
        : viewPreset === 'time_place_practice'
          ? tppGraph.nodes
          : narrativeGraph.nodes,
    [viewPreset, legacyGraph.nodes, tppGraph.nodes, narrativeGraph.nodes]
  );

  const searchSuggestions = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    const toItem = (id: string, label: string, inView: boolean) => ({ id, label, inView });

    if (!keyword) {
      const inViewIds = new Set(currentViewNodes.map((n) => n.id));
      const byId = new Map(graph.entities.map((e) => [e.id, e.label]));
      return recentNodeIds
        .map((id) => {
          const label = byId.get(id);
          if (!label) return null;
          return toItem(id, label, inViewIds.has(id));
        })
        .filter(Boolean)
        .slice(0, 5) as Array<{ id: string; label: string; inView: boolean }>;
    }

    const seen = new Set<string>();
    const inView = currentViewNodes
      .filter((n) => n.label.toLowerCase().includes(keyword))
      .sort((a, b) => a.label.length - b.label.length || a.label.localeCompare(b.label, 'zh'))
      .map((n) => toItem(n.id, n.label, true));

    const full = graph.entities
      .filter((e) => e.label.toLowerCase().includes(keyword))
      .sort((a, b) => a.label.length - b.label.length || a.label.localeCompare(b.label, 'zh'))
      .map((e) => toItem(e.id, e.label, false));

    const merged = [...inView, ...full].filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });

    return merged.slice(0, 5);
  }, [searchKeyword, currentViewNodes, graph.entities, recentNodeIds]);

  useEffect(() => {
    let cancelled = false;
    const fallback = sliceCanonicalGraph(
      builtinGraphRef.current,
      {
        ...getPresetSliceOptions(viewPreset),
        relationTypes: relationFilter,
      }
    );
    const fallbackGraph = onlyWithSources
      ? (() => {
          const idsWithSources = new Set(
            fallback.entities
              .filter((e) => listSourceCitationsForEntity(fallback, e.id).length > 0)
              .map((e) => e.id)
          );
          const entities = fallback.entities.filter((e) => idsWithSources.has(e.id));
          const entityIdSet = new Set(entities.map((e) => e.id));
          const relations = fallback.relations.filter(
            (r) => entityIdSet.has(r.source) && entityIdSet.has(r.target)
          );
          return { entities, relations };
        })()
      : fallback;

    const queryKey = JSON.stringify({
      preset: viewPreset,
      month: month || '',
      relationTypes: [...relationFilter].sort(),
      onlyWithSources,
    });

    if (graphFetchDebounceRef.current != null) {
      window.clearTimeout(graphFetchDebounceRef.current);
      graphFetchDebounceRef.current = null;
    }

    graphFetchDebounceRef.current = window.setTimeout(() => {
      if (lastGraphQueryKeyRef.current === queryKey) {
        setGraphLoading(false);
        return;
      }
      setGraphLoading(true);
      const reqSeq = ++graphReqSeqRef.current;
      const startedAt = (typeof performance !== 'undefined' && typeof performance.now === 'function')
        ? performance.now()
        : Date.now();
      void getFolkloreSubgraph({
        preset: viewPreset,
        month,
        relationTypes: relationFilter,
        onlyWithSources,
      })
        .then((g) => {
          if (cancelled || reqSeq !== graphReqSeqRef.current) return;
          const endedAt = (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
          setLastFetchMs(Math.max(0, Math.round(endedAt - startedAt)));
          if (g) {
            setGraph(g);
            setGraphSource('api');
            lastGraphQueryKeyRef.current = queryKey;
            return;
          }
          setGraph(fallbackGraph);
          setGraphSource('builtin');
          lastGraphQueryKeyRef.current = queryKey;
        })
        .catch(() => {
          if (cancelled || reqSeq !== graphReqSeqRef.current) return;
          const endedAt = (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
          setLastFetchMs(Math.max(0, Math.round(endedAt - startedAt)));
          setGraph(fallbackGraph);
          setGraphSource('builtin');
          lastGraphQueryKeyRef.current = queryKey;
        })
        .finally(() => {
          if (!cancelled && reqSeq === graphReqSeqRef.current) setGraphLoading(false);
        });
    }, 200);

    return () => {
      cancelled = true;
      if (graphFetchDebounceRef.current != null) {
        window.clearTimeout(graphFetchDebounceRef.current);
        graphFetchDebounceRef.current = null;
      }
    };
  }, [viewPreset, relationFilter, onlyWithSources, month]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateDimensions = () => {
      if (containerRef.current) {
        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;
        if (w > 0 && h > 0) {
          setDimensions({ width: w, height: h });
        }
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateDimensions) : null;
    ro?.observe(el);
    return () => {
      window.removeEventListener('resize', updateDimensions);
      ro?.disconnect();
    };
  }, []);

  const showGraphNotice = useCallback((message: string) => {
    if (noticeTimerRef.current != null) {
      window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
    setGraphNotice(message);
    noticeTimerRef.current = window.setTimeout(() => {
      setGraphNotice(null);
      noticeTimerRef.current = null;
    }, 3800);
  }, []);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current != null) window.clearTimeout(noticeTimerRef.current);
      if (graphFetchDebounceRef.current != null) window.clearTimeout(graphFetchDebounceRef.current);
    };
  }, []);

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const drag = controlsDragRef.current;
      if (!drag || e.pointerId !== drag.pointerId || !containerRef.current) return;
      const dx = e.clientX - drag.mx;
      const dy = e.clientY - drag.my;
      const panelW = 220;
      const panelH = 520;
      const maxX = Math.max(8, containerRef.current.clientWidth - panelW);
      const maxY = Math.max(8, containerRef.current.clientHeight - panelH);
      const nx = Math.min(maxX, Math.max(8, drag.x + dx));
      const ny = Math.min(maxY, Math.max(8, drag.y + dy));
      setControlsPos({ x: nx, y: ny });
    };
    const endDrag = (e: PointerEvent) => {
      const drag = controlsDragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      controlsDragRef.current = null;
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
    };
  }, []);

  useEffect(() => {
    setSelectedNode(null);
    setRelationFilter(() => {
      if (viewPreset === 'month_custom_role') return [...GRAPH_RELATION_TYPES];
      if (viewPreset === 'time_place_practice') return ['occurs_in', 'occurs_at'];
      return ['symbolizes', 'regulates', 'evokes', 'associated_with'];
    });
  }, [viewPreset]);

  const selectNodeInCurrentView = useCallback(
    (nodeId: string) => {
      const baseNodes =
        viewPreset === 'month_custom_role'
          ? legacyGraph.nodes
          : viewPreset === 'time_place_practice'
            ? tppGraph.nodes
            : narrativeGraph.nodes;
      const hit = baseNodes.find((n) => n.id === nodeId);
      if (!hit) return false;

      if (viewPreset === 'month_custom_role') {
        const lt = (hit as LegacyViewNode).type;
        setLegacyFilter((prev) => (prev.includes(lt) ? prev : [...prev, lt]));
      } else if (viewPreset === 'time_place_practice') {
        const ug = (hit as TppViewNode).uiGroup;
        setTppFilter((prev) => (prev.includes(ug) ? prev : [...prev, ug]));
      } else {
        const ug = (hit as NarrativeViewNode).uiGroup;
        setNarrativeFilter((prev) => (prev.includes(ug) ? prev : [...prev, ug]));
      }

      if (onlyWithSources && !nodeIdsWithSources.has(nodeId)) {
        setOnlyWithSources(false);
        showGraphNotice('已暂时关闭「仅有文献」，以便查看该节点。');
      }
      setSelectedNode({ ...hit } as GraphNode);
      return true;
    },
    [
      viewPreset,
      legacyGraph.nodes,
      tppGraph.nodes,
      narrativeGraph.nodes,
      onlyWithSources,
      nodeIdsWithSources,
      showGraphNotice,
    ]
  );

  const selectProjectedNeighbor = useCallback(
    (neighborId: string) => {
      const ok = selectNodeInCurrentView(neighborId);
      if (!ok) {
        showGraphNotice(
          '该节点不在当前视图投影中（如文献、物件等仅出现在全图语义里，可切换「三维」视图查看人物等）。'
        );
      }
    },
    [selectNodeInCurrentView, showGraphNotice]
  );

  const searchAndSelectNode = useCallback(() => {
    const keyword = searchKeyword.trim();
    if (!keyword) return;
    const lowerKeyword = keyword.toLowerCase();

    const inViewNodes = (
      viewPreset === 'month_custom_role'
        ? legacyGraph.nodes
        : viewPreset === 'time_place_practice'
          ? tppGraph.nodes
          : narrativeGraph.nodes
    )
      .filter((n) => n.label.toLowerCase().includes(lowerKeyword))
      .sort((a, b) => a.label.length - b.label.length);

    if (inViewNodes.length > 0) {
      void selectNodeInCurrentView(inViewNodes[0].id);
      return;
    }

    const inFullGraph = graph.entities
      .filter((e) => e.label.toLowerCase().includes(lowerKeyword))
      .sort((a, b) => a.label.length - b.label.length);

    if (inFullGraph.length > 0) {
      showGraphNotice(`已找到“${inFullGraph[0].label}”，但它不在当前视图中，请切换视图后查看。`);
      return;
    }
    showGraphNotice(`未找到与“${keyword}”相关的节点。`);
  }, [
    searchKeyword,
    viewPreset,
    legacyGraph.nodes,
    tppGraph.nodes,
    narrativeGraph.nodes,
    selectNodeInCurrentView,
    graph.entities,
    showGraphNotice,
  ]);

  const chooseSuggestion = useCallback(
    (item: { id: string; label: string; inView: boolean }) => {
      setSearchKeyword(item.label);
      setSearchDropdownOpen(false);
      setSearchActiveIndex(-1);
      setRecentNodeIds((prev) => [item.id, ...prev.filter((id) => id !== item.id)].slice(0, 5));
      if (item.inView) {
        void selectNodeInCurrentView(item.id);
      } else {
        showGraphNotice(`已找到“${item.label}”，但它不在当前视图中，请切换视图后查看。`);
      }
    },
    [selectNodeInCurrentView, showGraphNotice]
  );

  useEffect(() => {
    setSearchActiveIndex(searchSuggestions.length > 0 ? 0 : -1);
  }, [searchSuggestions]);

  useEffect(() => {
    if (!selectedNode?.id) return;
    setRecentNodeIds((prev) => [selectedNode.id, ...prev.filter((id) => id !== selectedNode.id)].slice(0, 5));
  }, [selectedNode?.id]);

  useEffect(() => {
    if (!svgRef.current || !dimensions.width) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const selectedId = selectedNode?.id ?? null;

    const baseNodes =
      viewPreset === 'month_custom_role'
        ? legacyGraph.nodes
        : viewPreset === 'time_place_practice'
          ? tppGraph.nodes
          : narrativeGraph.nodes;
    const baseLinks =
      viewPreset === 'month_custom_role'
        ? legacyGraph.links
        : viewPreset === 'time_place_practice'
          ? tppGraph.links
          : narrativeGraph.links;

    const afterDim = baseNodes.filter((n) => {
      const key = nodeFilterKey(n as GraphNode, viewPreset);
      if (viewPreset === 'month_custom_role') return legacyFilter.includes(key as LegacyViewType);
      if (viewPreset === 'time_place_practice') return tppFilter.includes(key as TppUiGroup);
      return narrativeFilter.includes(key as NarrativeUiGroup);
    });

    const afterSource = onlyWithSources
      ? afterDim.filter((n) => nodeIdsWithSources.has(n.id))
      : afterDim;

    const filteredNodes: GraphNode[] = afterSource.map((n) => ({
      ...n,
      x: Math.random() * dimensions.width,
      y: Math.random() * dimensions.height,
    })) as GraphNode[];

    const visibleNodeIds = new Set(filteredNodes.map((n) => n.id));
    const filteredLinks: GraphLink[] = baseLinks
      .filter((l) => {
        const rt = l.relationType;
        if (!rt || !relationFilter.includes(rt)) return false;
        const sourceId = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
        const targetId = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
        return visibleNodeIds.has(sourceId) && visibleNodeIds.has(targetId);
      })
      .map((l) => ({
        source: typeof l.source === 'string' ? l.source : (l.source as GraphNode).id,
        target: typeof l.target === 'string' ? l.target : (l.target as GraphNode).id,
        relationType: l.relationType,
      }));

    // 为左上悬浮控制卡预留可视区域，避免节点被控件遮挡
    const reservedLeftWidth = dimensions.width >= 1024 && controlsVisible ? 252 : 0;

    const highlightedNodeIds = new Set<string>();
    const highlightedEdgeKeys = new Set<string>();
    const edgeKey = (a: string, b: string) => `${a}=>${b}`;
    const markEdge = (a: string, b: string) => {
      highlightedEdgeKeys.add(edgeKey(a, b));
      highlightedEdgeKeys.add(edgeKey(b, a));
    };
    if (viewPreset === 'narrative_practice_concept_experience' && selectedId) {
      type NarrRel = { source: string; target: string; relationType?: string };
      const narrLinks = filteredLinks.map((l) => ({
        source: typeof l.source === 'string' ? l.source : (l.source as GraphNode).id,
        target: typeof l.target === 'string' ? l.target : (l.target as GraphNode).id,
        relationType: l.relationType,
      })) as NarrRel[];
      const byId = new Map(filteredNodes.map((n) => [n.id, n]));
      const sel = byId.get(selectedId) as NarrativeViewNode | undefined;
      if (sel) {
        highlightedNodeIds.add(sel.id);
        const conceptIds = new Set<string>();
        const experienceIds = new Set<string>();
        const practiceIds = new Set<string>();

        if (sel.entityType === 'practice') {
          practiceIds.add(sel.id);
          for (const l of narrLinks) {
            if (l.relationType === 'symbolizes' && l.source === sel.id) {
              conceptIds.add(l.target);
              markEdge(l.source, l.target);
            }
            if (l.relationType === 'regulates' && l.target === sel.id) {
              conceptIds.add(l.source);
              markEdge(l.source, l.target);
            }
            if (l.relationType === 'evokes' && l.source === sel.id) {
              experienceIds.add(l.target);
              markEdge(l.source, l.target);
            }
          }
        } else if (sel.entityType === 'concept') {
          conceptIds.add(sel.id);
          for (const l of narrLinks) {
            if (l.relationType === 'symbolizes' && l.target === sel.id) {
              practiceIds.add(l.source);
              markEdge(l.source, l.target);
            }
            if (l.relationType === 'regulates' && l.source === sel.id) {
              practiceIds.add(l.target);
              markEdge(l.source, l.target);
            }
            if (l.relationType === 'associated_with' && (l.source === sel.id || l.target === sel.id)) {
              const other = l.source === sel.id ? l.target : l.source;
              experienceIds.add(other);
              markEdge(l.source, l.target);
            }
          }
        } else if (sel.entityType === 'experience') {
          experienceIds.add(sel.id);
          for (const l of narrLinks) {
            if (l.relationType === 'evokes' && l.target === sel.id) {
              practiceIds.add(l.source);
              markEdge(l.source, l.target);
            }
            if (l.relationType === 'associated_with' && (l.source === sel.id || l.target === sel.id)) {
              const other = l.source === sel.id ? l.target : l.source;
              conceptIds.add(other);
              markEdge(l.source, l.target);
            }
          }
        }

        for (const p of practiceIds) highlightedNodeIds.add(p);
        for (const c of conceptIds) highlightedNodeIds.add(c);
        for (const e of experienceIds) highlightedNodeIds.add(e);

        // 补齐活动-概念-体验三段路径的交叉边高亮
        for (const l of narrLinks) {
          if (
            (l.relationType === 'associated_with' && conceptIds.has(l.source) && experienceIds.has(l.target)) ||
            (l.relationType === 'associated_with' && conceptIds.has(l.target) && experienceIds.has(l.source)) ||
            (l.relationType === 'evokes' && practiceIds.has(l.source) && experienceIds.has(l.target)) ||
            (l.relationType === 'symbolizes' && practiceIds.has(l.source) && conceptIds.has(l.target)) ||
            (l.relationType === 'regulates' && conceptIds.has(l.source) && practiceIds.has(l.target))
          ) {
            markEdge(l.source, l.target);
          }
        }
      }
    }

    const simulation = d3.forceSimulation<GraphNode>(filteredNodes)
      .force('link', d3.forceLink<GraphNode, GraphLink>(filteredLinks).id((d) => d.id).distance(120))
      .force('charge', d3.forceManyBody().strength(-400))
      .force('center', d3.forceCenter((dimensions.width + reservedLeftWidth) / 2, dimensions.height / 2))
      .force('collision', d3.forceCollide().radius(50))
      .force('x', d3.forceX((dimensions.width + reservedLeftWidth) / 2).strength(0.1))
      .force('y', d3.forceY(dimensions.height / 2).strength(0.1));

    simulation.alpha(1).restart();

    const g = svg.append('g');

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 3])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    const defs = svg.append('defs');
    const glowFilter = defs.append('filter').attr('id', 'glow');
    glowFilter.append('feGaussianBlur').attr('stdDeviation', '2.5').attr('result', 'coloredBlur');
    const feMerge = glowFilter.append('feMerge');
    feMerge.append('feMergeNode').attr('in', 'coloredBlur');
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    const link = g
      .append('g')
      .attr('stroke', '#999')
      .attr('stroke-opacity', 0.4)
      .selectAll('line')
      .data(filteredLinks)
      .join('line')
      .attr('stroke-width', (d) => {
        if (viewPreset !== 'narrative_practice_concept_experience' || !selectedId) return 1.5;
        const s = typeof d.source === 'string' ? d.source : (d.source as GraphNode).id;
        const t = typeof d.target === 'string' ? d.target : (d.target as GraphNode).id;
        return highlightedEdgeKeys.has(edgeKey(s, t)) ? 3 : 1;
      })
      .attr('stroke', (d) => {
        if (viewPreset !== 'narrative_practice_concept_experience' || !selectedId) return '#999';
        const s = typeof d.source === 'string' ? d.source : (d.source as GraphNode).id;
        const t = typeof d.target === 'string' ? d.target : (d.target as GraphNode).id;
        return highlightedEdgeKeys.has(edgeKey(s, t)) ? '#ca8a04' : '#9ca3af';
      })
      .attr('stroke-opacity', (d) => {
        if (viewPreset !== 'narrative_practice_concept_experience' || !selectedId) return 0.4;
        const s = typeof d.source === 'string' ? d.source : (d.source as GraphNode).id;
        const t = typeof d.target === 'string' ? d.target : (d.target as GraphNode).id;
        return highlightedEdgeKeys.has(edgeKey(s, t)) ? 0.9 : 0.18;
      });

    const node = g
      .append('g')
      .selectAll('.node')
      .data(filteredNodes)
      .join('g')
      .attr('class', 'node')
      .call(
        d3
          .drag<SVGGElement, GraphNode>()
          .on('start', dragstarted)
          .on('drag', dragged)
          .on('end', dragended) as any
      )
      .on('click', (event, d) => {
        setSelectedNode(d);
        event.stopPropagation();
      });

    node
      .filter((d) => isPrimaryTimeNode(d, viewPreset))
      .append('circle')
      .attr('r', 32)
      .attr('fill', 'none')
      .attr('stroke', '#5A5A40')
      .attr('stroke-width', 1)
      .attr('stroke-opacity', 0.3);

    node
      .append('circle')
      .attr('r', (d) => nodeRadius(d, viewPreset))
      .attr('fill', (d) => nodeFill(d, viewPreset))
      .attr('stroke', '#fff')
      .attr('stroke-width', (d) => (isPrimaryTimeNode(d, viewPreset) ? 3 : 2))
      .attr('stroke-dasharray', (d) => nodeStrokeDash(d, viewPreset))
      .attr('class', 'cursor-pointer transition-all hover:scale-110 shadow-lg')
      .style('filter', (d) => (isPrimaryTimeNode(d, viewPreset) ? 'url(#glow)' : 'none'))
      .style('opacity', (d) => {
        if (viewPreset !== 'narrative_practice_concept_experience' || !selectedId) return 1;
        return highlightedNodeIds.has(d.id) ? 1 : 0.35;
      });

    if (selectedId) {
      node
        .filter((d) => d.id === selectedId)
        .append('circle')
        .attr('r', (d) => nodeRadius(d, viewPreset) + 6)
        .attr('fill', 'none')
        .attr('stroke', '#ca8a04')
        .attr('stroke-width', 2.5)
        .attr('pointer-events', 'none');
    }

    node
      .append('text')
      .text((d) => d.label)
      .attr('dy', (d) => (nodeRadius(d, viewPreset) + 14))
      .attr('text-anchor', 'middle')
      .attr('class', 'serif font-bold text-sm pointer-events-none fill-ink')
      .style('opacity', (d) => {
        if (viewPreset !== 'narrative_practice_concept_experience' || !selectedId) return 1;
        return highlightedNodeIds.has(d.id) ? 1 : 0.45;
      });

    simulation.on('tick', () => {
      link
        .attr('x1', (d) => (d.source as GraphNode).x ?? 0)
        .attr('y1', (d) => (d.source as GraphNode).y ?? 0)
        .attr('x2', (d) => (d.target as GraphNode).x ?? 0)
        .attr('y2', (d) => (d.target as GraphNode).y ?? 0);

      node.attr('transform', (d) => {
        const radius = nodeRadius(d, viewPreset);
        d.x = Math.max(reservedLeftWidth + radius, Math.min(dimensions.width - radius, d.x ?? 0));
        d.y = Math.max(radius, Math.min(dimensions.height - radius, d.y ?? 0));
        return `translate(${d.x},${d.y})`;
      });
    });

    function dragstarted(event: d3.D3DragEvent<SVGGElement, GraphNode, GraphNode>, d: GraphNode) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }

    function dragged(event: d3.D3DragEvent<SVGGElement, GraphNode, GraphNode>, d: GraphNode) {
      d.fx = event.x;
      d.fy = event.y;
    }

    function dragended(event: d3.D3DragEvent<SVGGElement, GraphNode, GraphNode>, d: GraphNode) {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }

    return () => {
      simulation.stop();
    };
  }, [
    dimensions,
    graph,
    narrativeGraph,
    viewPreset,
    legacyFilter,
    tppFilter,
    narrativeFilter,
    onlyWithSources,
    relationFilter,
    nodeIdsWithSources,
    selectedNode?.id,
  ]);

  const toggleLegacyFilter = (type: LegacyViewType) => {
    setLegacyFilter((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]));
  };

  const toggleTppFilter = (key: TppUiGroup) => {
    setTppFilter((prev) => (prev.includes(key) ? prev.filter((t) => t !== key) : [...prev, key]));
  };

  const toggleNarrativeFilter = (key: NarrativeUiGroup) => {
    setNarrativeFilter((prev) => (prev.includes(key) ? prev.filter((t) => t !== key) : [...prev, key]));
  };

  const toggleRelationType = (rt: RelationType) => {
    setRelationFilter((prev) => (prev.includes(rt) ? prev.filter((x) => x !== rt) : [...prev, rt]));
  };

  useEffect(() => {
    if (!selectedNode) return;
    const key = nodeFilterKey(selectedNode, viewPreset);
    const visible = viewPreset === 'month_custom_role'
      ? legacyFilter.includes(key as LegacyViewType)
      : viewPreset === 'time_place_practice'
        ? tppFilter.includes(key as TppUiGroup)
        : narrativeFilter.includes(key as NarrativeUiGroup);
    if (!visible) {
      setSelectedNode(null);
      return;
    }
    if (onlyWithSources && !nodeIdsWithSources.has(selectedNode.id)) {
      setSelectedNode(null);
    }
  }, [legacyFilter, tppFilter, narrativeFilter, selectedNode, viewPreset, onlyWithSources, nodeIdsWithSources]);

  const speak = (text: string) => {
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  useEffect(() => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, [selectedNode]);

  useEffect(() => {
    return () => window.speechSynthesis.cancel();
  }, []);

  const sourceCitations = selectedNode
    ? listSourceCitationsForEntity(graph, selectedNode.id)
    : [];
  const narrativeTags = selectedNode
    ? listNarrativeTagsForEntity(graph, selectedNode.id)
    : { conceptTags: [], experienceTags: [] };

  const neighborRows = useMemo(() => {
    if (!selectedNode) return [];
    const rows = listNeighborRelations(graph, selectedNode.id);
    return [...rows].sort((a, b) => {
      const c = a.relationType.localeCompare(b.relationType);
      if (c !== 0) return c;
      return a.neighborLabel.localeCompare(b.neighborLabel, 'zh');
    });
  }, [selectedNode, graph]);

  const openCitation = (citation: (typeof sourceCitations)[number]) => {
    if (!onOpenQjlSection) return;
    const id =
      citation.sourceId && !/^qjl-/i.test(citation.sourceId.trim()) ? citation.sourceId.trim() : '';
    void onOpenQjlSection(id, citation.quote?.trim() || null, chapterTitleForQjlLookup(citation.title));
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full min-h-[260px] bg-white/50 rounded-[24px] sm:rounded-[32px] overflow-hidden border border-ink/10 shadow-inner"
    >
      <svg ref={svgRef} width="100%" height="100%" className="cursor-move" />

      <AnimatePresence>
        {graphNotice && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="absolute top-4 left-1/2 z-20 max-w-[min(90vw,360px)] -translate-x-1/2 rounded-xl border border-olive/20 bg-paper/95 px-4 py-2.5 text-center text-xs font-medium text-ink/85 shadow-lg backdrop-blur-sm pointer-events-none"
          >
            {graphNotice}
          </motion.div>
        )}
      </AnimatePresence>

      <button
        type="button"
        onClick={() => setControlsVisible((v) => !v)}
        className="absolute top-4 left-4 z-20 inline-flex items-center gap-1 rounded-xl border border-ink/10 bg-white/65 px-2.5 py-1.5 text-[11px] font-semibold text-ink/70 shadow-sm backdrop-blur-md hover:border-olive/35 hover:text-olive"
      >
        {controlsVisible ? <PanelLeftClose size={13} /> : <PanelLeftOpen size={13} />}
        {controlsVisible ? '隐藏控件' : '显示控件'}
      </button>

      {controlsVisible && (
      <div
        className="absolute z-10 flex flex-col gap-3 max-w-[204px]"
        style={{ left: `${controlsPos.x}px`, top: `${controlsPos.y}px` }}
      >
        <button
          type="button"
          onPointerDown={(e) => {
            if (e.button !== 0 && e.pointerType === 'mouse') return;
            e.preventDefault();
            controlsDragRef.current = {
              mx: e.clientX,
              my: e.clientY,
              x: controlsPos.x,
              y: controlsPos.y,
              pointerId: e.pointerId,
            };
          }}
          className="w-full touch-none rounded-lg border border-ink/10 bg-white/55 py-1 text-[11px] font-semibold text-ink/65 cursor-move backdrop-blur-md select-none"
          title="按住拖动控制卡（支持触摸）"
        >
          拖动控件
        </button>
        <div className="bg-white/62 backdrop-blur-md p-2.5 rounded-2xl shadow-sm border border-ink/10 flex gap-1">
          <button
            type="button"
            onClick={() => setViewPreset('month_custom_role')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1 px-2 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wide transition-all',
              viewPreset === 'month_custom_role'
                ? 'bg-olive text-white shadow-sm'
                : 'text-ink/40 hover:bg-ink/5'
            )}
            title="时令 · 习俗 · 人物"
          >
            <Layers size={12} />
            <span className="hidden sm:inline">三维</span>
          </button>
          <button
            type="button"
            onClick={() => setViewPreset('time_place_practice')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1 px-2 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wide transition-all',
              viewPreset === 'time_place_practice'
                ? 'bg-olive text-white shadow-sm'
                : 'text-ink/40 hover:bg-ink/5'
            )}
            title="时令 · 地点 · 活动"
          >
            <MapPin size={12} />
            <span className="hidden sm:inline">地景</span>
          </button>
          <button
            type="button"
            onClick={() => setViewPreset('narrative_practice_concept_experience')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1 px-2 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wide transition-all',
              viewPreset === 'narrative_practice_concept_experience'
                ? 'bg-olive text-white shadow-sm'
                : 'text-ink/40 hover:bg-ink/5'
            )}
            title="活动 · 概念 · 体验"
          >
            <Sparkles size={12} />
            <span className="hidden sm:inline">叙事</span>
          </button>
        </div>
        <p className="text-[9px] text-center text-ink/45 leading-tight px-1">
          {graphLoading
            ? '图谱同步中…'
            : graphSource === 'api'
              ? `已使用服务端数据${lastFetchMs != null ? ` · ${lastFetchMs}ms` : ''}`
              : '服务端不可用，使用内置数据'}
        </p>

        <div className="relative bg-white/62 backdrop-blur-md p-3 rounded-2xl shadow-sm border border-ink/10">
          <div className="flex items-center gap-2">
            <Search size={13} className="text-olive/80 shrink-0" />
            <input
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              onFocus={() => setSearchDropdownOpen(searchSuggestions.length > 0)}
              onBlur={() => {
                window.setTimeout(() => setSearchDropdownOpen(false), 120);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  if (searchSuggestions.length === 0) return;
                  setSearchDropdownOpen(true);
                  setSearchActiveIndex((prev) =>
                    prev < 0 ? 0 : Math.min(prev + 1, searchSuggestions.length - 1)
                  );
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  if (searchSuggestions.length === 0) return;
                  setSearchDropdownOpen(true);
                  setSearchActiveIndex((prev) =>
                    prev < 0 ? searchSuggestions.length - 1 : Math.max(prev - 1, 0)
                  );
                  return;
                }
                if (e.key === 'Escape') {
                  setSearchDropdownOpen(false);
                  return;
                }
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (searchDropdownOpen && searchActiveIndex >= 0 && searchSuggestions[searchActiveIndex]) {
                    chooseSuggestion(searchSuggestions[searchActiveIndex]);
                    return;
                  }
                  searchAndSelectNode();
                }
              }}
              placeholder="搜索节点（如：元宵、玄妙观）"
              className="w-full bg-transparent text-xs text-ink placeholder:text-ink/35 outline-none"
            />
            <button
              type="button"
              onClick={searchAndSelectNode}
              className="text-[10px] font-bold text-olive/80 hover:text-olive"
            >
              定位
            </button>
          </div>
          {searchDropdownOpen && searchSuggestions.length > 0 && (
            <div className="absolute left-2 right-2 top-[calc(100%-2px)] z-20 mt-1 overflow-hidden rounded-xl border border-ink/10 bg-white shadow-lg">
              {searchSuggestions.map((item, idx) => (
                <button
                  key={item.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    chooseSuggestion(item);
                  }}
                  className={cn(
                    'flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors',
                    idx === searchActiveIndex ? 'bg-olive/10 text-olive' : 'hover:bg-ink/5 text-ink/80'
                  )}
                >
                  <span className="truncate">{item.label}</span>
                  <span className="ml-2 shrink-0 text-[10px] text-ink/45">
                    {searchKeyword.trim()
                      ? (item.inView ? '当前视图' : '全图')
                      : '最近访问'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white/62 backdrop-blur-md p-3.5 rounded-2xl shadow-sm border border-ink/10 flex flex-col gap-2.5">
          <div className="flex items-center gap-2 text-xs font-bold text-olive uppercase tracking-wider mb-1">
            <Filter size={12} />
            <span>图谱筛选</span>
          </div>
          {viewPreset === 'month_custom_role' ? (
            <>
              <FilterToggle
                active={legacyFilter.includes('month')}
                onClick={() => toggleLegacyFilter('month')}
                icon={<Calendar size={14} />}
                label="月份"
                activeClass="bg-olive border-olive"
              />
              <FilterToggle
                active={legacyFilter.includes('custom')}
                onClick={() => toggleLegacyFilter('custom')}
                icon={<Sparkles size={14} />}
                label="习俗"
                activeClass="bg-vermilion border-dashed border-white/50"
              />
              <FilterToggle
                active={legacyFilter.includes('role')}
                onClick={() => toggleLegacyFilter('role')}
                icon={<Users size={14} />}
                label="人物"
                activeClass="bg-slate-500 border-slate-500"
              />
            </>
          ) : viewPreset === 'time_place_practice' ? (
            <>
              <FilterToggle
                active={tppFilter.includes('tpp_time')}
                onClick={() => toggleTppFilter('tpp_time')}
                icon={<Calendar size={14} />}
                label="时令"
                activeClass="bg-olive border-olive"
              />
              <FilterToggle
                active={tppFilter.includes('tpp_place')}
                onClick={() => toggleTppFilter('tpp_place')}
                icon={<MapPin size={14} />}
                label="地点"
                activeClass="bg-cyan-800 border-cyan-800"
              />
              <FilterToggle
                active={tppFilter.includes('tpp_practice')}
                onClick={() => toggleTppFilter('tpp_practice')}
                icon={<Sparkles size={14} />}
                label="活动"
                activeClass="bg-vermilion border-dashed border-white/50"
              />
            </>
          ) : (
            <>
              <FilterToggle
                active={narrativeFilter.includes('narr_practice')}
                onClick={() => toggleNarrativeFilter('narr_practice')}
                icon={<Sparkles size={14} />}
                label="活动"
                activeClass="bg-vermilion border-dashed border-white/50"
              />
              <FilterToggle
                active={narrativeFilter.includes('narr_concept')}
                onClick={() => toggleNarrativeFilter('narr_concept')}
                icon={<Layers size={14} />}
                label="概念"
                activeClass="bg-violet-700 border-violet-700"
              />
              <FilterToggle
                active={narrativeFilter.includes('narr_experience')}
                onClick={() => toggleNarrativeFilter('narr_experience')}
                icon={<MapPin size={14} />}
                label="体验"
                activeClass="bg-cyan-800 border-cyan-800"
              />
            </>
          )}
        </div>

        <div className="bg-white/62 backdrop-blur-md p-3.5 rounded-2xl shadow-sm border border-ink/10 flex flex-col gap-2.5">
          <div className="flex items-center gap-2 text-xs font-bold text-olive uppercase tracking-wider">
            <Link2 size={12} />
            <span>高级筛选</span>
          </div>
          <label className="flex items-start gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              className="mt-0.5 rounded border-ink/20 text-olive focus:ring-olive"
              checked={onlyWithSources}
              onChange={(e) => setOnlyWithSources(e.target.checked)}
            />
            <span className="text-[11px] font-medium text-ink/75 leading-snug">仅显示有文献依据的节点</span>
          </label>
          <div className="text-[10px] font-bold text-olive/60 uppercase tracking-wider">关系类型</div>
          <div className="flex flex-wrap gap-1">
            {GRAPH_RELATION_TYPES.map((rt) => (
              <RelationTypeChip
                key={rt}
                label={RELATION_LABEL_ZH[rt]}
                active={relationFilter.includes(rt)}
                onClick={() => toggleRelationType(rt)}
              />
            ))}
          </div>
          {relationFilter.length < GRAPH_RELATION_TYPES.length && (
            <button
              type="button"
              className="text-[10px] font-bold text-olive/80 hover:underline text-left"
              onClick={() => setRelationFilter([...GRAPH_RELATION_TYPES])}
            >
              显示全部关系类型
            </button>
          )}
        </div>
      </div>
      )}

      <AnimatePresence>
        {selectedNode && (
          <motion.div
            initial={{ x: 400, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 400, opacity: 0 }}
            className="absolute top-0 right-0 w-full sm:w-80 h-full bg-white/95 backdrop-blur-md border-l border-ink/10 p-8 shadow-2xl z-10 overflow-y-auto"
          >
            <button
              type="button"
              onClick={() => setSelectedNode(null)}
              className="absolute top-6 right-6 p-2 hover:bg-ink/5 rounded-full transition-colors"
            >
              <X size={20} />
            </button>

            <div className="mt-8 space-y-6">
              <section className="space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-widest opacity-50">实体概要</h4>
                <div className="space-y-2">
                  <span
                    className={cn(
                      'text-[10px] px-2 py-1 rounded-full font-bold uppercase tracking-widest text-white',
                      detailBadgeClass(selectedNode, viewPreset)
                    )}
                  >
                    {detailBadgeLabel(selectedNode, viewPreset)}
                  </span>
                  <h2 className="serif text-4xl font-bold text-olive">{selectedNode.label}</h2>
                </div>

                <div className="p-4 bg-paper/50 rounded-2xl border border-olive/10 relative group/info">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 text-olive">
                      <Info size={16} />
                      <span className="text-xs font-bold uppercase tracking-wider">详细解析</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => speak(selectedNode.description || '')}
                      className={cn(
                        'p-1.5 rounded-lg transition-all',
                        isSpeaking ? 'bg-vermilion text-white' : 'bg-olive/10 text-olive hover:bg-olive/20'
                      )}
                      title={isSpeaking ? '停止朗读' : '语音朗读'}
                    >
                      {isSpeaking ? <Square size={12} fill="currentColor" /> : <Volume2 size={12} />}
                    </button>
                  </div>
                  <p className="text-sm leading-relaxed opacity-80 italic">
                    {selectedNode.description || '暂无详细描述。'}
                  </p>
                </div>

                {(selectedNode.date || selectedNode.location || selectedNode.responsibility) && (
                  <div className="space-y-4 px-1">
                    {selectedNode.date && (
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg bg-olive/5 flex items-center justify-center shrink-0">
                          <Calendar size={14} className="text-olive" />
                        </div>
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-olive/50 block">
                            时间
                          </span>
                          <p className="text-sm font-medium text-ink/80">{selectedNode.date}</p>
                        </div>
                      </div>
                    )}
                    {selectedNode.location && (
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg bg-olive/5 flex items-center justify-center shrink-0">
                          <MapPin size={14} className="text-olive" />
                        </div>
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-olive/50 block">
                            地点
                          </span>
                          <p className="text-sm font-medium text-ink/80">{selectedNode.location}</p>
                        </div>
                      </div>
                    )}
                    {selectedNode.responsibility && (
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg bg-olive/5 flex items-center justify-center shrink-0">
                          <Users size={14} className="text-olive" />
                        </div>
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-olive/50 block">
                            职责
                          </span>
                          <p className="text-sm font-medium text-ink/80">{selectedNode.responsibility}</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {(narrativeTags.conceptTags.length > 0 || narrativeTags.experienceTags.length > 0) && (
                  <div className="space-y-3 px-1 pt-1">
                    {narrativeTags.conceptTags.length > 0 && (
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-olive/50 mb-1.5">
                          概念意义
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {narrativeTags.conceptTags.map((tag) => (
                            <span
                              key={`concept-${tag}`}
                              className="px-2 py-1 rounded-full text-[10px] font-semibold bg-olive/10 text-olive border border-olive/20"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {narrativeTags.experienceTags.length > 0 && (
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-olive/50 mb-1.5">
                          感官体验
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {narrativeTags.experienceTags.map((tag) => (
                            <span
                              key={`exp-${tag}`}
                              className="px-2 py-1 rounded-full text-[10px] font-semibold bg-cyan-50 text-cyan-800 border border-cyan-200"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </section>

              <section className="space-y-3 border-t border-ink/5 pt-4">
                <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest opacity-50">
                  <Link2 size={12} className="opacity-70" />
                  关联关系
                </h4>
                {neighborRows.length === 0 ? (
                  <p className="text-xs opacity-50 leading-relaxed">
                    暂无直接关系。可尝试打开左上更多「关系类型」，或切换视图预设。
                  </p>
                ) : (
                  <ul className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {neighborRows.map((row, idx) => (
                      <li key={`${row.neighborId}-${row.relationType}-${row.direction}-${idx}`}>
                        <button
                          type="button"
                          onClick={() => selectProjectedNeighbor(row.neighborId)}
                          className="w-full text-left text-xs leading-relaxed border border-ink/5 rounded-lg px-2.5 py-2 bg-paper/30 transition-colors hover:border-olive/30 hover:bg-olive/5"
                        >
                          <span className="font-mono text-olive/80 mr-1">
                            {row.direction === 'out' ? '→' : '←'}
                          </span>
                          <span className="font-semibold text-olive">{RELATION_LABEL_ZH[row.relationType]}</span>
                          <span className="text-ink/70"> · {row.neighborLabel}</span>
                          <span className="text-ink/40">（{ENTITY_TYPE_ZH[row.neighborEntityType]}）</span>
                          <span className="block text-[10px] text-olive/60 mt-1 font-medium">在图中查看</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="space-y-3 border-t border-ink/5 pt-4">
                <h4 className="text-xs font-bold uppercase tracking-widest opacity-50">文献依据</h4>
                {sourceCitations.length === 0 ? (
                  <p className="text-xs opacity-50">暂无聚合文献条目。</p>
                ) : (
                  <div className="space-y-3">
                    {sourceCitations.map((citation) => (
                      <div key={citation.sourceId} className="p-3 rounded-xl border border-olive/10 bg-paper/40">
                        <p className="text-xs font-semibold text-olive">{citation.title}</p>
                        {citation.quote && (
                          <p className="text-xs opacity-70 mt-1 leading-relaxed">“{citation.quote}”</p>
                        )}
                        {onOpenQjlSection && (
                          <button
                            type="button"
                            onClick={() => openCitation(citation)}
                            className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-bold text-olive hover:underline"
                          >
                            <BookOpen size={12} />
                            查看原文
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <p className="text-[10px] opacity-45 leading-relaxed">
                画布上的边受「关系类型」筛选；侧栏为全图语义关系。点击「在图中查看」可跳到当前视图中的邻居节点（金色圈为当前选中）。
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="absolute bottom-6 left-6 text-[10px] opacity-40 uppercase tracking-widest font-medium pointer-events-none">
        滚轮缩放 · 拖拽移动 · 点击查看详情
      </div>
    </div>
  );
}

function RelationTypeChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-2 py-1 rounded-lg text-[10px] font-bold border transition-all',
        active
          ? 'bg-olive/15 border-olive text-olive'
          : 'bg-white/80 border-ink/10 text-ink/35'
      )}
    >
      {label}
    </button>
  );
}

function FilterToggle({
  active,
  onClick,
  icon,
  label,
  activeClass,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  activeClass: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-4 py-2 rounded-xl transition-all text-sm font-bold border-2',
        active
          ? `${activeClass} text-white border-transparent shadow-md scale-105`
          : 'bg-white text-ink/40 border-ink/5 hover:border-ink/20'
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
