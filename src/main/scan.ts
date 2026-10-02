import { lstat, readdir } from 'node:fs/promises';
import { join, basename, resolve } from 'node:path';
import type { ScanProgress, ScanResult, DiskNode } from '../shared/types';

export async function scanDirectory(path: string, progress?: (p: ScanProgress) => void, cancelled?: () => boolean): Promise<ScanResult> {
  const absolute = resolve(path);
  const info = await lstat(absolute);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('请选择目录，不支持目录连接');
  const root: DiskNode = { path: absolute, name: basename(absolute) || absolute, directory: true, size: 0, children: [], modified: info.mtimeMs };
  const parents = new Map<DiskNode, DiskNode>();
  const dirty = new Set<DiskNode>([root]);
  const stack: DiskNode[] = [root];
  const issues: string[] = [];
  let files = 0, directories = 0, last = 0, currentPath = absolute;
  // Keep node references while constructing patches; no full-tree serialization during scanning.
  const emit = (force = false) => {
    if (!force && performance.now()-last < 120 && dirty.size < 1800) return;
    progress?.({ rootPath: absolute, files, directories, bytes: root.size, path: currentPath, issues: issues.length,
      nodes: [...dirty].map(node => ({ path: node.path, name: node.name, directory: node.directory, size: node.size, issue: node.issue, modified: node.modified, parent: parents.get(node)?.path ?? null })) });
    dirty.clear(); last = performance.now();
  };
  const issue = (node: DiskNode, message: string) => { node.issue = message; issues.push(node.path + '：' + message); dirty.add(node); };
  const check = () => { if (cancelled?.()) throw new Error('扫描已取消'); };
  emit(true);
  try {
    while (stack.length) {
      check(); const node = stack.pop()!; currentPath = node.path; directories++;
      try {
        const current = await lstat(node.path);
        if (current.isSymbolicLink() || !current.isDirectory()) { issue(node, '目录已变化或为链接，已跳过'); continue; }
        node.modified = current.mtimeMs; dirty.add(node);
        const entries = await readdir(node.path, { withFileTypes: true });
        for (const entry of entries) {
          check(); const target = join(node.path, entry.name); currentPath = target;
          const child: DiskNode = { path: target, name: entry.name, directory: entry.isDirectory(), size: 0, children: [] };
          node.children.push(child); parents.set(child, node); dirty.add(child);
          try {
            if (entry.isSymbolicLink()) issue(child, '跳过符号链接/目录连接');
            else if (entry.isDirectory()) stack.push(child);
            else if (entry.isFile()) {
              const stat = await lstat(target);
              if (!stat.isFile() || stat.isSymbolicLink()) { issue(child, '文件已变化，已跳过'); continue; }
              child.size = stat.size; child.modified = stat.mtimeMs; files++;
              for (let parent: DiskNode | undefined = node; parent; parent = parents.get(parent)) { parent.size += child.size; dirty.add(parent); }
            }
          } catch (error) { issue(child, error instanceof Error ? error.message : String(error)); }
          emit();
        }
      } catch (error) { check(); issue(node, error instanceof Error ? error.message : String(error)); }
      emit();
    }
  } finally { emit(true); }
  return { root, files, directories, issues };
}

