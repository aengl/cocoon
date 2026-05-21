<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteFlow, Background, type Node, type Edge } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import dagre from '@dagrejs/dagre';
  import MockNode from '../canvas-overview/MockNode.svelte';
  import Camera from './Camera.svelte';

  // ===== node definitions ===============================================
  // All three nodes are passed to dagre up front so layout is fixed; we
  // toggle `data.visible` over time to reveal them progressively.

  type Status = 'idle' | 'running' | 'done' | 'stale';

  type Steering =
    | { kind: 'number'; label: string; value: number }
    | { kind: 'text'; label: string; value: string };

  type NodeSpec = {
    id: string;
    size: { width: number; height: number };
    data: {
      label: string;
      nodeType: string;
      status: Status;
      doc?: string;
      steering?: Steering[];
      bars?: Array<{ label: string; value: number }>;
      callout?: string;
      statusMsg?: string;
      visible?: boolean;
      inPorts: string[];
      outPorts: string[];
    };
  };

  const HISTOGRAM_BARS = [
    { label: '4.0', value: 5 },
    { label: '4.5', value: 9 },
    { label: '5.0', value: 16 },
    { label: '5.5', value: 30 },
    { label: '6.0', value: 48 },
    { label: '6.5', value: 72 },
    { label: '7.0', value: 95 },
    { label: '7.2', value: 100 },
    { label: '7.5', value: 78 },
    { label: '8.0', value: 50 },
    { label: '8.5', value: 26 },
    { label: '9.0', value: 9 },
  ];

  const initialSpecs: NodeSpec[] = [
    {
      id: 'Fetch',
      size: { width: 220, height: 110 },
      data: {
        label: 'Fetch',
        nodeType: 'HttpGet',
        status: 'done',
        doc: 'Paginate /discover/movie for a year range.',
        statusMsg: '1,284 movies · 4.2s',
        visible: true,
        inPorts: [],
        outPorts: ['movies'],
      },
    },
    {
      id: 'RatingHistogram',
      size: { width: 240, height: 220 },
      data: {
        label: 'RatingHistogram',
        nodeType: 'Histogram',
        status: 'idle',
        doc: 'Bin rating into 0.5-wide buckets.',
        statusMsg: '',
        visible: false,
        inPorts: ['movies'],
        outPorts: ['bins'],
      },
    },
    {
      id: 'FilterByRating',
      size: { width: 220, height: 195 },
      data: {
        label: 'FilterByRating',
        nodeType: 'FilterByRating',
        status: 'idle',
        doc: 'Keep movies with rating ≥ minRating.',
        steering: [{ kind: 'number', label: 'minRating', value: 7.2 }],
        statusMsg: '',
        visible: false,
        inPorts: ['movies'],
        outPorts: ['movies'],
      },
    },
  ];

  // ===== compute layout ONCE, pre-mount, with the final edge set =========
  function computePositions(): Record<string, { x: number; y: number }> {
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 120 });
    for (const n of initialSpecs) g.setNode(n.id, n.size);
    g.setEdge('Fetch', 'RatingHistogram');
    g.setEdge('Fetch', 'FilterByRating');
    dagre.layout(g);
    const out: Record<string, { x: number; y: number }> = {};
    for (const n of initialSpecs) {
      const c = g.node(n.id);
      out[n.id] = { x: c.x - c.width / 2, y: c.y - c.height / 2 };
    }
    return out;
  }
  const positions = computePositions();

  // Plain `$state` (not `$derived`) so SvelteFlow can write back to it
  // without tripping state_unsafe_mutation. We mutate node.data.* directly
  // from the timeline; SvelteFlow re-renders on each mutation.
  let nodes = $state<Node[]>(
    initialSpecs.map(spec => ({
      id: spec.id,
      type: 'mock',
      position: positions[spec.id],
      data: { ...spec.data },
    }))
  );
  let edges = $state<Edge[]>([]);

  const nodeTypes = { mock: MockNode };

  // ===== camera =========================================================
  type CameraAPI = { centerOn: (id: string, duration?: number) => void };
  let camera: CameraAPI | null = null;
  const setCamera = (api: CameraAPI) => {
    camera = api;
  };

  // ===== chat pane ======================================================
  type ChatLine = { role: 'user' | 'ai'; text: string };
  let chat = $state<ChatLine[]>([]);

  // ===== timeline =======================================================
  const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

  function withNode(id: string, mutate: (d: NodeSpec['data']) => void) {
    const n = nodes.find(x => x.id === id);
    if (n) mutate(n.data as NodeSpec['data']);
  }
  const setNodeStatus = (id: string, status: Status) =>
    withNode(id, d => (d.status = status));
  const setNodeVisible = (id: string, visible: boolean) =>
    withNode(id, d => (d.visible = visible));
  const setNodeStatusMsg = (id: string, msg: string) =>
    withNode(id, d => (d.statusMsg = msg));
  const setNodeCallout = (id: string, callout: string | undefined) =>
    withNode(id, d => (d.callout = callout));
  const setNodeBars = (id: string, bars: typeof HISTOGRAM_BARS | undefined) =>
    withNode(id, d => (d.bars = bars));
  const addEdge = (source: string, target: string) => {
    edges = [...edges, { id: `${source}->${target}`, source, target }];
  };

  onMount(async () => {
    // Frame on Fetch alone — the canvas starts focused on a single node.
    await sleep(100);
    camera?.centerOn('Fetch', 0);
    await sleep(700);

    // User asks the question.
    chat = [...chat, { role: 'user', text: 'find me a good rating cutoff point' }];
    await sleep(1600);

    // AI responds, then adds the histogram node.
    chat = [...chat, { role: 'ai', text: 'Let me plot the rating distribution first.' }];
    await sleep(600);
    setNodeVisible('RatingHistogram', true);
    addEdge('Fetch', 'RatingHistogram');
    camera?.centerOn('RatingHistogram');
    await sleep(900);
    setNodeStatus('RatingHistogram', 'running');
    setNodeStatusMsg('RatingHistogram', 'binning 1,284 ratings…');
    await sleep(2000);
    setNodeStatus('RatingHistogram', 'done');
    setNodeStatusMsg('RatingHistogram', '12 bins · peak at 7.2');
    setNodeBars('RatingHistogram', HISTOGRAM_BARS);
    await sleep(1000);

    // AI reads the chart, picks a threshold, adds the filter.
    chat = [
      ...chat,
      { role: 'ai', text: '7.2 is the knee — keeps the top ~28%. Adding the filter.' },
    ];
    await sleep(1500);
    setNodeVisible('FilterByRating', true);
    addEdge('Fetch', 'FilterByRating');
    camera?.centerOn('FilterByRating');
    await sleep(900);
    setNodeCallout(
      'FilterByRating',
      'Threshold 7.2 — from histogram knee'
    );
    await sleep(600);
    setNodeStatus('FilterByRating', 'running');
    setNodeStatusMsg('FilterByRating', 'filtering 1,284 movies…');
    await sleep(2000);
    setNodeStatus('FilterByRating', 'done');
    setNodeStatusMsg('FilterByRating', '361 of 1,284 movies pass');
  });
