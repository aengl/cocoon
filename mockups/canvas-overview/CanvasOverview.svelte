<script lang="ts">
  import { SvelteFlow, Background, type Node, type Edge } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import dagre from '@dagrejs/dagre';
  import MockNode from './MockNode.svelte';

  // One row per node — id, payload, and the (width, height) we hand to dagre.
  // Sizes are approximate but accurate enough: dagre uses them for spacing,
  // and the rendered card auto-grows to its content.
  const raw = [
    {
      id: 'Fetch',
      size: { width: 220, height: 110 },
      data: {
        label: 'Fetch',
        nodeType: 'HttpGet',
        status: 'done' as const,
        doc: 'Paginate the discover endpoint for a year range.',
        statusMsg: '1,284 movies · 4.2s',
        inPorts: [] as string[],
        outPorts: ['movies'],
      },
    },
    {
      id: 'Bucket',
      size: { width: 240, height: 220 },
      data: {
        label: 'Bucket',
        nodeType: 'BucketByDecade',
        status: 'done' as const,
        doc: 'Group films by release decade; emit counts.',
        statusMsg: '6 buckets',
        bars: [
          { label: '70s', value: 28 },
          { label: '80s', value: 52 },
          { label: '90s', value: 88 },
          { label: '00s', value: 100 },
          { label: '10s', value: 64 },
          { label: '20s', value: 38 },
        ],
        inPorts: ['movies'],
        outPorts: ['buckets'],
      },
    },
    {
      id: 'FilterRated',
      size: { width: 220, height: 110 },
      data: {
        label: 'FilterRated',
        nodeType: 'FilterByRating',
        status: 'running' as const,
        params: [['minRating', '8.2']] as Array<[string, string]>,
        statusMsg: 'filtering 1,011 rows…',
        callout: 'This filter is too aggressive, try lowering the threshold',
        inPorts: ['buckets'],
        outPorts: ['movies'],
      },
    },
    {
      id: 'TopList',
      size: { width: 220, height: 95 },
      data: {
        label: 'TopList',
        nodeType: 'SortAndSlice',
        status: 'idle' as const,
        params: [['n', '25']] as Array<[string, string]>,
        inPorts: ['movies'],
        outPorts: [] as string[],
      },
    },
    {
      id: 'SummaryPlot',
      size: { width: 220, height: 110 },
      data: {
        label: 'SummaryPlot',
        nodeType: 'BudgetRevenueScatter',
        status: 'stale' as const,
        doc: 'Scatter budget vs revenue, log-log.',
        statusMsg: 'upstream changed — click to re-run',
        inPorts: ['movies'],
        outPorts: [] as string[],
      },
    },
  ];

  const edgeList: Array<[string, string]> = [
    ['Fetch', 'Bucket'],
    ['Bucket', 'FilterRated'],
    ['FilterRated', 'TopList'],
    ['FilterRated', 'SummaryPlot'],
  ];

  // Dagre LR layout — same parameters as the real editor (App.svelte).
  function layout(): { nodes: Node[]; edges: Edge[] } {
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: 'LR', nodesep: 48, ranksep: 96 });
    for (const n of raw) g.setNode(n.id, n.size);
    for (const [s, t] of edgeList) g.setEdge(s, t);
    dagre.layout(g);

    const nodes: Node[] = raw.map(n => {
      const c = g.node(n.id);
      return {
        id: n.id,
        type: 'mock',
        data: n.data,
        position: { x: c.x - c.width / 2, y: c.y - c.height / 2 },
      };
    });
    const edges: Edge[] = edgeList.map(([s, t]) => ({
      id: `${s}->${t}`,
      source: s,
      target: t,
      sourceHandle: raw.find(n => n.id === s)?.data.outPorts[0],
      targetHandle: raw.find(n => n.id === t)?.data.inPorts[0],
    }));
    return { nodes, edges };
  }

  const initial = layout();
  let nodes = $state.raw(initial.nodes);
  let edges = $state.raw(initial.edges);
  const nodeTypes = { mock: MockNode };
</script>

<div class="canvas">
  <SvelteFlow
    bind:nodes
    bind:edges
    {nodeTypes}
    colorMode="dark"
    fitView
    fitViewOptions={{ padding: 0.15 }}
    nodesDraggable={false}
    nodesConnectable={false}
    elementsSelectable={false}
    panOnDrag={false}
    zoomOnScroll={false}
    zoomOnPinch={false}
    zoomOnDoubleClick={false}
    proOptions={{ hideAttribution: true }}
  >
    <Background />
  </SvelteFlow>
</div>

<style>
  .canvas {
    width: 100vw;
    height: 100vh;
  }
  :global(.svelte-flow) {
    background: #09090b;
  }
</style>
