import { createNodeBundle } from '@cocoon/rollup';

export default createNodeBundle({
  external: id => /@cocoon|gray-matter|tmp|tslib|util/.test(id),
});
