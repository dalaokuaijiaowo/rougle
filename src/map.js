import { NODE_TYPES } from './data.js';

export function chapterMap(seed, chapter) {
  const alternate = ((seed >>> (chapter * 3)) & 1) === 1;
  const rows = [
    ['intro'], ['event', 'combat', 'event'], ['combat', 'event', alternate ? 'elite' : 'combat'],
    ['shop', 'event', 'shop'], ['camp', alternate ? 'combat' : 'event', 'camp'], ['elite', 'elite'], ['boss'],
  ];
  const nodes = rows.flatMap((types, depth) => types.map((type, lane) => ({
    id: `c${chapter}-r${depth}-l${lane}`, depth, lane, type,
    x: types.length === 1 ? 50 : types.length === 2 ? 30 + lane * 40 : 15 + lane * 35,
    next: [],
  })));
  for (const node of nodes) node.next = nodes.filter(next => next.depth === node.depth + 1 &&
    (rows[node.depth].length === 1 || rows[next.depth].length === 1 || Math.abs(next.lane - node.lane) <= 1))
    .map(next => next.id);
  return { nodes, currentId: nodes[0].id, visited: [nodes[0].id] };
}

export function adjacentNodes(state) {
  const current = state.map.nodes.find(node => node.id === state.map.currentId);
  return state.map.nodes.filter(node => current.next.includes(node.id));
}

export function availableNodes(state) {
  return state.status === 'active' && state.encounter.resolved && !state.pendingGrowth ? adjacentNodes(state) : [];
}

export function validMap(map, chapter, depth) {
  if (!map || !Array.isArray(map.nodes) || !Array.isArray(map.visited) || map.nodes.length !== 16) return false;
  const ids = new Set(map.nodes.map(n => n?.id));
  if (ids.size !== 16 || !ids.has(map.currentId) || map.visited.at(-1) !== map.currentId || new Set(map.visited).size !== map.visited.length) return false;
  for (const n of map.nodes) {
    if (!n || !Number.isInteger(n.depth) || n.depth < 0 || n.depth > 6 || !Number.isInteger(n.lane) || n.lane < 0 || n.lane > 2 ||
      n.id !== `c${chapter}-r${n.depth}-l${n.lane}` || !NODE_TYPES.includes(n.type) || !Number.isFinite(n.x) || n.x < 10 || n.x > 90 || !Array.isArray(n.next)) return false;
    if (n.next.some(id => !map.nodes.some(next => next.id === id && next.depth === n.depth + 1))) return false;
  }
  if (map.nodes.find(n => n.id === map.currentId).depth !== depth || map.visited.length !== depth + 1) return false;
  return map.visited.every((id, i) => ids.has(id) && (i === 0 ? map.nodes.find(n => n.id === id).depth === 0 : map.nodes.find(n => n.id === map.visited[i - 1]).next.includes(id)));
}
