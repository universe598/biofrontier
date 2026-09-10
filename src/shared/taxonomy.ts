export const TAXONOMY_VERSION = 'biofrontier-taxonomy-v2'

export const TAXONOMY = [
  {
    primary: '分子、细胞与发育',
    description: '研究生命活动的分子、细胞、结构和发育基础；疾病仅作为机制模型时也可归入此类。',
    secondary: ['分子机制', '细胞生物学', '生物化学与结构', '发育生物学', '干细胞与再生', '衰老生物学']
  },
  {
    primary: '遗传、组学与进化',
    description: '研究遗传变异、基因组调控、多组学测量以及遗传层面的进化规律。',
    secondary: ['遗传学', '基因组学', '表观遗传', '转录组与RNA', '蛋白质组与代谢组', '单细胞与空间组学', '进化遗传']
  },
  {
    primary: '免疫、微生物与感染',
    description: '研究免疫系统、炎症、病原体、感染过程、疫苗以及宿主与微生物互作。',
    secondary: ['基础免疫', '炎症与自身免疫', '病毒学', '细菌学', '真菌与寄生虫', '疫苗与免疫治疗', '微生物组']
  },
  {
    primary: '神经、认知与行为',
    description: '研究神经系统的发育、结构、功能、疾病、认知、行为与神经技术。',
    secondary: ['神经发育', '神经环路与突触', '认知与行为', '精神健康', '神经退行性疾病', '神经技术']
  },
  {
    primary: '疾病机制与临床转化',
    description: '以人类疾病机制、诊断、药物、治疗和临床验证为核心的问题。',
    secondary: ['肿瘤', '心血管', '代谢与内分泌', '呼吸系统', '消化与肝脏', '肾脏与泌尿', '生殖与妇幼', '药理与治疗', '临床试验与诊断', '罕见病']
  },
  {
    primary: '生态、环境与生物多样性',
    description: '研究生物与环境、生态系统、气候、生物多样性及保护问题。',
    secondary: ['生态系统', '气候与生物响应', '环境生物学', '生物多样性与保护', '海洋与淡水生物', '行为生态']
  },
  {
    primary: '生物技术、计算与研究方法',
    description: '以工具、算法、平台、工程实现或研究方法创新为主要贡献。',
    secondary: ['基因编辑', '合成生物学', '生物信息学', 'AI与计算生物学', '成像与显微', '实验与测量技术', '生物工程与生物材料']
  },
  {
    primary: '植物、动物与农业',
    description: '以植物、动物、作物、畜牧、兽医、农业系统或食品生产为主要对象。',
    secondary: ['植物科学', '动物生物学', '作物与育种', '畜牧与兽医', '农业生态', '食品科学']
  },
  {
    primary: '公共卫生与人群研究',
    description: '研究人群健康、流行病、营养、环境暴露、健康经济、政策和卫生系统。',
    secondary: ['流行病学', '营养与健康', '环境健康', '全球健康', '健康经济与政策', '社会与行为健康', '医疗服务与卫生系统']
  },
  {
    primary: '待确认',
    description: '仅用于摘要信息不足、真正无法确定的跨领域内容或明显超出生物医学范围的记录。不得用它表示低相关。',
    secondary: ['摘要信息不足', '跨领域待确认', '超出生物医学范围']
  }
] as const

export const PRIMARY_CATEGORIES = TAXONOMY.map((item) => item.primary)
export const SECONDARY_CATEGORIES = TAXONOMY.flatMap((item) => [...item.secondary])

export interface CategoryPath {
  id: string
  primary: string
  secondary: string
}

export const CATEGORY_PATHS: CategoryPath[] = TAXONOMY.flatMap((item, primaryIndex) =>
  item.secondary.map((secondary, secondaryIndex) => ({
    id: `P${String(primaryIndex + 1).padStart(2, '0')}-${String(secondaryIndex + 1).padStart(2, '0')}`,
    primary: item.primary,
    secondary
  })))

export function categoryPaths(includePending = true): CategoryPath[] {
  return CATEGORY_PATHS.filter((item) => includePending || item.primary !== '待确认')
}

export function categoryPathById(id: unknown): CategoryPath | undefined {
  return CATEGORY_PATHS.find((item) => item.id === String(id))
}

export function secondaryCategories(primary: string): readonly string[] {
  return TAXONOMY.find((item) => item.primary === primary)?.secondary || []
}

export function validPrimary(value: unknown): boolean {
  return PRIMARY_CATEGORIES.includes(String(value) as typeof PRIMARY_CATEGORIES[number])
}

export function validSecondary(primary: string, value: unknown): boolean {
  return secondaryCategories(primary).includes(String(value) as never)
}

export function taxonomyPrompt(includePending = true): string {
  return TAXONOMY
    .filter((item) => includePending || item.primary !== '待确认')
    .map((item) => {
      const paths = CATEGORY_PATHS.filter((path) => path.primary === item.primary)
      return `${item.primary}：${item.description}\n  路径：${paths.map((path) => `[${path.id}] ${path.secondary}`).join('；')}`
    })
    .join('\n')
}
