import { createNodeBundleConfig } from '@cocoon/rollup';

export default createNodeBundleConfig({
  external: id => /@cocoon|gray-matter|tmp|tslib|util/.test(id),
});
