import deltaJson from "./delta.json" with { type: "json" };

export interface ProductionDeltaOperation {
  insert: string | object;
  attributes?: object;
}

/** 生产环境中实际存在的历史 Delta 数据结构。 */
export interface ProductionDeltaFixture {
  title: string;
  content: ProductionDeltaOperation[];
}

/**
 * 返回一份从生产环境数据提取的完整 Delta fixture。
 *
 * 每次调用都会返回深拷贝，测试之间可以安全地修改数据。该数据保留了
 * 历史环境中的缺失字段和属性组合，不保证符合当前 canonical schema。
 */
export function loadDeltaFixture(): ProductionDeltaFixture {
  return structuredClone(deltaJson);
}
