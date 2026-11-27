import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  intersectRanges,
  collectLeafBlocks,
  findLeafBlockForNode,
  computeParagraphRange,
  rangesAreEquivalent,
} from './paragraph';

let dom: JSDOM;
let doc: Document;
let win: Window;

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>');
  doc = dom.window.document;
  win = dom.window as unknown as Window;
});

function mkHtml(html: string) {
  doc.body.innerHTML = html;
  return doc.body;
}

/** 在 <p> 等块内的文本节点上取范围（begin/end 为字符偏移） */
function textRange(block: Element, begin: number, end: number): Range {
  const tn = block.firstChild as Text;
  const r = doc.createRange();
  r.setStart(tn, begin);
  r.setEnd(tn, end);
  return r;
}

describe('intersectRanges', () => {
  it('同段相交：交集为重叠部分', () => {
    mkHtml('<p id="p1">0123456789</p>');
    const p1 = doc.getElementById('p1')!;
    const a = textRange(p1, 0, 7);   // 0123456
    const b = textRange(p1, 5, 10);  // 56789
    const inter = intersectRanges(a, b, doc);
    expect(inter).not.toBeNull();
    expect(inter!.toString()).toBe('56');
  });

  it('完全分离：返回 null（参数顺序 1）', () => {
    mkHtml('<p id="p1">0123456789</p><p id="p2">ABCDEFGHIJ</p>');
    const p1 = doc.getElementById('p1')!;
    const p2 = doc.getElementById('p2')!;
    expect(intersectRanges(textRange(p1, 0, 10), textRange(p2, 0, 10), doc)).toBeNull();
  });

  it('完全分离：返回 null（参数顺序 2，交换入参）', () => {
    mkHtml('<p id="p1">0123456789</p><p id="p2">ABCDEFGHIJ</p>');
    const p1 = doc.getElementById('p1')!;
    const p2 = doc.getElementById('p2')!;
    expect(intersectRanges(textRange(p2, 0, 10), textRange(p1, 0, 10), doc)).toBeNull();
  });

  it('边界接触（a.end == b.start）：折叠 → null', () => {
    mkHtml('<p id="p1">0123456789</p>');
    const p1 = doc.getElementById('p1')!;
    const a = textRange(p1, 0, 5);
    const b = textRange(p1, 5, 10);
    expect(intersectRanges(a, b, doc)).toBeNull();
  });

  it('只含空白字符的交集不算选中', () => {
    mkHtml('<p id="p1">aaa    bbb</p>');
    const p1 = doc.getElementById('p1')!;
    const a = textRange(p1, 0, 6);   // "aaa   "
    const b = textRange(p1, 3, 9);   // "    bb"
    const inter = intersectRanges(a, b, doc);
    // 交集 "   " 全是空白 → null
    expect(inter).toBeNull();
  });

  it('跨两段：分别与两段都有交集', () => {
    mkHtml('<p id="p1">0123456789</p><p id="p2">ABCDEFGHIJ</p>');
    const p1 = doc.getElementById('p1')!;
    const p2 = doc.getElementById('p2')!;

    const spanAll = doc.createRange();
    spanAll.setStart(p1.firstChild!, 5);
    spanAll.setEnd(p2.firstChild!, 5);

    const inter1 = intersectRanges(spanAll, textRange(p1, 0, 10), doc);
    const inter2 = intersectRanges(spanAll, textRange(p2, 0, 10), doc);
    expect(inter1!.toString()).toBe('56789');
    expect(inter2!.toString()).toBe('ABCDE');
  });

  it('跨三段且终点在第三段 offset 0：第三段无交集', () => {
    mkHtml(
      '<p id="p1">aaaaa</p><p id="p2">bbbbb</p><p id="p3">ccccc</p>'
    );
    const p1 = doc.getElementById('p1')!;
    const p2 = doc.getElementById('p2')!;
    const p3 = doc.getElementById('p3')!;

    const span = doc.createRange();
    span.setStart(p1.firstChild!, 2);
    span.setEnd(p3, 0);            // 元素节点 offset 0 = 第三段开头

    const inter1 = intersectRanges(span, textRange(p1, 0, 5), doc);
    const inter2 = intersectRanges(span, textRange(p2, 0, 5), doc);
    const inter3 = intersectRanges(span, textRange(p3, 0, 5), doc);

    expect(inter1).not.toBeNull();
    expect(inter2).not.toBeNull();
    expect(inter3).toBeNull();     // 只接触边界，不多选
  });

  it('起点/终点为元素节点 offset', () => {
    mkHtml('<div id="d"><span>a</span><span>b</span></div>');
    const d = doc.getElementById('d')!;
    const r = doc.createRange();
    r.setStart(d, 0);              // 元素 offset
    r.setEnd(d, 2);                // 元素 offset

    const blockRange = doc.createRange();
    blockRange.selectNodeContents(d);
    const inter = intersectRanges(r, blockRange, doc);
    expect(inter).not.toBeNull();
    expect(inter!.toString()).toBe('ab');
  });

  it('不同 document 之间返回 null', () => {
    mkHtml('<p id="p1">0123456789</p>');
    const p1 = doc.getElementById('p1')!;

    const dom2 = new JSDOM('<!doctype html><html><body><p id="q">zzz</p></body></html>');
    const doc2 = dom2.window.document;
    const q = doc2.getElementById('q')!;
    const r2 = doc2.createRange();
    r2.setStart(q.firstChild!, 0);
    r2.setEnd(q.firstChild!, 3);

    expect(intersectRanges(textRange(p1, 0, 10), r2 as unknown as Range, doc)).toBeNull();
  });
});

