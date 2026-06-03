/**
 * Flow-local env loading — the legacy-faithful port of the old
 * `dotenv-extended` + YAML `env:` merge (see `core/load-env.ts`). The Tibi
 * `boardgames.yml` depends on this: `ReadCatirpelData` reads libpq `PG*` from
 * `cocoon-next/.env.defaults`, `Publish*` reads `PROJECT_ROOT` from YAML
 * `env:`. The contract that must not regress is the **precedence**:
 *
 *   pre-existing process.env  >  .env  >  .env.defaults  >  YAML `env:`
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadFlowEnv } from '../../../core/load-env.ts';
import { Runtime } from '../../../core/runtime.ts';

const KEYS = [
  'TF_HOST',
  'TF_PORT',
  'TF_ONLY_DEFAULT',
  'TF_PRESET',
  'TF_YAML',
  'TF_CRED',
];

// Tests mutate process.env by design; restore the touched keys each time.
afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

const project = (files: Record<string, string>) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cocoon-env-'));
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), body);
  }
  return dir;
};

describe('loadFlowEnv', () => {
  it('applies the legacy precedence chain', () => {
    const dir = project({
      '.env.defaults':
        '# comment\nTF_HOST=from-defaults\nTF_PORT=1\nTF_ONLY_DEFAULT=d\n',
      '.env': 'TF_HOST=from-dotenv\nTF_PRESET=from-dotenv\n',
    });
    process.env.TF_PRESET = 'preset-wins';

    try {
      loadFlowEnv(path.join(dir, 'cocoon.yml'), {
        TF_HOST: 'from-yaml',
        TF_YAML: 'yaml-only',
        TF_PRESET: 'from-yaml',
      });

      expect(process.env.TF_HOST).toBe('from-dotenv'); // .env beats .env.defaults
      expect(process.env.TF_PORT).toBe('1'); // .env.defaults fills the gap
      expect(process.env.TF_ONLY_DEFAULT).toBe('d');
      expect(process.env.TF_PRESET).toBe('preset-wins'); // export beats all
      expect(process.env.TF_YAML).toBe('yaml-only'); // YAML fills last
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refreshes its own injected values on a re-run (the reload case)', () => {
    // First load: .env carries a wrong value; loadFlowEnv injects it.
    const dir = project({ '.env': 'TF_CRED=stale\n' });
    try {
      loadFlowEnv(path.join(dir, 'cocoon.yml'), undefined);
      expect(process.env.TF_CRED).toBe('stale');

      // Operator fixes .env; a reload must pick up the new value rather than
      // treat its own prior injection as a sacred pre-existing var.
      writeFileSync(path.join(dir, '.env'), 'TF_CRED=fixed\n');
      loadFlowEnv(path.join(dir, 'cocoon.yml'), undefined);
      expect(process.env.TF_CRED).toBe('fixed');

      // And a var removed from .env is dropped on reload, not left lingering.
      writeFileSync(path.join(dir, '.env'), '');
      loadFlowEnv(path.join(dir, 'cocoon.yml'), undefined);
      expect(process.env.TF_CRED).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still lets a genuine external export win over .env across reloads', () => {
    const dir = project({ '.env': 'TF_CRED=from-dotenv\n' });
    process.env.TF_CRED = 'from-shell';
    try {
      loadFlowEnv(path.join(dir, 'cocoon.yml'), undefined);
      expect(process.env.TF_CRED).toBe('from-shell');
      loadFlowEnv(path.join(dir, 'cocoon.yml'), undefined);
      expect(process.env.TF_CRED).toBe('from-shell'); // never clobbered
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('tolerates missing .env files and still applies YAML env', () => {
    const dir = project({}); // no .env / .env.defaults
    try {
      expect(() =>
        loadFlowEnv(path.join(dir, 'cocoon.yml'), { TF_YAML: 'y' })
      ).not.toThrow();
      expect(process.env.TF_YAML).toBe('y');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Runtime.load wires flow env before processing', () => {
  it('a node sees .env.defaults + YAML env via process.env', async () => {
    const dir = project({
      '.env.defaults': 'TF_HOST=h\nTF_PORT=2\n',
      'cocoon.yml': 'env:\n  TF_YAML: yv\nnodes:\n  N:\n    type: Noop\n',
    });
    try {
      await Runtime.load(path.join(dir, 'cocoon.yml'));
      expect(process.env.TF_HOST).toBe('h');
      expect(process.env.TF_PORT).toBe('2');
      expect(process.env.TF_YAML).toBe('yv');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
