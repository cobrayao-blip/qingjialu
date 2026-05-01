export type GeoStatus = '存续' | '已变迁' | '待考';

/** 证据强度：地名在引文中显式出现为强；否则为弱或推断 */
export type GeoEvidenceStrength = 'direct' | 'indirect' | 'inferred';

export interface GeoCitation {
  sectionId: string;
  chapterTitle: string;
  quoteText: string;
  evidenceStrength?: GeoEvidenceStrength;
}

export interface GeoPlace {
  id: string;
  name: string;
  aliases?: string[];
  /** 文献可证的清代侧要点（可与 ancientSummary 二选一；优先展示本字段） */
  ancientEvidence?: string;
  /** 模型/编者对清代侧的综合概括（可能超出引文逐字范围） */
  ancientSummary: string;
  /** 现代侧中可核对、偏事实的部分 */
  modernFactual?: string;
  /** 现代侧推断、类比、旅游化叙述等（需克制） */
  modernInterpretation?: string;
  modernSummary: string;
  status: GeoStatus;
  months: string[];
  citations: GeoCitation[];
}