describe('collectLeafBlocks', () => {
  it('<p> 是叶子块', () => {
    mkHtml('<p>文字</p>');
    const blocks = collectLeafBlocks(doc.body, win);
    expect(blocks.length).toBe(1);
    expect(blocks[0].tagName).toBe('P');
  });

  it('<div><span>正文</span></div> 识别为 1 个叶子块', () => {
    mkHtml('<div id="d"><span>一段正文</span></div>');
    const blocks = collectLeafBlocks(doc.body, win);
    expect(blocks.length).toBe(1);
    expect(blocks[0].id).toBe('d');
  });

  it('<div>引言<p>一</p><p>二</p></div> 只产出 2 个 <p>', () => {
    mkHtml('<div id="wrap">引言<p>一</p><p>二</p></div>');
    const blocks = collectLeafBlocks(doc.body, win);
    expect(blocks.length).toBe(2);
    expect(blocks.every(b => b.tagName === 'P')).toBe(true);
  });

  it('深层 inline 包裹的块也能识别（inline 内含 block）', () => {
    // jsdom 对 display 计算有限，这里用显式 style 模拟：
    // <div style="display:inline"><p>深块</p></div>
    mkHtml('<div style="display:inline"><p id="deep">深块</p></div>');
    const blocks = collectLeafBlocks(doc.body, win);
    const ids = blocks.map(b => b.id || b.tagName);
    // 期望能找到 p#deep（inline 的 div 不能整体当段落）
    expect(ids).toContain('deep');
  });

  it('display:none 的块被跳过', () => {
    mkHtml('<p style="display:none">隐藏</p><p id="show">可见</p>');
    const blocks = collectLeafBlocks(doc.body, win);
    expect(blocks.length).toBe(1);
    expect(blocks[0].id).toBe('show');
  });

  it('<li> 内含多段时不把 li 当整段', () => {
    mkHtml('<ul><li><p>第一段</p><p>第二段</p></li></ul>');
    const blocks = collectLeafBlocks(doc.body, win);
    // li 含块级后代 → 容器；两个 p 是叶子块
    expect(blocks.length).toBe(2);
    expect(blocks.every(b => b.tagName === 'P')).toBe(true);
  });
});

describe('findLeafBlockForNode', () => {
  it('文本节点向上找到所属叶子块', () => {
    mkHtml('<p id="p1">文字</p>');
    const p1 = doc.getElementById('p1')!;
    const blocks = collectLeafBlocks(doc.body, win);
    expect(findLeafBlockForNode(p1.firstChild!, blocks, doc.body)!.id).toBe('p1');
  });

  it('容器内的孤立文本返回 null（第一版不支持）', () => {
    mkHtml('<div id="wrap">孤立文本<p>真段落</p></div>');
    const wrap = doc.getElementById('wrap')!;
    const orphanText = wrap.firstChild!;   // "孤立文本"
    const blocks = collectLeafBlocks(doc.body, win);
    expect(findLeafBlockForNode(orphanText, blocks, doc.body)).toBeNull();
  });
});