</script>

<div class="page">
  <div class="canvas">
    <SvelteFlow
      {nodes}
      {edges}
      {nodeTypes}
      colorMode="dark"
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
      <Camera {setCamera} />
    </SvelteFlow>
  </div>

  <aside class="chat">
    <div class="chat-header">Claude Code</div>
    <div class="chat-stream">
      {#each chat as line, i (i)}
        <div class="line {line.role}">
          {#if line.role === 'user'}
            <span class="prefix">&gt;</span>
            <span class="text">{line.text}</span>
          {:else}
            <span class="text">{line.text}</span>
          {/if}
        </div>
      {/each}
    </div>
  </aside>
</div>

<style>
  .page {
    position: fixed;
    inset: 0;
    display: grid;
    grid-template-columns: 2fr 1fr;
  }
  .canvas {
    position: relative;
    background: #09090b;
  }
  :global(.canvas .svelte-flow) {
    background: #09090b;
  }

  .chat {
    background: #000;
    color: #e4e4e7;
    border-left: 1px solid #18181b;
    display: flex;
    flex-direction: column;
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 13px;
    line-height: 1.55;
    overflow: hidden;
  }
  .chat-header {
    padding: 12px 16px;
    color: #71717a;
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    border-bottom: 1px solid #18181b;
    font-family: ui-sans-serif, system-ui, sans-serif;
  }
  .chat-stream {
    flex: 1;
    min-height: 0;
    padding: 14px 18px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    overflow: hidden;
  }
  .line {
    animation: fade-in 0.4s ease-out both;
    display: flex;
    gap: 6px;
    align-items: baseline;
  }
  .line.user .text {
    color: #f4f4f5;
  }
  .line.user .prefix {
    color: #6366f1;
    font-weight: 700;
  }
  .line.ai .text {
    color: #a1a1aa;
  }
  @keyframes fade-in {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
</style>
