/**
 * 段落边界识别与 Range 交集工具
 *
 * 纯 DOM 逻辑：不依赖 React / epub.js / Zustand，便于单元测试。
 * 支持范围（第一版）：
 *   - 正文由常规块级元素构成（<p>、<div>、<li>、<blockquote> 等）
 *   - 容器内的「孤立文本」（如 <div>引言<p>…</p></div> 中的"引言"）不支持，
 *     此时返回明确原因，调用方应保留原选区并提示用户。
 */

/** 明确的块级 display 值（白名单：不把未知值当作段落块） */
const BLOCK_DISPLAYS = new Set([
  'block',
  'flow-root',
  'list-item',
  'table',
  'table-row-group',
  'table-header-group',
  'table-footer-group',
  'table-row',
  'table-cell',
  'table-caption',
  'flex',
  'grid',
]);

/** 行内 display 值（可包含块级后代，需要下探） */
const INLINE_DISPLAYS = new Set([
  'inline',
  'inline-block',
  'inline-flex',
  'inline-grid',
  'inline-table',
  'ruby',
  'ruby-base',
  'ruby-text',
]);

export interface ParagraphResult {
  ok: boolean;
  /** 失败原因（ok=false 时存在） */
  reason?: string;
  /** 扩展后的完整段落范围 */
  range?: Range;
  /** 扩展后的文本（已 trim） */
  text?: string;
  firstBlock?: Element;
  lastBlock?: Element;
  /** 覆盖到的叶子块数量 */
  blockCount?: number;
}

/**
 * 求两个 Range 的交集。
 *
 * - 只用语义无争议的 START_TO_START（比起点）与 END_TO_END（比终点）
 * - 起点晚于终点时会抛 IndexSizeError（规范行为），此处捕获后视为无交集
 * - 交集折叠（仅边界接触）或只含空白字符时视为「没有实际选中」
 */
export function intersectRanges(a: Range, b: Range, doc: Document): Range | null {
  // 必须同属一个 document，否则 compareBoundaryPoints 行为未定义
  const aDoc = a.startContainer.ownerDocument;
  const bDoc = b.startContainer.ownerDocument;
  if (!aDoc || !bDoc || aDoc !== doc || bDoc !== doc) return null;

  const inter = doc.createRange();
  try {
    // START_TO_START: a.start 相对 b.start 的位置（负=前 / 0=同 / 正=后）
    const startLater = a.compareBoundaryPoints(Range.START_TO_START, b) >= 0 ? a : b;
    // END_TO_END: a.end 相对 b.end 的位置（负=前 / 0=同 / 正=后）
    const endEarlier = a.compareBoundaryPoints(Range.END_TO_END, b) <= 0 ? a : b;

    inter.setStart(startLater.startContainer, startLater.startOffset);
    inter.setEnd(endEarlier.endContainer, endEarlier.endOffset);
  } catch {
    // 反向边界：起点晚于终点 → 抛 IndexSizeError → 无交集
    return null;
  }

  if (inter.collapsed) return null;
  if (!/\S/.test(inter.toString())) return null;
  return inter;
}

/**
 * 收集 root 下的所有「叶子块」：自身是块级、且所有后代中不含块级元素。
 *
 * 规则：
 *   - display:none 的子树整体跳过
 *   - display:contents 自身不产出，继续遍历子元素
 *   - 行内元素自身不产出，但会下探（内部可能含块级元素）
 *   - 未知 display 值不当作块，仅下探
 *   - 块级且含块级后代 → 是容器，仅下探
 */
export function collectLeafBlocks(root: Element, win: Window): Element[] {
  // 样式查询在单次操作内会被多次使用，用缓存避免重复 getComputedStyle
  const displayCache = new WeakMap<Element, string>();
  const blockDescCache = new WeakMap<Element, boolean>();

  const displayOf = (el: Element): string => {
    let d = displayCache.get(el);
    if (d === undefined) {
      d = win.getComputedStyle(el).display;
      displayCache.set(el, d);
    }
    return d;
  };

  const isBlock = (el: Element) => BLOCK_DISPLAYS.has(displayOf(el));

  /** 是否存在块级后代（穿透行内元素与 display:contents） */
  const hasBlockDescendant = (el: Element): boolean => {
    const cached = blockDescCache.get(el);
    if (cached !== undefined) return cached;

    let found = false;
    for (const child of Array.from(el.children)) {
      const d = displayOf(child);
      if (d === 'none') continue;
      if (BLOCK_DISPLAYS.has(d)) { found = true; break; }
      // 行内 / contents / 未知值 → 继续下探
      if (hasBlockDescendant(child)) { found = true; break; }
    }
    blockDescCache.set(el, found);
    return found;
  };

  const out: Element[] = [];

  const walk = (el: Element) => {
    const d = displayOf(el);
    if (d === 'none') return;

    if (d === 'contents') {
      Array.from(el.children).forEach(walk);
      return;
    }

    if (INLINE_DISPLAYS.has(d)) {
      // 行内元素本身不是段落块，但内部可能有块级元素
      Array.from(el.children).forEach(walk);
      return;
    }

    if (BLOCK_DISPLAYS.has(d)) {
      if (hasBlockDescendant(el)) {
        Array.from(el.children).forEach(walk);
        return;
      }
      out.push(el);
      return;
    }

    // 未知 display：不当作块，仅下探
    Array.from(el.children).forEach(walk);
  };

  walk(root);
  return out;
}

