import { createNodeBundle } from '@cocoon/rollup';

export default createNodeBundle({
  external: id => /@cocoon|tslib|gray-matter/.test(id),
});
