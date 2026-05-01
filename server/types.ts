export interface MonthCustom {
  name: string;
  description: string;
  roles?: string[];
  modernStatus?: string;
}

export interface MonthData {
  month: string;
  summary: string;
  customs: MonthCustom[];
}

export interface PictureBookPage {
  text: string;
  imageBase64?: string;
  /** 单页标题（如“迎春摸春牛”），为兼容旧数据保留可选 */
  title?: string;
  /** 用于生成插图的英文或中英文提示词 */
  imagePrompt?: string;
  /** 绘本页语音合成结果（base64 音频），可选入库 */
  audioBase64?: string;
}

export interface PictureBook {
  id?: number;
  title: string;
  topic: string;
  pages: PictureBookPage[];
  createdAt?: string;
}