/**
 * 找出 node 所属的叶子块。
 * - 若 node 本身是叶子块 → 返回它
 * - 否则沿祖先链向上找最近的叶子块成员
 * - 找不到（例如处在容器内的孤立文本中）→ null
 */
export function findLeafBlockForNode(
  node: Node,
  leafBlocks: Element[],
  stopAt: Node,
): Element | null {
  const set = new Set(leafBlocks);
  let cur: Node | null = node;
  while (cur && cur !== stopAt.parentNode) {
    if (cur.nodeType === 1 && set.has(cur as Element)) return cur as Element;
    cur = cur.parentNode;
  }
  return null;
}

/**
 * 基于当前选区计算「整段」范围：首段开头 → 末段末尾。
 *
 * 覆盖判定依赖 intersectRanges（有非空白文字交集才算选中），
 * 因此「终点恰好在下一段开头」不会多包含下一段。
 */
export function computeParagraphRange(
  selectionRange: Range,
  doc: Document,
  win: Window,
): ParagraphResult {
  const body = doc.body;
  if (!body) return { ok: false, reason: '正文为空' };

  if (selectionRange.collapsed) {
    return { ok: false, reason: '选区为空' };
  }

  const leafBlocks = collectLeafBlocks(body, win);
  if (leafBlocks.length === 0) {
    return { ok: false, reason: '未找到可识别的段落结构' };
  }

  // ===== 1) 起点必须落在某个叶子块内 =====
  // 若起点是容器内的孤立文本（不是任何叶子块的后代），第一版不支持
  const startBlock = findLeafBlockForNode(selectionRange.startContainer, leafBlocks, body);
  if (!startBlock) {
    return { ok: false, reason: '选区起点不在独立段落内' };
  }

  // ===== 2) 逐个叶子块求交集，得出实际覆盖的首尾块 =====
  let firstBlock: Element | null = null;
  let lastBlock: Element | null = null;
  let blockCount = 0;

  for (const block of leafBlocks) {
    const blockRange = doc.createRange();
    blockRange.selectNodeContents(block);

    const inter = intersectRanges(selectionRange, blockRange, doc);
    if (!inter) continue;

    if (!firstBlock) firstBlock = block;
    lastBlock = block;
    blockCount++;
  }

  if (!firstBlock || !lastBlock) {
    return { ok: false, reason: '无法确定选区覆盖的段落' };
  }

  // 起点所在块必须与实际覆盖的首块一致，否则说明选区起点是孤立文本
  if (startBlock !== firstBlock && !firstBlock.contains(startBlock)) {
    return { ok: false, reason: '选区起点不在独立段落内' };
  }

  // ===== 3) 构造范围：首块开头 → 末块末尾 =====
  const paraRange = doc.createRange();
  paraRange.setStart(firstBlock, 0);
  paraRange.setEnd(lastBlock, lastBlock.childNodes.length);

  const text = paraRange.toString().trim();
  if (!text) {
    return { ok: false, reason: '段落内容为空' };
  }

  return { ok: true, range: paraRange, text, firstBlock, lastBlock, blockCount };
}

/**
 * 判断两个 Range 是否表示同一段正文位置（比文本更严格，避免重复文本误判）。
 */
export function rangesAreEquivalent(a: Range, b: Range): boolean {
  if (a.startContainer.ownerDocument !== b.startContainer.ownerDocument) return false;
  try {
    return (
      a.compareBoundaryPoints(Range.START_TO_START, b) === 0 &&
      a.compareBoundaryPoints(Range.END_TO_END, b) === 0
    );
  } catch {
    return false;
  }
}
