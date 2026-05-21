<script lang="ts">
  import { SvelteFlow, Background, type Node, type Edge } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import MockNode from '../canvas-overview/MockNode.svelte';

  // One canvas, one node, one popover sitting on top of it. The popover is
  // NOT a detached window in a separate pane — the editor's "window" surface
  // is a popover floating right over the canvas, partly covering the node it
  // belongs to. We mimic that exactly.

  const NODE_W = 260;

  const nodes: Node[] = [
    {
      id: 'Scatterplot',
      type: 'mock',
      position: { x: 60, y: 120 },
      data: {
        label: 'Scatterplot',
        nodeType: 'Scatterplot',
        status: 'done' as const,
        doc:
          '2-D scatter (ECharts). Brush a region;' +
          ' selected re-emits downstream.',
        freeform: {
          headline: 'Budget × Revenue',
          summaryHtml:
            '1,011 films · 1 brush · <b>22</b> in selection',
          action: 'Open chart ▸',
        },
        statusMsg: '1,011 films · 1 brush · 22 selected',
        inPorts: ['movies'],
        outPorts: ['movies'],
      },
    },
  ];
  const edges: Edge[] = [];
  const nodeTypes = { mock: MockNode };

  // Deterministic dots for the scatter — seeded RNG, two clouds.
  function dots() {
    let s = 0xc0c0_0001;
    const r = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffff_ffff;
    };
    const norm = () => Math.sqrt(-2 * Math.log(r())) * Math.cos(2 * Math.PI * r());
    // Brush rect lives at x ∈ [380, 540], y ∈ [120, 260] in plot coords.
    const inBrush = (x: number, y: number) =>
      x >= 380 && x <= 540 && y >= 120 && y <= 260;
    const out: Array<{ x: number; y: number; selected: boolean }> = [];
    for (let i = 0; i < 140; i++) {
      const cx = 240 + norm() * 110;
      const cy = 300 - norm() * 70;
      const x = Math.max(20, Math.min(820, cx));
      const y = Math.max(20, Math.min(360, cy));
      out.push({ x, y, selected: inBrush(x, y) });
    }
    for (let i = 0; i < 90; i++) {
      const cx = 520 + norm() * 130;
      const cy = 180 - norm() * 60;
      const x = Math.max(20, Math.min(820, cx));
      const y = Math.max(20, Math.min(360, cy));
      out.push({ x, y, selected: inBrush(x, y) });
    }
    return out;
  }
  const scatterDots = dots();
</script>

<div class="canvas">
  <SvelteFlow
    {nodes}
    {edges}
    {nodeTypes}
    colorMode="dark"
    fitView={false}
    defaultViewport={{ x: 0, y: 0, zoom: 1 }}
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

  <!-- Popover window — sits absolutely over the canvas, overlapping the node
       on its right edge so the node's left half still shows underneath. -->
  <section class="control-window">
    <header>
      <strong>Scatterplot</strong>
      <span class="type">control · done</span>
      <button class="close" type="button" tabindex="-1">×</button>
    </header>
    <div class="body">
      <div class="title">Budget vs revenue</div>
      <p class="subtitle">
        <b>1,011</b> films · sampled <b>500</b> drawn ·
        <b>22</b> in current brush
      </p>

      <svg
        class="scatter"
        viewBox="0 0 840 380"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="scatter plot of budget vs revenue with a brushed selection"
      >
        <!-- Axes -->
        <line x1="0" y1="360" x2="840" y2="360" stroke="#3f3f46" />
        <line x1="0" y1="0" x2="0" y2="360" stroke="#3f3f46" />
        <!-- Gridlines -->
        {#each [60, 140, 220, 300] as gy (gy)}
          <line x1="0" y1={gy} x2="840" y2={gy} stroke="#27272a" stroke-dasharray="2 4" />
        {/each}
        {#each [200, 400, 600] as gx (gx)}
          <line x1={gx} y1="0" x2={gx} y2="360" stroke="#27272a" stroke-dasharray="2 4" />
        {/each}
        <!-- Dots -->
        {#each scatterDots as d, i (i)}
          <circle
            cx={d.x}
            cy={d.y}
            r="3.5"
            fill={d.selected ? '#f59e0b' : '#71717a'}
            opacity={d.selected ? 0.95 : 0.55}
          />
        {/each}
        <!-- Brush rectangle. -->
        <rect
          x="380"
          y="120"
          width="160"
          height="140"
          fill="#f59e0b"
          fill-opacity="0.10"
          stroke="#f59e0b"
          stroke-dasharray="4 3"
        />
        <!-- Axis labels -->
        <text x="420" y="376" text-anchor="middle" fill="#a1a1aa" font-size="11">
          Budget ($, log)
        </text>
        <text x="8" y="14" fill="#a1a1aa" font-size="11">Revenue ($, log)</text>
      </svg>

    </div>
    <div class="grip"></div>
  </section>
</div>

<style>
  .canvas {
    position: fixed;
    inset: 0;
  }
  :global(.svelte-flow) {
    background: #09090b;
  }

  /* ===== Popover ====================================================== */
  .control-window {
    position: absolute;
    /* Sits slightly right + below the node, overlapping it on the right side
       so a sliver of the node remains visible — same as the screenshot. */
    left: 260px;
    top: 50px;
    width: 715px;
    height: 415px;
    z-index: 50;
    background: #0a0a0d;
    color: #e4e4e7;
    border: 1px solid #3f3f46;
    border-radius: 8px;
    box-shadow: 0 14px 50px #000c;
    overflow: hidden;
    font-size: 12px;
    display: flex;
    flex-direction: column;
  }
  .control-window header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 9px 14px;
    background: #18181b;
    border-bottom: 1px solid #3f3f46;
  }
  .control-window header strong {
    font-weight: 600;
    font-size: 13px;
  }
  .control-window header .type {
    color: #a1a1aa;
    font-size: 12px;
  }
  .control-window header .close {
    margin-left: auto;
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: #a1a1aa;
    font-size: 18px;
    line-height: 1;
    cursor: default;
  }
  .control-window .body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    padding: 14px 18px 18px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .control-window .grip {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 16px;
    height: 16px;
    background: linear-gradient(
      135deg,
      transparent 0 50%,
      #52525b 50% 60%,
      transparent 60% 70%,
      #52525b 70% 80%,
      transparent 80%
    );
  }

  .title {
    color: #f59e0b;
    font-size: 18px;
    font-weight: 700;
  }
  .subtitle {
    margin: 0;
    color: #a1a1aa;
    font-size: 12px;
  }
  .subtitle b {
    color: #c4b5fd;
    font-weight: 600;
  }

  .scatter {
    flex: 1;
    min-height: 0;
    width: 100%;
  }

</style>