describe('computeParagraphRange', () => {
  it('单段部分选择 → 扩展为完整段落', () => {
    mkHtml('<p id="p1">0123456789</p>');
    const p1 = doc.getElementById('p1')!;
    const r = textRange(p1, 3, 6);   // "345"

    const res = computeParagraphRange(r, doc, win);
    expect(res.ok).toBe(true);
    expect(res.text).toBe('0123456789');
    expect(res.blockCount).toBe(1);
  });

  it('跨两段 → 两段完整', () => {
    mkHtml('<p id="p1">aaaaa</p><p id="p2">bbbbb</p>');
    const p1 = doc.getElementById('p1')!;
    const p2 = doc.getElementById('p2')!;

    const r = doc.createRange();
    r.setStart(p1.firstChild!, 2);
    r.setEnd(p2.firstChild!, 3);

    const res = computeParagraphRange(r, doc, win);
    expect(res.ok).toBe(true);
    expect(res.text).toBe('aaaaabbbbb');
    expect(res.blockCount).toBe(2);
  });

  it('跨三段 → 三段完整', () => {
    mkHtml('<p id="p1">aaaaa</p><p id="p2">bbbbb</p><p id="p3">ccccc</p>');
    const p1 = doc.getElementById('p1')!;
    const p3 = doc.getElementById('p3')!;

    const r = doc.createRange();
    r.setStart(p1.firstChild!, 2);
    r.setEnd(p3.firstChild!, 2);

    const res = computeParagraphRange(r, doc, win);
    expect(res.ok).toBe(true);
    expect(res.text).toBe('aaaaabbbbbccccc');
    expect(res.blockCount).toBe(3);
  });

  it('终点恰好在下一段开头 → 不多选下一段', () => {
    mkHtml('<p id="p1">aaaaa</p><p id="p2">bbbbb</p><p id="p3">ccccc</p>');
    const p1 = doc.getElementById('p1')!;
    const p2 = doc.getElementById('p2')!;
    const p3 = doc.getElementById('p3')!;

    // 从第一段中间，到第三段开头（第三段一个字符都没选）
    const r = doc.createRange();
    r.setStart(p1.firstChild!, 2);
    r.setEnd(p3, 0);

    const res = computeParagraphRange(r, doc, win);
    expect(res.ok).toBe(true);
    expect(res.text).toBe('aaaaabbbbb');   // 只有一、二段
    expect(res.blockCount).toBe(2);
  });

  it('起点在孤立文本中 → 失败且给出原因', () => {
    mkHtml('<div id="wrap">孤立文本<p id="p1">真段落</p></div>');
    const wrap = doc.getElementById('wrap')!;
    const p1 = doc.getElementById('p1')!;

    // 从孤立文本末尾到 p1 内部
    const r = doc.createRange();
    r.setStart(wrap.firstChild!, 0);
    r.setEnd(p1.firstChild!, 2);

    const res = computeParagraphRange(r, doc, win);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('不在独立段落内');
  });

  it('折叠选区 → 失败', () => {
    mkHtml('<p id="p1">0123456789</p>');
    const p1 = doc.getElementById('p1')!;
    const r = doc.createRange();
    r.setStart(p1.firstChild!, 3);
    r.setEnd(p1.firstChild!, 3);

    const res = computeParagraphRange(r, doc, win);
    expect(res.ok).toBe(false);
  });

  it('返回的 range 可直接 toString 得到完整文本', () => {
    mkHtml('<p id="p1">Hello</p><p id="p2">World</p>');
    const p1 = doc.getElementById('p1')!;
    const p2 = doc.getElementById('p2')!;

    const r = doc.createRange();
    r.setStart(p1.firstChild!, 1);
    r.setEnd(p2.firstChild!, 2);

    const res = computeParagraphRange(r, doc, win);
    expect(res.ok).toBe(true);
    expect(res.range!.toString().trim()).toBe(res.text);
  });
});

describe('rangesAreEquivalent', () => {
  it('相同边界 → true', () => {
    mkHtml('<p id="p1">0123456789</p>');
    const p1 = doc.getElementById('p1')!;
    expect(rangesAreEquivalent(textRange(p1, 2, 6), textRange(p1, 2, 6))).toBe(true);
  });

  it('不同边界 → false', () => {
    mkHtml('<p id="p1">0123456789</p>');
    const p1 = doc.getElementById('p1')!;
    expect(rangesAreEquivalent(textRange(p1, 2, 6), textRange(p1, 2, 7))).toBe(false);
  });
});
