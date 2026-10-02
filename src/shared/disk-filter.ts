import type { DiskNode } from './types';
export function diskPredicate(query: string, now = Date.now()): (node: DiskNode) => boolean {
  if (query.length > 500) throw new Error('筛选条件最多 500 个字符');
  const clauses = query.split(';').map(x => x.trim()).filter(Boolean).map(clause => {
    const exclude = clause.startsWith('|'); const token = exclude ? clause.slice(1).trim() : clause;
    if (!token) throw new Error('排除条件不能为空');
    let match: (node: DiskNode) => boolean;
    const numeric = token.match(/^([<>])\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb|days?|months?|years?)$/i);
    if (numeric) {
      const [,operator,value,rawUnit] = numeric; const unit = rawUnit.toLowerCase();
      const units: Record<string,number> = { b:1,kb:1024,mb:1024**2,gb:1024**3,tb:1024**4,day:86400000,days:86400000,month:30*86400000,months:30*86400000,year:365*86400000,years:365*86400000 };
      const threshold = Number(value)*units[unit]; const age = !unit.endsWith('b');
      match = node => { if (age && !node.modified) return false; const n = age ? now-node.modified! : node.size; return operator === '>' ? n > threshold : n < threshold; };
    } else {
      if (/^[<>]/.test(token)) throw new Error('大小可写 >100mb；修改时间可写 >30days');
      const pattern = token.toLowerCase().replace(/\*+/g,'*');
      match = pattern.includes('*') || pattern.includes('?') ? node => wildcard(node.name.toLowerCase(),pattern) : node => node.name.toLowerCase().includes(pattern);
    }
    return (node: DiskNode) => exclude ? !match(node) : match(node);
  });
  return node => clauses.every(match => match(node));
}
function wildcard(text: string, pattern: string) {
  let i = 0, j = 0, star = -1, retry = 0;
  while (i < text.length) {
    if (pattern[j] === '?' || pattern[j] === text[i]) { i++; j++; }
    else if (pattern[j] === '*') { star = j++; retry = i; }
    else if (star !== -1) { j = star+1; i = ++retry; }
    else return false;
  }
  while (pattern[j] === '*') j++;
  return j === pattern.length;
}
/** Keep directory context while computing only matching file sizes. */
export function filteredTree(root: DiskNode, predicate: (node: DiskNode) => boolean): DiskNode {
  const visit = (node: DiskNode): DiskNode | null => {
    if (!node.directory) return predicate(node) ? node : null;
    const children = node.children.map(visit).filter((child): child is DiskNode => !!child);
    return children.length ? { ...node, children, size: children.reduce((n,c) => n+c.size,0) } : null;
  };
  return visit(root) || { ...root, children: [], size: 0 };
}
